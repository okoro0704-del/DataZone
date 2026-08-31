/**
 * Shared storage primitive contracts for LifeOS shells
 * (HospitalityOS, Sovereign Drive, etc.).
 */

export interface UploadAssetOptions {
  /** MIME type of the payload */
  contentType: string;
  /** Optional original filename */
  filename?: string;
  /** Tenant that owns the asset */
  tenantId: string;
  /** Uploading user (Trust ID subject) */
  userId: string;
  /** When true, asset is private; downloads require ACL + signed URL */
  private?: boolean;
  /** Optional ACL principals granted read access */
  readers?: string[];
  /** Optional opaque provenance / classification tags */
  metadata?: Record<string, string>;
}

export interface StoredAsset {
  assetId: string;
  url: string;
  hash: string;
  sizeBytes: number;
  contentType: string;
  tenantId: string;
  createdAt: string;
  encrypted: boolean;
}

export interface IStorageProvider {
  upload(fileBuffer: Buffer, options: UploadAssetOptions): Promise<StoredAsset>;
  getDownloadUrl(assetId: string): Promise<string>;
  delete(assetId: string): Promise<boolean>;
}
