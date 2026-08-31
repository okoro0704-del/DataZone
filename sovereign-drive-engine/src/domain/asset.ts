/**
 * Domain entities for Sovereign Drive assets, ACLs, and provenance.
 */

export type AclPermission = 'read' | 'write' | 'admin';

export interface AclEntry {
  /** Trust ID principal: user:<id> | tenant:<id> | role:<name> */
  principal: string;
  permission: AclPermission;
}

export interface AssetProvenance {
  source?: string;
  shell?: string;
  classification?: string;
  tags?: Record<string, string>;
}

export interface AssetRecord {
  assetId: string;
  tenantId: string;
  ownerUserId: string;
  objectKey: string;
  contentType: string;
  filename?: string;
  hash: string;
  sizeBytes: number;
  private: boolean;
  encrypted: boolean;
  /** Base64-wrapped DEK (envelope encryption) */
  wrappedDek: string;
  /** IV used when wrapping the DEK */
  dekIv: string;
  acl: AclEntry[];
  provenance: AssetProvenance;
  createdAt: string;
  deletedAt?: string;
}

export interface UploadResult {
  asset: AssetRecord;
  url: string;
}
