import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma, DEFAULT_RENDER_PRESETS, type PlatformTarget } from '@datazone/db';
import type { AuthedRequest } from '../middleware/auth.js';
import type { MediaProcessor } from '../services/media-processor.js';

const registerSchema = z.object({
  sovereignAssetId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
  originalUrl: z.string().url().optional(),
  checksumSha256: z.string().optional(),
  autoRenderPresets: z.array(z.string()).optional(),
});

function httpError(res: Response, err: unknown): void {
  const status = (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(status).json({ error: message });
}

export function createAssetsRouter(media: MediaProcessor): Router {
  const router = Router();

  router.get('/v1/datazone/drive', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const drive = await media.listDrive(req.principal.userId, { q });
      res.json(drive);
    } catch (err) {
      httpError(res, err);
    }
  });

  router.get('/v1/datazone/assets/:id', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const asset = await prisma.mediaAsset.findFirst({
        where: {
          id: String(req.params.id),
          tidOwner: req.principal.userId,
          deletedAt: null,
        },
        include: {
          variants: { include: { renderPreset: true }, where: { deletedAt: null } },
          distributionJobs: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      });
      if (!asset) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json({
        ...asset,
        sizeBytes: Number(asset.sizeBytes),
        downloadUrl: media.getDownloadLink(asset.sovereignAssetId),
        variants: asset.variants.map((v) => ({
          ...v,
          sizeBytes: Number(v.sizeBytes),
          downloadUrl: media.getDownloadLink(v.sovereignAssetId),
        })),
      });
    } catch (err) {
      httpError(res, err);
    }
  });

  router.post('/v1/datazone/assets/register', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const master = await media.registerMaster({
        ...parsed.data,
        tidOwner: req.principal.userId,
        tenantId: req.principal.tenantId,
        autoRenderPresets: parsed.data.autoRenderPresets as PlatformTarget[] | undefined,
      });
      res.status(201).json({
        ...master,
        sizeBytes: Number(master.sizeBytes),
        downloadUrl: media.getDownloadLink(master.sovereignAssetId),
      });
    } catch (err) {
      httpError(res, err);
    }
  });

  router.post('/v1/datazone/assets/:id/render', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const preset = String(req.body?.preset ?? '');
      if (!preset) {
        res.status(400).json({ error: 'preset required' });
        return;
      }
      const asset = await prisma.mediaAsset.findFirst({
        where: { id: String(req.params.id), tidOwner: req.principal.userId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      await media.enqueueRender(
        asset.id,
        preset,
        req.principal.userId,
        req.principal.tenantId,
      );
      res.status(202).json({ queued: true, preset });
    } catch (err) {
      httpError(res, err);
    }
  });

  router.post('/v1/datazone/presets/seed', async (_req, res: Response) => {
    try {
      for (const p of DEFAULT_RENDER_PRESETS) {
        await prisma.renderPreset.upsert({
          where: { code: p.code },
          create: {
            code: p.code,
            label: p.label,
            width: p.width,
            height: p.height,
            outputMime: p.outputMime,
            fitMode: p.fitMode,
            maxDurationMs: 'maxDurationMs' in p ? p.maxDurationMs : null,
            bitrateKbps: p.bitrateKbps,
          },
          update: {
            label: p.label,
            width: p.width,
            height: p.height,
            outputMime: p.outputMime,
            fitMode: p.fitMode,
            maxDurationMs: 'maxDurationMs' in p ? p.maxDurationMs : null,
            bitrateKbps: p.bitrateKbps,
            active: true,
          },
        });
      }
      const presets = await prisma.renderPreset.findMany({ orderBy: { code: 'asc' } });
      res.json({ presets });
    } catch (err) {
      httpError(res, err);
    }
  });

  router.get('/v1/datazone/presets', async (_req, res: Response) => {
    try {
      const presets = await prisma.renderPreset.findMany({
        where: { active: true },
        orderBy: { code: 'asc' },
      });
      res.json({ presets });
    } catch (err) {
      httpError(res, err);
    }
  });

  return router;
}
