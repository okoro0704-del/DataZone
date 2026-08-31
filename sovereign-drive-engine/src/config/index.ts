/**
 * Sovereign Drive runtime configuration.
 * Drivers: local (dev) | s3 | r2 (production).
 */
export type StorageDriverKind = 'local' | 's3' | 'r2';

export interface StorageConfig {
  driver: StorageDriverKind;
  localRoot: string;
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

export interface KmsConfig {
  /** Master key material (hex or base64). Dev-only local KMS. */
  masterKey: string;
  algorithm: 'aes-256-gcm';
}

export interface AuthConfig {
  /** JWKS or shared secret for Trust ID JWT verification */
  trustIdIssuer: string;
  trustIdAudience: string;
  jwtSecret: string;
  /** HMAC secret for time-limited signed download URLs */
  signedUrlSecret: string;
  signedUrlTtlSeconds: number;
}

export interface AppConfig {
  port: number;
  storage: StorageConfig;
  kms: KmsConfig;
  auth: AuthConfig;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const driver = (process.env.STORAGE_DRIVER ?? 'local') as StorageDriverKind;

  return {
    port: Number(process.env.PORT ?? 4100),
    storage: {
      driver,
      localRoot: process.env.STORAGE_LOCAL_ROOT ?? './storage-data',
      bucket: process.env.STORAGE_BUCKET ?? 'sovereign-drive',
      region: process.env.STORAGE_REGION ?? 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4100',
    },
    kms: {
      masterKey:
        process.env.KMS_MASTER_KEY ??
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      algorithm: 'aes-256-gcm',
    },
    auth: {
      trustIdIssuer: process.env.TRUST_ID_ISSUER ?? 'https://trust-id.local',
      trustIdAudience: process.env.TRUST_ID_AUDIENCE ?? 'sovereign-drive',
      jwtSecret: process.env.TRUST_ID_JWT_SECRET ?? 'dev-trust-id-secret-change-me',
      signedUrlSecret: process.env.SIGNED_URL_SECRET ?? 'dev-signed-url-secret-change-me',
      signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS ?? 900),
    },
  };
}

/** Soft env helper for optional values (kept for future KMS providers). */
export { env };
