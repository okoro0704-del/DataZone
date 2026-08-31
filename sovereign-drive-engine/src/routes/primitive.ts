import { Router, type Response } from 'express';
import multer from 'multer';
import type { UploadAssetOptions } from '@hospitalityos/shared';
import type { AuthedRequest } from '../middleware/auth.js';
import type { StorageService } from '../services/storage.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function httpError(res: Response, err: unknown): void {
  const status = (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(status).json({ error: message });
}

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

/**
 * Primitive REST API matching IStorageProvider:
 *   POST   /v1/storage/upload
 *   GET    /v1/storage/asset/:assetId
 *   GET    /v1/storage/asset/:assetId/content  (stream / signed)
 *   DELETE /v1/storage/asset/:assetId
 */
export function createPrimitiveRouter(storage: StorageService): Router {
  const router = Router();

  router.post(
    '/v1/storage/upload',
    upload.single('file'),
    async (req: AuthedRequest, res: Response) => {
      try {
        if (!req.principal) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        let buffer: Buffer | undefined;
        let contentType = 'application/octet-stream';
        let filename: string | undefined;

        if (req.file) {
          buffer = req.file.buffer;
          contentType = req.file.mimetype || contentType;
          filename = req.file.originalname;
        } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          buffer = req.body;
          contentType = String(req.headers['content-type'] ?? contentType);
        } else if (typeof req.body?.data === 'string') {
          buffer = Buffer.from(req.body.data, 'base64');
          contentType = String(req.body.contentType ?? contentType);
          filename = req.body.filename;
        }

        if (!buffer || buffer.length === 0) {
          res.status(400).json({ error: 'Missing file payload' });
          return;
        }

        const options: UploadAssetOptions = {
          contentType: String(req.body?.contentType || contentType),
          filename: filename ?? req.body?.filename,
          tenantId: req.principal.tenantId,
          userId: req.principal.userId,
          private: req.body?.private === 'false' || req.body?.private === false ? false : true,
          readers: parseReaders(req.body?.readers),
          metadata: parseMetadata(req.body?.metadata),
        };

        // Enforce tenant binding — JWT tenant wins
        if (req.body?.tenantId && req.body.tenantId !== req.principal.tenantId) {
          res.status(403).json({ error: 'tenantId mismatch with Trust ID token' });
          return;
        }

        const result = await storage.upload(buffer, options);
        res.status(201).json(storage.toStoredAsset(result));
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.get('/v1/storage/asset/:assetId', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const assetId = paramId(req.params.assetId);
      const url = await storage.getDownloadUrl(assetId, req.principal);
      res.json({ assetId, url });
    } catch (err) {
      httpError(res, err);
    }
  });

  router.get(
    '/v1/storage/asset/:assetId/content',
    async (req: AuthedRequest, res: Response) => {
      try {
        const assetId = paramId(req.params.assetId);
        const exp = Number(req.query.exp);
        const sig = String(req.query.sig ?? '');
        const tenantId = String(req.query.tenantId ?? '');

        const { body, contentType, asset } = await storage.getAssetBytes(assetId, {
          principal: req.principal,
          signed:
            exp && sig && tenantId
              ? { tenantId, exp, sig }
              : undefined,
        });

        res.setHeader('Content-Type', contentType);
        res.setHeader('X-Asset-Id', asset.assetId);
        res.setHeader('X-Content-Hash', asset.hash);
        res.send(body);
      } catch (err) {
        httpError(res, err);
      }
    },
  );

  router.delete('/v1/storage/asset/:assetId', async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const ok = await storage.delete(paramId(req.params.assetId), req.principal);
      res.status(ok ? 200 : 404).json({ deleted: ok });
    } catch (err) {
      httpError(res, err);
    }
  });

  return router;
}

function parseReaders(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return undefined;
}

function parseMetadata(raw: unknown): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  if (typeof raw === 'string') {
    try {
      return parseMetadata(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
