import cors from 'cors';
import express, { type Express } from 'express';
import type { DataZoneConfig } from './config.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createAssetsRouter } from './routes/assets.js';
import { createBaasRouter } from './routes/baas.js';
import { createDistributionRouter } from './routes/distribution.js';
import { MediaProcessor } from './services/media-processor.js';
import { CdnLinkService } from './services/cdn-link.service.js';
import { RevocationController } from './services/revocation.js';

export interface DataZoneApp {
  app: Express;
  media: MediaProcessor;
  config: DataZoneConfig;
}

export function createApp(config: DataZoneConfig): DataZoneApp {
  const media = new MediaProcessor(config);
  const cdn = new CdnLinkService(config);
  const revocation = new RevocationController(config);
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'data-zone',
      mode: 'media-drive+baas',
    });
  });

  // Timed CDN gateway — tombstone + HMAC check, then redirect to Sovereign Drive
  app.get('/cdn/:assetId', async (req, res) => {
    const assetId = String(req.params.assetId);
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig ?? '');

    if (await revocation.isCdnKeyRevoked(`sovereign:${assetId}`)) {
      res.status(410).json({ error: 'Asset revoked' });
      return;
    }
    if (!cdn.verify(assetId, exp, sig)) {
      res.status(403).json({ error: 'Invalid or expired CDN signature' });
      return;
    }
    const upstream = `${config.sovereignDriveBaseUrl}/v1/storage/asset/${assetId}/content`;
    res.redirect(302, upstream);
  });

  // BaaS gateway (API key + $TID) — mounted before shell JWT gate
  app.use(createBaasRouter(config, media));

  const auth = createAuthMiddleware(config);
  app.use(auth);
  app.use(createAssetsRouter(media));
  app.use(createDistributionRouter(config, media));

  return { app, media, config };
}
