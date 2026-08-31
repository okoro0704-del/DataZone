export interface DataZoneConfig {
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  sovereignDriveBaseUrl: string;
  omniHubBaseUrl: string;
  metaGraphBaseUrl: string;
  liveOsBaseUrl: string;
  cdnSigningSecret: string;
  cdnBaseUrl: string;
  signedUrlTtlSeconds: number;
  uploadSigningSecret: string;
  watermarkSecret: string;
  uploadIntentTtlSeconds: number;
  trustId: {
    issuer: string;
    audience: string;
    jwtSecret: string;
  };
  /** When true, Meta Graph / LiveOS calls are simulated (no network). */
  dryRunPublishing: boolean;
}

export function loadConfig(): DataZoneConfig {
  return {
    port: Number(process.env.PORT ?? 4200),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4200',
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/datazone',
    sovereignDriveBaseUrl:
      process.env.SOVEREIGN_DRIVE_BASE_URL ?? 'http://localhost:4100',
    omniHubBaseUrl: process.env.OMNIHUB_BASE_URL ?? 'http://localhost:4300',
    metaGraphBaseUrl: process.env.META_GRAPH_BASE_URL ?? 'https://graph.facebook.com/v21.0',
    liveOsBaseUrl: process.env.LIVE_OS_BASE_URL ?? 'http://localhost:4400',
    cdnSigningSecret: process.env.CDN_SIGNING_SECRET ?? 'dev-cdn-signing-secret-change-me',
    cdnBaseUrl: process.env.CDN_BASE_URL ?? 'http://localhost:4200/cdn',
    signedUrlTtlSeconds: Number(process.env.CDN_URL_TTL_SECONDS ?? 900),
    uploadSigningSecret: process.env.UPLOAD_SIGNING_SECRET ?? 'dev-upload-signing-secret',
    watermarkSecret: process.env.WATERMARK_SECRET ?? 'dev-watermark-secret',
    uploadIntentTtlSeconds: Number(process.env.UPLOAD_INTENT_TTL_SECONDS ?? 900),
    trustId: {
      issuer: process.env.TRUST_ID_ISSUER ?? 'https://trust-id.local',
      audience: process.env.TRUST_ID_AUDIENCE ?? 'data-zone',
      jwtSecret: process.env.TRUST_ID_JWT_SECRET ?? 'dev-trust-id-secret-change-me',
    },
    dryRunPublishing: process.env.DRY_RUN_PUBLISHING !== 'false',
  };
}
