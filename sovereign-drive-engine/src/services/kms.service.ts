import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { KmsConfig } from '../config/index.js';

export interface Envelope {
  ciphertext: Buffer;
  /** Per-object DEK, wrapped under the tenant KEK */
  wrappedDek: string;
  dekIv: string;
  contentIv: string;
  authTag: string;
}

/**
 * Local envelope-encryption KMS.
 *
 * Protocol:
 * 1. Derive a tenant Key Encryption Key (KEK) from master key + tenantId (HKDF-like SHA-256).
 * 2. Generate a random 256-bit Data Encryption Key (DEK) per asset.
 * 3. Encrypt payload with AES-256-GCM using the DEK.
 * 4. Wrap (encrypt) the DEK with the tenant KEK; store wrappedDek + IVs with asset metadata.
 *
 * Production deployments can swap this for AWS KMS / Cloudflare Secrets without changing
 * the StorageService interface — only wrap/unwrap DEK calls change.
 */
export class KmsService {
  private readonly masterKey: Buffer;

  constructor(config: KmsConfig) {
    this.masterKey = Buffer.from(config.masterKey, 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('KMS_MASTER_KEY must be 32 bytes (64 hex chars)');
    }
  }

  deriveTenantKek(tenantId: string): Buffer {
    return createHash('sha256')
      .update(this.masterKey)
      .update(':tenant:')
      .update(tenantId)
      .digest();
  }

  encrypt(plaintext: Buffer, tenantId: string): Envelope {
    const dek = randomBytes(32);
    const contentIv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, contentIv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const kek = this.deriveTenantKek(tenantId);
    const dekIv = randomBytes(12);
    const wrapCipher = createCipheriv('aes-256-gcm', kek, dekIv);
    const wrapped = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrapTag = wrapCipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([ciphertext, authTag]),
      wrappedDek: Buffer.concat([wrapped, wrapTag]).toString('base64'),
      dekIv: dekIv.toString('base64'),
      contentIv: contentIv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  decrypt(
    ciphertextWithTag: Buffer,
    tenantId: string,
    wrappedDekB64: string,
    dekIvB64: string,
    contentIvB64: string,
  ): Buffer {
    const dek = this.unwrapDek(tenantId, wrappedDekB64, dekIvB64);
    const contentIv = Buffer.from(contentIvB64, 'base64');
    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', dek, contentIv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  unwrapDek(tenantId: string, wrappedDekB64: string, dekIvB64: string): Buffer {
    const kek = this.deriveTenantKek(tenantId);
    const wrappedFull = Buffer.from(wrappedDekB64, 'base64');
    const wrapTag = wrappedFull.subarray(wrappedFull.length - 16);
    const wrapped = wrappedFull.subarray(0, wrappedFull.length - 16);
    const dekIv = Buffer.from(dekIvB64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', kek, dekIv);
    decipher.setAuthTag(wrapTag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }

  sha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }
}
