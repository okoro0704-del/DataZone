import { describe, expect, it } from 'vitest';
import { AclService } from '../src/services/acl.service.js';
import { KmsService } from '../src/services/kms.service.js';
import type { AssetRecord } from '../src/domain/index.js';

describe('KmsService envelope encryption', () => {
  const kms = new KmsService({
    masterKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    algorithm: 'aes-256-gcm',
  });

  it('round-trips plaintext via tenant-scoped DEK wrapping', () => {
    const plaintext = Buffer.from('room-photo-bytes');
    const env = kms.encrypt(plaintext, 'tenant-a');
    const decrypted = kms.decrypt(
      env.ciphertext,
      'tenant-a',
      env.wrappedDek,
      env.dekIv,
      env.contentIv,
    );
    expect(decrypted).toEqual(plaintext);
  });

  it('fails to decrypt under a different tenant KEK', () => {
    const env = kms.encrypt(Buffer.from('secret'), 'tenant-a');
    expect(() =>
      kms.decrypt(env.ciphertext, 'tenant-b', env.wrappedDek, env.dekIv, env.contentIv),
    ).toThrow();
  });

  it('produces stable SHA-256 hashes', () => {
    expect(kms.sha256(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('AclService', () => {
  const acl = new AclService({
    trustIdIssuer: 'https://trust-id.local',
    trustIdAudience: 'sovereign-drive',
    jwtSecret: 'x',
    signedUrlSecret: 'signed-secret',
    signedUrlTtlSeconds: 60,
  });

  const asset = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
    assetId: 'asset-1',
    tenantId: 'tenant-a',
    ownerUserId: 'owner',
    objectKey: 'tenant-a/asset-1',
    contentType: 'text/plain',
    hash: 'abc',
    sizeBytes: 3,
    private: true,
    encrypted: true,
    wrappedDek: '',
    dekIv: '',
    acl: acl.buildDefaultAcl('owner', 'tenant-a', ['reader-1']),
    provenance: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('allows same-tenant members read access by default', () => {
    expect(
      acl.canAccess(asset(), { userId: 'coworker', tenantId: 'tenant-a' }, 'read'),
    ).toBe(true);
  });

  it('denies other tenants', () => {
    expect(
      acl.canAccess(asset(), { userId: 'stranger', tenantId: 'tenant-b' }, 'read'),
    ).toBe(false);
  });

  it('creates and verifies signed URLs', () => {
    const url = acl.createSignedUrl('http://localhost:4100', 'asset-1', 'tenant-a', 120);
    const parsed = new URL(url);
    expect(
      acl.verifySignedUrl(
        'asset-1',
        parsed.searchParams.get('tenantId')!,
        Number(parsed.searchParams.get('exp')),
        parsed.searchParams.get('sig')!,
      ),
    ).toBe(true);
  });
});
