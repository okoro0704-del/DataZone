import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DataZoneConfig } from '../config.js';

export interface UploadIntentTokenPayload {
  intentId: string;
  tidOwner: string;
  tenantId: string;
  apiKeyId: string;
  exp: number;
}

/**
 * Presigned upload + CDN watermark signing for the BaaS gateway.
 */
export class BaasCrypto {
  constructor(private readonly config: DataZoneConfig) {}

  hashApiSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  verifyApiSecret(secret: string, hash: string): boolean {
    const a = Buffer.from(this.hashApiSecret(secret), 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  issueUploadToken(payload: Omit<UploadIntentTokenPayload, 'exp'>, ttlSeconds: number): {
    token: string;
    exp: number;
  } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const body = `${payload.intentId}.${payload.tidOwner}.${payload.tenantId}.${payload.apiKeyId}.${exp}`;
    const sig = createHmac('sha256', this.config.uploadSigningSecret).update(body).digest('hex');
    return { token: `${body}.${sig}`, exp };
  }

  verifyUploadToken(token: string): UploadIntentTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 6) return null;
    const [intentId, tidOwner, tenantId, apiKeyId, expStr, sig] = parts;
    const exp = Number(expStr);
    if (!intentId || !tidOwner || !tenantId || !apiKeyId || !sig || Number.isNaN(exp)) {
      return null;
    }
    if (exp < Math.floor(Date.now() / 1000)) return null;
    const body = `${intentId}.${tidOwner}.${tenantId}.${apiKeyId}.${exp}`;
    const expected = createHmac('sha256', this.config.uploadSigningSecret)
      .update(body)
      .digest('hex');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(sig, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
      return null;
    }
    return { intentId, tidOwner, tenantId, apiKeyId, exp };
  }

  /** Embedded cryptographic watermark payload for render responses. */
  watermarkToken(assetId: string, originHash: string, creatorTid: string): string {
    const nonce = randomBytes(8).toString('hex');
    const body = `${assetId}.${originHash}.${creatorTid}.${nonce}`;
    const sig = createHmac('sha256', this.config.watermarkSecret).update(body).digest('hex');
    return Buffer.from(`${body}.${sig}`).toString('base64url');
  }

  generateApiKeyPair(): { keyId: string; secret: string; secretHash: string } {
    const keyId = `dz_live_${randomBytes(8).toString('hex')}`;
    const secret = `dz_sec_${randomBytes(24).toString('hex')}`;
    return { keyId, secret, secretHash: this.hashApiSecret(secret) };
  }
}
