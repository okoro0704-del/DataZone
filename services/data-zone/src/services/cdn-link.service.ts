import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DataZoneConfig } from '../config.js';

/**
 * Timed CDN download links for raw + rendered media.
 * Signature: HMAC-SHA256(assetId.exp) — verified by /cdn/:assetId gateway.
 */
export class CdnLinkService {
  constructor(private readonly config: DataZoneConfig) {}

  createTimedUrl(assetId: string, ttlSeconds = this.config.signedUrlTtlSeconds): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = createHmac('sha256', this.config.cdnSigningSecret)
      .update(`${assetId}.${exp}`)
      .digest('hex');
    const url = new URL(`${this.config.cdnBaseUrl}/${assetId}`);
    url.searchParams.set('exp', String(exp));
    url.searchParams.set('sig', sig);
    return url.toString();
  }

  verify(assetId: string, exp: number, sig: string): boolean {
    if (exp < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', this.config.cdnSigningSecret)
      .update(`${assetId}.${exp}`)
      .digest('hex');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(sig, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
