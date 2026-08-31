import { createHash } from 'node:crypto';
import { Router, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, type PlatformTarget } from '@datazone/db';
import type { DataZoneConfig } from '../config.js';
import {
  createBaasAuthMiddleware,
  requireScope,
  type BaasRequest,
} from '../middleware/baas-auth.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { BaasCrypto } from '../services/baas-crypto.js';
import { CdnLinkService } from '../services/cdn-link.service.js';
import type { MediaProcessor } from '../services/media-processor.js';
import { MetaGraphPublisher, YouTubePublisher } from '../services/meta-graph.js';
import { OmniHubTokenService } from '../services/omnihub-tokens.js';
import { RevocationController } from '../services/revocation.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const uploadIntentSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  maxSizeBytes: z.number().int().positive().max(200 * 1024 * 1024).optional(),
  deviceSignature: z.string().optional(),
  parentAssetId: z.string().optional(),
});

const licenseSchema = z.object({
  isPublic: z.boolean().optional(),
  allowReuse: z.boolean().optional(),
  canReshare: z.boolean().optional(),
  allowedPlatforms: z.array(z.string()).min(1),
  monetizationTerms: z.string().optional(),
  royaltyFeeVidCap: z.number().min(0).max(100).optional(),
  expirationTimestamp: z.string().datetime().optional().nullable(),
});

const baasDistributeSchema = z.object({
  channels: z
    .array(
      z.enum([
        'LIVE_OS_PERSONAL',
        'LIVE_OS_BUSINESS',
        'INSTAGRAM_REEL',
        'INSTAGRAM_REELS',
        'INSTAGRAM_FEED',
        'FACEBOOK_PAGE',
        'FACEBOOK_REEL',
        'YOUTUBE_SHORTS',
        'YOUTUBE_VIDEO',
        'FB_FEED',
        'WEBHOOK',
        'INSTAGRAM',
        'FACEBOOK',
        'LIVE_OS',
      ]),
    )
    .min(1),
  caption: z.string().max(2200).optional(),
  webhookUrl: z.string().url().optional(),
});

function normalizeChannel(raw: string): PlatformTarget {
  switch (raw) {
    case 'INSTAGRAM_REELS':
    case 'INSTAGRAM':
      return 'INSTAGRAM_REEL';
    case 'FACEBOOK':
      return 'FACEBOOK_PAGE';
    case 'LIVE_OS':
      return 'LIVE_OS_PERSONAL';
    default:
      return raw as PlatformTarget;
  }
}

function platformFamily(target: PlatformTarget): string {
  if (target.startsWith('YOUTUBE')) return 'YOUTUBE';
  if (target.startsWith('LIVE_OS')) return 'LIVE_OS';
  if (target === 'WEBHOOK') return 'WEBHOOK';
  return 'META';
}

function httpError(res: Response, err: unknown): void {
  const status = (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(status).json({ error: message });
}

/**
 * External Developer API Gateway (BaaS)
 *   POST /v1/baas/assets/upload-intent
 *   POST /v1/baas/assets/upload/:token   (multipart complete)
 *   POST /v1/baas/assets/:assetId/license
 *   POST /v1/baas/assets/:assetId/distribute
 *   GET  /v1/baas/assets/:assetId/render
 *   POST /v1/baas/assets/:assetId/revoke
 *   POST /v1/baas/keys                   (dev bootstrap)
 */
export function createBaasRouter(config: DataZoneConfig, media: MediaProcessor): Router {
  const router = Router();
  const crypto = new BaasCrypto(config);
  const cdn = new CdnLinkService(config);
  const revoke = new RevocationController(config);
  const omni = new OmniHubTokenService(config);
  const meta = new MetaGraphPublisher(config);
  const youtube = new YouTubePublisher(config);

  const baasAuth = createBaasAuthMiddleware(config, { requireTid: true });
  const baasAuthOptionalTid = createBaasAuthMiddleware(config, { requireTid: false });

  /** Bootstrap: mint a developer API key (Trust ID JWT required). */
  router.post(
    '/v1/baas/keys',
    createAuthMiddleware(config),
    async (req: BaasRequest, res: Response) => {
      try {
        if (!req.principal) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const name = String(req.body?.name ?? 'Default key');
        const pair = crypto.generateApiKeyPair();
        const row = await prisma.developerApiKey.create({
          data: {
            keyId: pair.keyId,
            secretHash: pair.secretHash,
            name,
            tenantId: req.principal.tenantId,
            ownerTid: req.principal.userId,
          },
        });
        res.status(201).json({
          id: row.id,
          keyId: pair.keyId,
          secret: pair.secret,
          apiKey: `${pair.keyId}.${pair.secret}`,
          warning: 'Store the secret now — it will not be shown again.',
        });
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.post(
    '/v1/baas/assets/upload-intent',
    baasAuth,
    requireScope('assets:write'),
    async (req: BaasRequest, res: Response) => {
      try {
        const parsed = uploadIntentSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        if (!req.baas || !req.principal) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const intent = await prisma.uploadIntent.create({
          data: {
            apiKeyId: req.baas.apiKeyId,
            tidOwner: req.principal.userId,
            tenantId: req.principal.tenantId,
            filename: parsed.data.filename,
            mimeType: parsed.data.mimeType,
            maxSizeBytes: BigInt(parsed.data.maxSizeBytes ?? 50 * 1024 * 1024),
            uploadToken: 'pending',
            deviceSignature: parsed.data.deviceSignature,
            expiresAt: new Date(Date.now() + config.uploadIntentTtlSeconds * 1000),
          },
        });

        const { token, exp } = crypto.issueUploadToken(
          {
            intentId: intent.id,
            tidOwner: req.principal.userId,
            tenantId: req.principal.tenantId,
            apiKeyId: req.baas.apiKeyId,
          },
          config.uploadIntentTtlSeconds,
        );

        await prisma.uploadIntent.update({
          where: { id: intent.id },
          data: { uploadToken: token },
        });

        const uploadUrl = `${config.publicBaseUrl}/v1/baas/assets/upload/${encodeURIComponent(token)}`;

        res.status(201).json({
          intentId: intent.id,
          uploadUrl,
          expiresAt: new Date(exp * 1000).toISOString(),
          encryption: 'eSFS',
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          parentAssetId: parsed.data.parentAssetId ?? null,
        });
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  /** Complete multipart upload against presigned token (no API key re-prompt). */
  router.post(
    '/v1/baas/assets/upload/:token',
    upload.single('file'),
    async (req: BaasRequest, res: Response) => {
      try {
        const token = decodeURIComponent(String(req.params.token));
        const claims = crypto.verifyUploadToken(token);
        if (!claims) {
          res.status(403).json({ error: 'Invalid or expired upload token' });
          return;
        }

        const intent = await prisma.uploadIntent.findUnique({ where: { id: claims.intentId } });
        if (!intent || intent.status !== 'PENDING' || intent.uploadToken !== token) {
          res.status(410).json({ error: 'Upload intent not available' });
          return;
        }
        if (intent.expiresAt < new Date()) {
          await prisma.uploadIntent.update({
            where: { id: intent.id },
            data: { status: 'EXPIRED' },
          });
          res.status(410).json({ error: 'Upload intent expired' });
          return;
        }

        const file = req.file;
        if (!file?.buffer?.length) {
          res.status(400).json({ error: 'Missing file' });
          return;
        }
        if (BigInt(file.buffer.length) > intent.maxSizeBytes) {
          res.status(413).json({ error: 'File exceeds maxSizeBytes' });
          return;
        }

        const originHash = createHash('sha256').update(file.buffer).digest('hex');
        const sovereignAssetId = `baas_${intent.id}_${Date.now()}`;

        // Push bytes to Sovereign Drive when available; always register metadata.
        try {
          const form = new FormData();
          form.append(
            'file',
            new Blob([new Uint8Array(file.buffer)], { type: intent.mimeType }),
            intent.filename,
          );
          form.append('contentType', intent.mimeType);
          // Dev: engine may reject without JWT — dry vault id still recorded
          await fetch(`${config.sovereignDriveBaseUrl}/v1/storage/upload`, {
            method: 'POST',
            body: form,
          }).catch(() => undefined);
        } catch {
          /* vault optional in local BaaS path */
        }

        const master = await media.registerMaster({
          sovereignAssetId,
          filename: intent.filename,
          mimeType: intent.mimeType,
          sizeBytes: file.buffer.length,
          tidOwner: intent.tidOwner,
          tenantId: intent.tenantId,
          checksumSha256: originHash,
        });

        const parentAssetId =
          typeof req.body?.parentAssetId === 'string' ? req.body.parentAssetId : undefined;

        await prisma.mediaProvenance.create({
          data: {
            assetId: master.id,
            creatorTid: intent.tidOwner,
            originHash,
            parentAssetId: parentAssetId ?? null,
            deviceSignature: intent.deviceSignature,
            clientFingerprint: String(req.headers['x-dz-client'] ?? 'sdk-datazone'),
            creationTimestamp: new Date(),
          },
        });

        await prisma.uploadIntent.update({
          where: { id: intent.id },
          data: {
            status: 'COMPLETED',
            assetId: master.id,
            completedAt: new Date(),
          },
        });

        res.status(201).json({
          assetId: master.id,
          sovereignAssetId: master.sovereignAssetId,
          originHash,
          sizeBytes: file.buffer.length,
          immutable: true,
        });
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.post(
    '/v1/baas/assets/:assetId/license',
    baasAuth,
    requireScope('license'),
    async (req: BaasRequest, res: Response) => {
      try {
        const parsed = licenseSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        if (!req.principal) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const assetId = String(req.params.assetId);
        const asset = await prisma.mediaAsset.findFirst({
          where: { id: assetId, tidOwner: req.principal.userId, deletedAt: null },
        });
        if (!asset) {
          res.status(404).json({ error: 'Asset not found' });
          return;
        }

        const policy = await prisma.licensePolicy.upsert({
          where: { assetId },
          create: {
            assetId,
            isPublic: parsed.data.isPublic ?? false,
            allowReuse: parsed.data.allowReuse ?? false,
            canReshare: parsed.data.canReshare ?? false,
            allowedPlatforms: parsed.data.allowedPlatforms,
            monetizationTerms: parsed.data.monetizationTerms,
            royaltyFeeVidCap: parsed.data.royaltyFeeVidCap ?? 0,
            expirationTimestamp: parsed.data.expirationTimestamp
              ? new Date(parsed.data.expirationTimestamp)
              : null,
          },
          update: {
            isPublic: parsed.data.isPublic ?? false,
            allowReuse: parsed.data.allowReuse ?? false,
            canReshare: parsed.data.canReshare ?? false,
            allowedPlatforms: parsed.data.allowedPlatforms,
            monetizationTerms: parsed.data.monetizationTerms,
            royaltyFeeVidCap: parsed.data.royaltyFeeVidCap ?? 0,
            expirationTimestamp: parsed.data.expirationTimestamp
              ? new Date(parsed.data.expirationTimestamp)
              : null,
          },
        });

        res.json({ assetId, policy });
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.post(
    '/v1/baas/assets/:assetId/distribute',
    baasAuth,
    requireScope('distribute'),
    async (req: BaasRequest, res: Response) => {
      try {
        const parsed = baasDistributeSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        if (!req.principal || !req.baas) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const assetId = String(req.params.assetId);
        const asset = await prisma.mediaAsset.findFirst({
          where: {
            id: assetId,
            tidOwner: req.principal.userId,
            deletedAt: null,
            revokedAt: null,
          },
          include: {
            licensePolicy: true,
            provenance: true,
            variants: { include: { renderPreset: true } },
          },
        });
        if (!asset) {
          res.status(404).json({ error: 'Asset not found' });
          return;
        }

        const channels = parsed.data.channels.map(normalizeChannel);

        // License gate
        if (asset.licensePolicy) {
          const license = asset.licensePolicy;
          if (license.expirationTimestamp && license.expirationTimestamp < new Date()) {
            res.status(403).json({ error: 'License expired' });
            return;
          }
          for (const ch of channels) {
            const family = platformFamily(ch);
            const allowed =
              license.allowedPlatforms.includes(ch) ||
              license.allowedPlatforms.includes(family) ||
              (license.allowedPlatforms.includes('LIVE_OS') && family === 'LIVE_OS') ||
              (license.allowedPlatforms.includes('INSTAGRAM') && ch.startsWith('INSTAGRAM')) ||
              (license.allowedPlatforms.includes('FACEBOOK') &&
                (ch.startsWith('FACEBOOK') || ch === 'FB_FEED'));
            if (!allowed && !license.isPublic) {
              res.status(403).json({
                error: `LicensePolicy disallows channel ${ch}`,
                allowedPlatforms: license.allowedPlatforms,
              });
              return;
            }
          }
        }

        // Ensure renders for Meta/YouTube surfaces
        for (const ch of channels) {
          if (ch.startsWith('LIVE_OS') || ch === 'WEBHOOK') continue;
          const hasVariant = asset.variants.some((v) => v.renderPreset?.code === ch);
          if (!hasVariant) {
            await media.enqueueRender(asset.id, ch, req.principal.userId, req.principal.tenantId);
          }
        }

        // Refresh variants after enqueue (stubs are sync-ish)
        await new Promise((r) => setTimeout(r, 50));
        const refreshed = await prisma.mediaAsset.findUnique({
          where: { id: asset.id },
          include: { variants: { include: { renderPreset: true } } },
        });

        const jobs = [];
        for (const target of channels) {
          const family = platformFamily(target);
          const variant =
            refreshed?.variants.find((v) => v.renderPreset?.code === target) ?? null;
          const source = variant ?? asset;
          const mediaUrl = cdn.createTimedUrl(source.sovereignAssetId);

          const job = await prisma.distributionJob.create({
            data: {
              mediaAssetId: asset.id,
              platform: family,
              target,
              status: 'PROCESSING',
              renderAssetId: variant?.id,
              caption: parsed.data.caption,
              tidOwner: req.principal.userId,
              tenantId: req.principal.tenantId,
            },
          });

          try {
            let externalPostId: string;
            let externalUrl: string | undefined;

            if (family === 'LIVE_OS') {
              const result = await publishLiveOs(config, {
                target,
                mediaUrl,
                caption: parsed.data.caption,
                assetId: asset.id,
                tid: req.principal.userId,
              });
              externalPostId = result.id;
              externalUrl = result.url;
            } else if (family === 'WEBHOOK') {
              const url = parsed.data.webhookUrl;
              if (!url) throw Object.assign(new Error('webhookUrl required'), { status: 400 });
              await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-DataZone-Event': 'asset.distributed' },
                body: JSON.stringify({
                  assetId: asset.id,
                  mediaUrl,
                  caption: parsed.data.caption,
                  originHash: asset.checksumSha256,
                }),
              });
              externalPostId = `wh_${Date.now()}`;
              externalUrl = url;
            } else if (family === 'YOUTUBE') {
              const token = await omni.getYouTubeTokens(req.principal.userId, req.principal.tenantId);
              if (!token) throw Object.assign(new Error('YouTube not connected'), { status: 400 });
              const result = await youtube.publish(token, {
                target,
                videoUrl: mediaUrl,
                caption: parsed.data.caption,
              });
              externalPostId = result.externalPostId;
              externalUrl = result.externalUrl;
            } else {
              const token = await omni.getMetaTokens(req.principal.userId, req.principal.tenantId);
              if (!token) throw Object.assign(new Error('Meta not connected'), { status: 400 });
              const result = await meta.publish(token, {
                target,
                videoUrl: mediaUrl,
                caption: parsed.data.caption,
              });
              externalPostId = result.externalPostId;
              externalUrl = result.externalUrl;
            }

            const updated = await prisma.distributionJob.update({
              where: { id: job.id },
              data: {
                status: 'PUBLISHED',
                externalPostId,
                externalUrl,
                publishedAt: new Date(),
              },
            });
            jobs.push(updated);
          } catch (err) {
            const updated = await prisma.distributionJob.update({
              where: { id: job.id },
              data: {
                status: 'FAILED',
                errorMessage: err instanceof Error ? err.message : 'Distribute failed',
              },
            });
            jobs.push(updated);
          }
        }

        res.status(202).json({
          assetId: asset.id,
          jobs: jobs.map((j) => ({
            id: j.id,
            platform: j.platform,
            target: j.target,
            status: j.status,
            externalPostId: j.externalPostId,
            externalUrl: j.externalUrl,
            errorMessage: j.errorMessage,
          })),
        });
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.get(
    '/v1/baas/assets/:assetId/render',
    baasAuthOptionalTid,
    requireScope('assets:read'),
    async (req: BaasRequest, res: Response) => {
      try {
        const assetId = String(req.params.assetId);
        const asset = await prisma.mediaAsset.findFirst({
          where: { id: assetId, deletedAt: null },
          include: { provenance: true, licensePolicy: true, variants: true },
        });
        if (!asset) {
          res.status(404).json({ error: 'Asset not found' });
          return;
        }
        if (asset.revokedAt) {
          res.status(410).json({ error: 'Asset revoked' });
          return;
        }
        if (await revoke.isCdnKeyRevoked(`asset:${asset.id}`)) {
          res.status(410).json({ error: 'CDN cache invalidated' });
          return;
        }

        const license = asset.licensePolicy;
        if (license && !license.isPublic) {
          if (!req.principal || req.principal.userId !== asset.tidOwner) {
            res.status(403).json({ error: 'Asset is not public' });
            return;
          }
        }
        if (license?.expirationTimestamp && license.expirationTimestamp < new Date()) {
          res.status(403).json({ error: 'License expired' });
          return;
        }

        const originHash = asset.provenance?.originHash ?? asset.checksumSha256 ?? 'unknown';
        const watermark = crypto.watermarkToken(
          asset.id,
          originHash,
          asset.provenance?.creatorTid ?? asset.tidOwner,
        );

        const isVideo = asset.mimeType.startsWith('video/');
        const streamUrl = cdn.createTimedUrl(asset.sovereignAssetId);

        res.setHeader('X-DataZone-Asset-Id', asset.id);
        res.setHeader('X-DataZone-Origin-Hash', originHash);
        res.setHeader('X-DataZone-Creator-Tid', asset.provenance?.creatorTid ?? asset.tidOwner);
        res.setHeader('X-DataZone-Parent-Asset', asset.provenance?.parentAssetId ?? '');
        res.setHeader('X-DataZone-Watermark', watermark);
        res.setHeader('X-DataZone-Lineage', JSON.stringify({
          assetId: asset.id,
          parentAssetId: asset.provenance?.parentAssetId ?? null,
          creationTimestamp: asset.provenance?.creationTimestamp?.toISOString() ?? asset.createdAt.toISOString(),
          deviceSignature: asset.provenance?.deviceSignature ?? null,
        }));

        if (isVideo) {
          // HLS stub playlist pointing at timed CDN master (swap for real ABR ladder)
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-DATAZONE-WATERMARK:${watermark}
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=${asset.width ?? 1080}x${asset.height ?? 1920}
${streamUrl}
`;
          res.send(playlist);
          return;
        }

        res.json({
          assetId: asset.id,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          imageUrl: streamUrl,
          watermark,
          lineage: {
            originHash,
            creatorTid: asset.provenance?.creatorTid ?? asset.tidOwner,
            parentAssetId: asset.provenance?.parentAssetId ?? null,
            creationTimestamp:
              asset.provenance?.creationTimestamp?.toISOString() ?? asset.createdAt.toISOString(),
          },
        });
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.post(
    '/v1/baas/assets/:assetId/revoke',
    baasAuth,
    requireScope('assets:write'),
    async (req: BaasRequest, res: Response) => {
      try {
        if (!req.principal) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const assetId = String(req.params.assetId);
        const asset = await prisma.mediaAsset.findFirst({
          where: { id: assetId, tidOwner: req.principal.userId },
        });
        if (!asset) {
          res.status(404).json({ error: 'Asset not found' });
          return;
        }
        const result = await revoke.revokeAsset(assetId, {
          requestedByTid: req.principal.userId,
          reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        });
        res.json(result);
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  return router;
}

async function publishLiveOs(
  config: DataZoneConfig,
  opts: {
    target: PlatformTarget;
    mediaUrl: string;
    caption?: string;
    assetId: string;
    tid: string;
  },
): Promise<{ id: string; url: string }> {
  if (config.dryRunPublishing) {
    const id = `liveos_dry_${Date.now()}`;
    return {
      id,
      url: `${config.liveOsBaseUrl}/media/${id}`,
    };
  }

  const res = await fetch(`${config.liveOsBaseUrl}/v1/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      surface: opts.target,
      mediaUrl: opts.mediaUrl,
      caption: opts.caption,
      assetId: opts.assetId,
      tid: opts.tid,
    }),
  });
  if (!res.ok) throw new Error(`LiveOS publish failed: ${await res.text()}`);
  const data = (await res.json()) as { id: string; url?: string };
  return { id: data.id, url: data.url ?? `${config.liveOsBaseUrl}/media/${data.id}` };
}
