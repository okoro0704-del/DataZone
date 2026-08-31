/**
 * Data Zone Developer BaaS SDK — types
 */

export interface DataZoneClientOptions {
  /** Base URL of the Data Zone service, e.g. https://api.datazone.example */
  baseUrl: string;
  /** Developer API key as `keyId.secret` */
  apiKey: string;
  /** Factory returning a fresh user $TID passkey JWT */
  getTidPasskey: () => Promise<string>;
  /** Optional fetch override */
  fetchFn?: typeof fetch;
}

export interface UploadAssetOptions {
  filename?: string;
  mimeType?: string;
  /** Passkey / device attestation blob */
  deviceSignature?: string;
  /** Parent asset for derivative lineage */
  parentAssetId?: string;
  maxSizeBytes?: number;
}

export interface UploadedAsset {
  /** Immutable Data Zone asset id */
  assetId: string;
  sovereignAssetId: string;
  originHash: string;
  sizeBytes: number;
  immutable: true;
}

export interface LicensePolicyInput {
  isPublic?: boolean;
  allowReuse?: boolean;
  /** Alias consumed by setLicensing — maps to canReshare */
  canReshare?: boolean;
  allowedPlatforms: string[];
  monetizationTerms?: string;
  royaltyFeeVidCap?: number;
  expirationTimestamp?: string | null;
}

export interface LicensePolicyResult {
  assetId: string;
  policy: LicensePolicyInput & {
    id?: string;
    canReshare: boolean;
    royaltyFeeVidCap: number;
  };
}

export type DistributeChannel =
  | 'LIVE_OS_PERSONAL'
  | 'LIVE_OS_BUSINESS'
  | 'INSTAGRAM'
  | 'INSTAGRAM_REELS'
  | 'INSTAGRAM_REEL'
  | 'FACEBOOK'
  | 'FACEBOOK_PAGE'
  | 'YOUTUBE_SHORTS'
  | 'WEBHOOK';

export interface DistributeOptions {
  channels: DistributeChannel[];
  caption?: string;
  webhookUrl?: string;
}

export interface DistributeResult {
  assetId: string;
  jobs: Array<{
    id: string;
    platform: string;
    target: string;
    status: string;
    externalPostId: string | null;
    externalUrl: string | null;
    errorMessage: string | null;
  }>;
}

export interface RenderResult {
  /** HLS playlist text for video, or JSON image descriptor */
  body: string | Record<string, unknown>;
  contentType: string;
  headers: {
    watermark?: string | null;
    originHash?: string | null;
    creatorTid?: string | null;
    lineage?: string | null;
  };
}

export interface RevokeResult {
  assetId: string;
  cdnInvalidated: boolean;
  webhooksSent: number;
  platformsNotified: number;
  jobsRevoked: number;
}
