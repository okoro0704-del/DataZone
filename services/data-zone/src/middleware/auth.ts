import type { NextFunction, Request, Response } from 'express';
import { createSecretKey } from 'node:crypto';
import * as jose from 'jose';
import type { DataZoneConfig } from '../config.js';

export interface TrustPrincipal {
  userId: string;
  tenantId: string;
  roles?: string[];
}

export interface AuthedRequest extends Request {
  principal?: TrustPrincipal;
}

export function createAuthMiddleware(config: DataZoneConfig) {
  const key = createSecretKey(Buffer.from(config.trustId.jwtSecret));

  return async function authMiddleware(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Trust ID bearer token' });
      return;
    }
    try {
      const { payload } = await jose.jwtVerify(header.slice(7), key, {
        issuer: config.trustId.issuer,
        audience: config.trustId.audience,
      });
      const userId = String(payload.sub ?? '');
      const tenantId = String(payload.tid ?? payload.tenantId ?? '');
      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Invalid Trust ID claims' });
        return;
      }
      req.principal = {
        userId,
        tenantId,
        roles: Array.isArray(payload.roles) ? payload.roles.map(String) : undefined,
      };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired Trust ID token' });
    }
  };
}
