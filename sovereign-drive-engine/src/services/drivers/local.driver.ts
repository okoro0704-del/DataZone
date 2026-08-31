import { mkdir, readFile, unlink, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { GetObjectResult, PutObjectParams, StorageDriver } from './types.js';

/**
 * Local disk driver for development and integration tests.
 * Objects are stored under `{root}/{key}` with a sibling `.meta.json` for content-type.
 */
export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error('Invalid object key (path traversal)');
    }
    return resolved;
  }

  async putObject(params: PutObjectParams): Promise<void> {
    const filePath = this.resolve(params.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, params.body);
    await writeFile(
      `${filePath}.meta.json`,
      JSON.stringify({ contentType: params.contentType, metadata: params.metadata ?? {} }),
    );
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const filePath = this.resolve(key);
    const body = await readFile(filePath);
    let contentType = 'application/octet-stream';
    try {
      const meta = JSON.parse(await readFile(`${filePath}.meta.json`, 'utf8')) as {
        contentType?: string;
      };
      contentType = meta.contentType ?? contentType;
    } catch {
      /* optional meta */
    }
    return { body, contentType };
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolve(key);
    await unlink(filePath).catch(() => undefined);
    await unlink(`${filePath}.meta.json`).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
