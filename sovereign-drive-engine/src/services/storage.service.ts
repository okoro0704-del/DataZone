import { randomUUID } from 'node:crypto';
import type { StoredAsset, UploadAssetOptions } from '@hospitalityos/shared';
import type { AppConfig } from '../config/index.js';
import type { AssetRecord, UploadResult } from '../domain/index.js';
import { AssetRepository } from '../domain/asset.repository.js';
import { AclService, type TrustPrincipal } from './acl.service.js';
import { LocalDiskDriver, S3R2Driver, type StorageDriver } from './drivers/index.js';
import { KmsService } from './kms.service.js';

export class StorageService {
  readonly driver: StorageDriver;
  readonly kms: KmsService;
  readonly acl: AclService;
  readonly repo: AssetRepository;

  constructor(private readonly config: AppConfig) {
    this.kms = new KmsService(config.kms);
    this.acl = new AclService(config.auth);
    this.repo = new AssetRepository(
      config.storage.driver === 'local'
        ? config.storage.localRoot
        : './storage-data',
    );
    this.driver = this.createDriver();
  }

  private createDriver(): StorageDriver {
    if (this.config.storage.driver === 'local') {
      return new LocalDiskDriver(this.config.storage.localRoot);
    }
    return new S3R2Driver(this.config.storage);
  }

  async upload(fileBuffer: Buffer, options: UploadAssetOptions): Promise<UploadResult> {
    const assetId = randomUUID();
    const hash = this.kms.sha256(fileBuffer);
    const isPrivate = options.private !== false;

    const envelope = this.kms.encrypt(fileBuffer, options.tenantId);
    const objectKey = `${options.tenantId}/${assetId}`;

    // Store ciphertext + content IV prefix for decrypt round-trip
    const storedBody = Buffer.concat([
      Buffer.from(envelope.contentIv, 'base64'),
      envelope.ciphertext,
    ]);

    await this.driver.putObject({
      key: objectKey,
      body: storedBody,
      contentType: 'application/octet-stream',
      metadata: {
        'x-asset-id': assetId,
        'x-content-type': options.contentType,
        'x-hash': hash,
      },
    });

    const asset: AssetRecord = {
      assetId,
      tenantId: options.tenantId,
      ownerUserId: options.userId,
      objectKey,
      contentType: options.contentType,
      filename: options.filename,
      hash,
      sizeBytes: fileBuffer.length,
      private: isPrivate,
      encrypted: true,
      wrappedDek: envelope.wrappedDek,
      dekIv: envelope.dekIv,
      acl: this.acl.buildDefaultAcl(options.userId, options.tenantId, options.readers ?? []),
      provenance: {
        tags: options.metadata,
        shell: options.metadata?.shell,
        classification: options.metadata?.classification,
      },
      createdAt: new Date().toISOString(),
    };

    await this.repo.save(asset);

    const url = this.acl.createSignedUrl(
      this.config.storage.publicBaseUrl,
      assetId,
      options.tenantId,
    );

    return { asset, url };
  }

  toStoredAsset(result: UploadResult): StoredAsset {
    const { asset, url } = result;
    return {
      assetId: asset.assetId,
      url,
      hash: asset.hash,
      sizeBytes: asset.sizeBytes,
      contentType: asset.contentType,
      tenantId: asset.tenantId,
      createdAt: asset.createdAt,
      encrypted: asset.encrypted,
    };
  }

  async getDownloadUrl(assetId: string, principal: TrustPrincipal): Promise<string> {
    const asset = await this.repo.get(assetId);
    if (!asset || asset.deletedAt) {
      throw Object.assign(new Error('Asset not found'), { status: 404 });
    }
    if (!this.acl.canAccess(asset, principal, 'read')) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return this.acl.createSignedUrl(
      this.config.storage.publicBaseUrl,
      asset.assetId,
      asset.tenantId,
    );
  }

  async getAssetBytes(
    assetId: string,
    opts: {
      principal?: TrustPrincipal;
      signed?: { tenantId: string; exp: number; sig: string };
    },
  ): Promise<{ body: Buffer; contentType: string; asset: AssetRecord }> {
    const asset = await this.repo.get(assetId);
    if (!asset || asset.deletedAt) {
      throw Object.assign(new Error('Asset not found'), { status: 404 });
    }

    let allowed = false;
    if (opts.signed) {
      allowed = this.acl.verifySignedUrl(
        assetId,
        opts.signed.tenantId,
        opts.signed.exp,
        opts.signed.sig,
      ) && opts.signed.tenantId === asset.tenantId;
    }
    if (!allowed && opts.principal) {
      allowed = this.acl.canAccess(asset, opts.principal, 'read');
    }
    if (!allowed) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }

    const obj = await this.driver.getObject(asset.objectKey);
    const contentIv = obj.body.subarray(0, 12).toString('base64');
    const ciphertextWithTag = obj.body.subarray(12);
    const plaintext = this.kms.decrypt(
      ciphertextWithTag,
      asset.tenantId,
      asset.wrappedDek,
      asset.dekIv,
      contentIv,
    );

    return { body: plaintext, contentType: asset.contentType, asset };
  }

  async delete(assetId: string, principal: TrustPrincipal): Promise<boolean> {
    const asset = await this.repo.get(assetId);
    if (!asset || asset.deletedAt) return false;
    if (!this.acl.canAccess(asset, principal, 'admin')) {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    }

    // Soft-delete in catalog; async lifecycle can hard-delete object later
    const marked = await this.repo.softDelete(assetId);
    if (marked) {
      await this.driver.deleteObject(asset.objectKey).catch(() => undefined);
    }
    return marked;
  }
}
