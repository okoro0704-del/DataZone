import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type SovereignDriveApp } from '../src/app.js';
import type { AppConfig } from '../src/config/index.js';
import { issueTrustIdToken } from '../src/middleware/auth.js';

function baseConfig(localRoot: string): AppConfig {
  return {
    port: 0,
    storage: {
      driver: 'local',
      localRoot,
      bucket: 'test',
      region: 'auto',
      forcePathStyle: true,
      publicBaseUrl: 'http://localhost:4100',
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

describe('Sovereign Drive primitive API', () => {
  let ctx: SovereignDriveApp;
  let dataDir: string;
  let ownerToken: string;
  let otherTenantToken: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'sd-'));
    ctx = createApp(baseConfig(dataDir));
    ownerToken = await issueTrustIdToken(ctx.config.auth, {
      userId: 'user-owner',
      tenantId: 'tenant-a',
    });
    otherTenantToken = await issueTrustIdToken(ctx.config.auth, {
      userId: 'user-other',
      tenantId: 'tenant-b',
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('uploads a file and returns a valid StoredAsset payload', async () => {
    const payload = Buffer.from('menu-photo-bytes');

    const res = await request(ctx.app)
      .post('/v1/storage/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', payload, { filename: 'menu.png', contentType: 'image/png' })
      .field('contentType', 'image/png')
      .expect(201);

    expect(res.body.assetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.body.url).toContain(`/v1/storage/asset/${res.body.assetId}/content`);
    expect(res.body.hash).toHaveLength(64);
    expect(res.body.sizeBytes).toBe(payload.length);
    expect(res.body.encrypted).toBe(true);
    expect(res.body.tenantId).toBe('tenant-a');
  });

  it('rejects unauthenticated uploads', async () => {
    await request(ctx.app)
      .post('/v1/storage/upload')
      .attach('file', Buffer.from('x'), 'x.bin')
      .expect(401);
  });

  it('blocks cross-tenant download URL access', async () => {
    const upload = await request(ctx.app)
      .post('/v1/storage/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('secret-lease'), {
        filename: 'lease.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    await request(ctx.app)
      .get(`/v1/storage/asset/${upload.body.assetId}`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .expect(403);
  });

  it('allows owner to obtain a signed download URL and stream bytes', async () => {
    const payload = Buffer.from('guest-id-scan');
    const upload = await request(ctx.app)
      .post('/v1/storage/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', payload, { filename: 'id.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const dl = await request(ctx.app)
      .get(`/v1/storage/asset/${upload.body.assetId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(dl.body.url).toContain('sig=');

    const contentPath = new URL(dl.body.url).pathname + new URL(dl.body.url).search;
    const content = await request(ctx.app).get(contentPath).expect(200);
    expect(Buffer.from(content.body)).toEqual(payload);
  });

  it('rejects forged or expired signed URLs', async () => {
    const upload = await request(ctx.app)
      .post('/v1/storage/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('x'), 'x.bin')
      .expect(201);

    await request(ctx.app)
      .get(`/v1/storage/asset/${upload.body.assetId}/content`)
      .query({ exp: Math.floor(Date.now() / 1000) + 60, tenantId: 'tenant-a', sig: 'deadbeef' })
      .expect(403);
  });

  it('deletes an asset for the owner and hides it afterwards', async () => {
    const upload = await request(ctx.app)
      .post('/v1/storage/upload')
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('tmp'), 'tmp.bin')
      .expect(201);

    await request(ctx.app)
      .delete(`/v1/storage/asset/${upload.body.assetId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    await request(ctx.app)
      .get(`/v1/storage/asset/${upload.body.assetId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });
});
