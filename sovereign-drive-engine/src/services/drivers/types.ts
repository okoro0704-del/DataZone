/**
 * Pluggable object storage drivers for Sovereign Drive.
 */
export interface PutObjectParams {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  body: Buffer;
  contentType?: string;
}

export interface StorageDriver {
  readonly name: string;
  putObject(params: PutObjectParams): Promise<void>;
  getObject(key: string): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
