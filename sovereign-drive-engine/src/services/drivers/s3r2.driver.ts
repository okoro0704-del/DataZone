import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageConfig } from '../../config/index.js';
import type { GetObjectResult, PutObjectParams, StorageDriver } from './types.js';

/**
 * S3 / Cloudflare R2 driver.
 * R2 is S3-compatible — set `endpoint` to the R2 account endpoint and
 * `forcePathStyle` as required by the provider.
 */
export class S3R2Driver implements StorageDriver {
  readonly name: string;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.name = config.driver;
    this.bucket = config.bucket;

    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3/R2 driver requires STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY');
    }

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(params: PutObjectParams): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        Metadata: params.metadata,
      }),
    );
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Empty object body for key ${key}`);
    }
    return {
      body: Buffer.from(bytes),
      contentType: result.ContentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
