import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  prisma,
  type PlatformTarget,
} from '@datazone/db';
import type { AuthedRequest } from '../middleware/auth.js';
import type { MediaProcessor } from '../services/media-processor.js';
import { OmniHubTokenService } from '../services/omnihub-tokens.js';
import { MetaGraphPublisher, YouTubePublisher } from '../services/meta-graph.js';
import { CdnLinkService } from '../services/cdn-link.service.js';
import type { DataZoneConfig } from '../config.js';

const distributeSchema = z.object({
  assetId: z.string().min(1),
  platforms: z
    .array(
      z.enum([
        'INSTAGRAM_REEL',
        'INSTAGRAM_FEED',
        'INSTAGRAM_REELS',
        'FACEBOOK_PAGE',
        'FACEBOOK_REEL',
        'YOUTUBE_SHORTS',
        'YOUTUBE_VIDEO',
        'FB_FEED',
      ]),
    )
    .min(1),
  caption: z.string().max(2200).optional(),
});

/** Normalize UI aliases (INSTAGRAM_REELS → INSTAGRAM_REEL). */
function normalizeTarget(raw: string): PlatformTarget {
  if (raw === 'INSTAGRAM_REELS') return 'INSTAGRAM_REEL';
  return raw as PlatformTarget;
}

function platformFamily(target: PlatformTarget): 'META' | 'YOUTUBE' {
  if (target.startsWith('YOUTUBE')) return 'YOUTUBE';
  return 'META';
}

function httpError(res: Response, err: unknown): void {
  const status = (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(status).json({ error: message });
}

/**
 * Social Publishing Router
 *   POST /v1/datazone/distribute
 */
export function createDistributionRouter(
  config: DataZoneConfig,
  _media: MediaProcessor,
): Router {
  const router = Router();
  const omni = new OmniHubTokenService(config);
  const meta = new MetaGraphPublisher(config);
  const youtube = new YouTubePublisher(config);
  const cdn = new CdnLinkService(config);

  router.post('/v1/datazone/distribute', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const parsed = distributeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const { assetId, platforms, caption } = parsed.data;
      const { userId: tidOwner, tenantId } = req.principal;

      const asset = await prisma.mediaAsset.findFirst({
        where: { id: assetId, tidOwner, deletedAt: null },
        include: {
          variants: { include: { renderPreset: true }, where: { deletedAt: null } },
        },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }

      const jobs = [];

      for (const raw of platforms) {
        const target = normalizeTarget(raw);
        const family = platformFamily(target);

        const variant =
          asset.variants.find((v) => v.renderPreset?.code === target) ??
          asset.variants.find((v) =>
            target.includes('REEL') || target.includes('SHORTS')
              ? v.width === 1080 && v.height === 1920
              : target.includes('FEED') || target === 'FB_FEED'
                ? v.width === v.height
                : false,
          );

        const sourceAsset = variant ?? asset;
        const videoUrl = cdn.createTimedUrl(sourceAsset.sovereignAssetId);

        const job = await prisma.distributionJob.create({
          data: {
            mediaAssetId: asset.id,
            platform: family,
            target,
            status: 'PROCESSING',
            renderAssetId: variant?.id,
            caption,
            tidOwner,
            tenantId,
          },
        });

        try {
          let result;
          if (family === 'YOUTUBE') {
            const token = await omni.getYouTubeTokens(tidOwner, tenantId);
            if (!token) throw Object.assign(new Error('YouTube not connected in OmniHub'), { status: 400 });
            result = await youtube.publish(token, { target, videoUrl, caption });
            job.omniConnectionId = token.externalAccountId;
          } else {
            const token = await omni.getMetaTokens(tidOwner, tenantId);
            if (!token) throw Object.assign(new Error('Meta not connected in OmniHub'), { status: 400 });
            result = await meta.publish(token, { target, videoUrl, caption });
            job.omniConnectionId = token.externalAccountId;
          }

          const updated = await prisma.distributionJob.update({
            where: { id: job.id },
            data: {
              status: 'PUBLISHED',
              externalPostId: result.externalPostId,
              externalUrl: result.externalUrl,
              omniConnectionId: job.omniConnectionId,
              publishedAt: new Date(),
            },
          });
          jobs.push(updated);
        } catch (err) {
          const updated = await prisma.distributionJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: err instanceof Error ? err.message : 'Publish failed',
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
          publishedAt: j.publishedAt?.toISOString() ?? null,
        })),
      });
    } catch (err) {
      httpError(res, err);
    }
  });

  router.get('/v1/datazone/distribute/:jobId', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const job = await prisma.distributionJob.findFirst({
        where: { id: String(req.params.jobId), tidOwner: req.principal.userId },
      });
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(job);
    } catch (err) {
      httpError(res, err);
    }
  });

  return router;
}
