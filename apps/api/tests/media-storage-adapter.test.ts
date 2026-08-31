import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import {
  createApp,
  issueTrustIdToken,
  type AppConfig,
  type SovereignDriveApp,
} from 'sovereign-drive-engine';
import { RemoteSovereignDriveAdapter } from '../src/services/media-storage-adapter.js';

function baseConfig(localRoot: string, publicBaseUrl: string): AppConfig {
  return {
    port: 0,
    storage: {
      driver: 'local',
      localRoot,
      bucket: 'test',
      region: 'auto',
      forcePathStyle: true,
      publicBaseUrl,
    },
    kms: {
      masterKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      algorithm: 'aes-256-gcm',
    },
    auth: {
      trustIdIssuer: 'https://trust-id.local',
      trustIdAudience: 'sovereign-drive',
      jwtSecret: 'test-jwt-secret',
      signedUrlSecret: 'test-signed-url-secret',
      signedUrlTtlSeconds: 900,
    },
  };
}

describe('RemoteSovereignDriveAdapter (HospitalityOS)', () => {
  let ctx: SovereignDriveApp;
  let dataDir: string;
  let server: Server;
  let baseUrl: string;
  let adapter: RemoteSovereignDriveAdapter;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'sd-api-'));
    ctx = createApp(baseConfig(dataDir, 'http://127.0.0.1'));
    await new Promise<void>((resolve) => {
      server = ctx.app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
    ctx.config.storage.publicBaseUrl = baseUrl;

    const token = await issueTrustIdToken(ctx.config.auth, {
      userId: 'hos-user',
      tenantId: 'hos-tenant',
    });

    adapter = new RemoteSovereignDriveAdapter({
      baseUrl,
      getAccessToken: async () => token,
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('uploads, fetches download URL, and deletes via IStorageProvider', async () => {
    const fileBuffer = Buffer.from('hospitality-menu-asset');

    const stored = await adapter.upload(fileBuffer, {
      contentType: 'image/webp',
      filename: 'dish.webp',
      tenantId: 'hos-tenant',
      userId: 'hos-user',
      private: true,
      metadata: { shell: 'HospitalityOS', classification: 'menu' },
    });

    expect(stored.assetId).toBeTruthy();
    expect(stored.hash).toHaveLength(64);
    expect(stored.sizeBytes).toBe(fileBuffer.length);
    expect(stored.url).toContain(stored.assetId);

    const url = await adapter.getDownloadUrl(stored.assetId);
    expect(url).toContain('/content');
    expect(url).toContain('sig=');

    const content = await fetch(url);
    expect(content.ok).toBe(true);
    const bytes = Buffer.from(await content.arrayBuffer());
    expect(bytes).toEqual(fileBuffer);

    const deleted = await adapter.delete(stored.assetId);
    expect(deleted).toBe(true);

    await expect(adapter.getDownloadUrl(stored.assetId)).rejects.toThrow(/404|not found/i);
  });

  it('denies adapter calls when Trust ID tenant does not own the asset', async () => {
    const stored = await adapter.upload(Buffer.from('private-doc'), {
      contentType: 'application/pdf',
      tenantId: 'hos-tenant',
      userId: 'hos-user',
    });

    const outsiderToken = await issueTrustIdToken(ctx.config.auth, {
      userId: 'outsider',
      tenantId: 'other-tenant',
    });
    const outsider = new RemoteSovereignDriveAdapter({
      baseUrl,
      getAccessToken: async () => outsiderToken,
    });

    await expect(outsider.getDownloadUrl(stored.assetId)).rejects.toThrow(/403|Forbidden/i);
  });
});
