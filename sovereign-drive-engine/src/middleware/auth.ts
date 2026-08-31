import type { NextFunction, Request, Response } from 'express';
import { createSecretKey } from 'node:crypto';
import * as jose from 'jose';
import type { AuthConfig } from '../config/index.js';
import type { TrustPrincipal } from '../services/acl.service.js';

export interface AuthedRequest extends Request {
  principal?: TrustPrincipal;
}

/**
 * Trust ID JWT middleware.
 * Expects `Authorization: Bearer <jwt>` with claims:
 *   sub  -> userId
 *   tid  -> tenantId
 *   roles (optional string[])
 */
export function createAuthMiddleware(config: AuthConfig) {
  const key = createSecretKey(Buffer.from(config.jwtSecret));

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

    const token = header.slice('Bearer '.length);
    try {
      const { payload } = await jose.jwtVerify(token, key, {
        issuer: config.trustIdIssuer,
        audience: config.trustIdAudience,
      });

      const userId = String(payload.sub ?? '');
      const tenantId = String(payload.tid ?? payload.tenantId ?? '');
      if (!userId || !tenantId) {
        res.status(401).json({ error: 'Invalid Trust ID claims (sub, tid required)' });
        return;
      }

      req.principal = {
        userId,
        tenantId,
        roles: Array.isArray(payload.roles)
          ? payload.roles.map(String)
          : undefined,
      };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired Trust ID token' });
    }
  };
}

/** Issue a test/dev Trust ID JWT (used by tests and local tooling). */
export async function issueTrustIdToken(
  config: AuthConfig,
  claims: { userId: string; tenantId: string; roles?: string[]; expiresIn?: string },
): Promise<string> {
  const key = createSecretKey(Buffer.from(config.jwtSecret));
  return new jose.SignJWT({
    tid: claims.tenantId,
    roles: claims.roles ?? [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(config.trustIdIssuer)
    .setAudience(config.trustIdAudience)
    .setIssuedAt()
    .setExpirationTime(claims.expiresIn ?? '1h')
    .sign(key);
}
