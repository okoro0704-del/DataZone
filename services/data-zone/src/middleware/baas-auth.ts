import type { NextFunction, Response } from 'express';
import { prisma } from '@datazone/db';
import type { DataZoneConfig } from '../config.js';
import type { AuthedRequest } from './auth.js';
import { BaasCrypto } from '../services/baas-crypto.js';

export interface BaasContext {
  apiKeyId: string;
  keyId: string;
  tenantId: string;
  ownerTid: string;
  scopes: string[];
}

export interface BaasRequest extends AuthedRequest {
  baas?: BaasContext;
}

/**
 * Authenticates developer API key (X-Api-Key / Authorization: ApiKey)
 * AND optional user $TID passkey JWT (Authorization: Bearer) when required.
 */
export function createBaasAuthMiddleware(config: DataZoneConfig, opts?: { requireTid?: boolean }) {
  const crypto = new BaasCrypto(config);
  const requireTid = opts?.requireTid !== false;

  return async function baasAuth(req: BaasRequest, res: Response, next: NextFunction): Promise<void> {
    const rawKey =
      (req.headers['x-api-key'] as string | undefined) ??
      (req.headers.authorization?.startsWith('ApiKey ')
        ? req.headers.authorization.slice('ApiKey '.length)
        : undefined);

    if (!rawKey) {
      res.status(401).json({ error: 'Missing developer API key' });
      return;
    }

    // Format: keyId.secret  OR  keyId:secret
    const sep = rawKey.includes('.') ? '.' : ':';
    const [keyId, ...rest] = rawKey.split(sep);
    const secret = rest.join(sep);
    if (!keyId || !secret) {
      res.status(401).json({ error: 'Invalid API key format (expected keyId.secret)' });
      return;
    }

    const record = await prisma.developerApiKey.findUnique({ where: { keyId } });
    if (!record || !record.active || record.revokedAt) {
      res.status(401).json({ error: 'Unknown or revoked API key' });
      return;
    }
    if (!crypto.verifyApiSecret(secret, record.secretHash)) {
      res.status(401).json({ error: 'Invalid API key secret' });
      return;
    }

    await prisma.developerApiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });

    req.baas = {
      apiKeyId: record.id,
      keyId: record.keyId,
      tenantId: record.tenantId,
      ownerTid: record.ownerTid,
      scopes: record.scopes,
    };

    // User $TID passkey — Bearer JWT (same Trust ID verifier as shell auth)
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : (req.headers['x-tid-passkey'] as string | undefined);

    if (bearer) {
      try {
        const { createSecretKey } = await import('node:crypto');
        const jose = await import('jose');
        const key = createSecretKey(Buffer.from(config.trustId.jwtSecret));
        const { payload } = await jose.jwtVerify(bearer, key, {
          issuer: config.trustId.issuer,
          audience: config.trustId.audience,
        });
        const userId = String(payload.sub ?? '');
        const tenantId = String(payload.tid ?? payload.tenantId ?? record.tenantId);
        if (!userId) {
          res.status(401).json({ error: 'Invalid $TID passkey claims' });
          return;
        }
        req.principal = {
          userId,
          tenantId,
          roles: Array.isArray(payload.roles) ? payload.roles.map(String) : undefined,
        };
      } catch {
        res.status(401).json({ error: 'Invalid or expired $TID passkey' });
        return;
      }
    } else if (requireTid) {
      res.status(401).json({ error: 'Missing user $TID passkey (Authorization: Bearer)' });
      return;
    }

    next();
  };
}

export function requireScope(scope: string) {
  return (req: BaasRequest, res: Response, next: NextFunction): void => {
    if (!req.baas?.scopes.includes(scope) && !req.baas?.scopes.includes('*')) {
      res.status(403).json({ error: `API key missing scope: ${scope}` });
      return;
    }
    next();
  };
}
