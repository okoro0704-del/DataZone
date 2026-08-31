import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from './config/index.js';
import { createAuthMiddleware, type AuthedRequest } from './middleware/auth.js';
import { createPrimitiveRouter } from './routes/primitive.js';
import { StorageService } from './services/storage.service.js';

export interface SovereignDriveApp {
  app: Express;
  storage: StorageService;
  config: AppConfig;
}

/** Auth required except for signed content downloads. */
function createOptionalAuth(config: AppConfig) {
  const requireAuth = createAuthMiddleware(config.auth);

  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const isSignedContent =
      req.method === 'GET' &&
      /\/v1\/storage\/asset\/[^/]+\/content$/.test(req.path) &&
      Boolean(req.query.sig);

    if (isSignedContent) {
      next();
      return;
    }
    requireAuth(req, res, next);
  };
}

export function createApp(config: AppConfig): SovereignDriveApp {
  const storage = new StorageService(config);
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'sovereign-drive-engine',
      driver: storage.driver.name,
    });
  });

  app.use(createOptionalAuth(config));
  app.use(createPrimitiveRouter(storage));

  return { app, storage, config };
}
