import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../config/index.js';
import type { AclEntry, AclPermission, AssetRecord } from '../domain/index.js';

export interface TrustPrincipal {
  userId: string;
  tenantId: string;
  roles?: string[];
}

export interface SignedUrlPayload {
  assetId: string;
  tenantId: string;
  exp: number;
}

/**
 * Multi-tenant ACL enforcement + HMAC signed download URLs.
 *
 * Principals:
 *   - user:<userId>
 *   - tenant:<tenantId>  (any authenticated member of the tenant)
 *   - role:<roleName>
 *
 * Signed URLs are time-limited and bind assetId + tenantId so they cannot be
 * replayed against another object.
 */
export class AclService {
  constructor(private readonly config: AuthConfig) {}

  buildDefaultAcl(ownerUserId: string, tenantId: string, readers: string[] = []): AclEntry[] {
    const entries: AclEntry[] = [
      { principal: `user:${ownerUserId}`, permission: 'admin' },
      { principal: `tenant:${tenantId}`, permission: 'read' },
    ];

    for (const reader of readers) {
      const principal = reader.includes(':') ? reader : `user:${reader}`;
      if (!entries.some((e) => e.principal === principal)) {
        entries.push({ principal, permission: 'read' });
      }
    }

    return entries;
  }

  canAccess(
    asset: AssetRecord,
    principal: TrustPrincipal,
    required: AclPermission = 'read',
  ): boolean {
    if (asset.deletedAt) return false;
    if (asset.tenantId !== principal.tenantId) return false;

    if (!asset.private) {
      return required === 'read' || this.hasPermission(asset, principal, required);
    }

    return this.hasPermission(asset, principal, required);
  }

  hasPermission(
    asset: AssetRecord,
    principal: TrustPrincipal,
    required: AclPermission,
  ): boolean {
    const rank: Record<AclPermission, number> = { read: 1, write: 2, admin: 3 };
    const needed = rank[required];

    const candidates = new Set<string>([
      `user:${principal.userId}`,
      `tenant:${principal.tenantId}`,
      ...(principal.roles ?? []).map((r) => `role:${r}`),
    ]);

    return asset.acl.some(
      (entry) => candidates.has(entry.principal) && rank[entry.permission] >= needed,
    );
  }

  createSignedUrl(
    baseUrl: string,
    assetId: string,
    tenantId: string,
    ttlSeconds = this.config.signedUrlTtlSeconds,
  ): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${assetId}.${tenantId}.${exp}`;
    const sig = createHmac('sha256', this.config.signedUrlSecret)
      .update(payload)
      .digest('hex');

    const url = new URL(`${baseUrl}/v1/storage/asset/${assetId}/content`);
    url.searchParams.set('exp', String(exp));
    url.searchParams.set('tenantId', tenantId);
    url.searchParams.set('sig', sig);
    return url.toString();
  }

  verifySignedUrl(assetId: string, tenantId: string, exp: number, sig: string): boolean {
    if (exp < Math.floor(Date.now() / 1000)) return false;

    const payload = `${assetId}.${tenantId}.${exp}`;
    const expected = createHmac('sha256', this.config.signedUrlSecret)
      .update(payload)
      .digest('hex');

    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(sig, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
