import {
  type IStorageProvider,
  type StoredAsset,
  type UploadAssetOptions,
} from '@hospitalityos/shared';

export interface RemoteSovereignDriveAdapterOptions {
  /** Base URL of sovereign-drive-engine, e.g. http://localhost:4100 */
  baseUrl: string;
  /** Factory that returns a fresh Trust ID bearer token for outbound calls */
  getAccessToken: () => Promise<string>;
  /** Optional fetch implementation (defaults to global fetch) */
  fetchFn?: typeof fetch;
}

/**
 * HospitalityOS remote storage adapter.
 * Implements IStorageProvider by proxying to Sovereign Drive's primitive REST API.
 */
export class RemoteSovereignDriveAdapter implements IStorageProvider {
  private readonly baseUrl: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchFn: typeof fetch;

  constructor(
    sovereignDriveBaseUrl: string | RemoteSovereignDriveAdapterOptions,
    getAccessToken?: () => Promise<string>,
  ) {
    if (typeof sovereignDriveBaseUrl === 'string') {
      this.baseUrl = sovereignDriveBaseUrl.replace(/\/$/, '');
      this.getAccessToken = getAccessToken ?? (async () => {
        throw new Error('getAccessToken is required');
      });
      this.fetchFn = fetch;
    } else {
      this.baseUrl = sovereignDriveBaseUrl.baseUrl.replace(/\/$/, '');
      this.getAccessToken = sovereignDriveBaseUrl.getAccessToken;
      this.fetchFn = sovereignDriveBaseUrl.fetchFn ?? fetch;
    }
  }

  async upload(fileBuffer: Buffer, options: UploadAssetOptions): Promise<StoredAsset> {
    const token = await this.getAccessToken();
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: options.contentType });
    form.append('file', blob, options.filename ?? 'upload.bin');
    form.append('contentType', options.contentType);
    form.append('tenantId', options.tenantId);
    form.append('private', String(options.private !== false));
    if (options.filename) form.append('filename', options.filename);
    if (options.readers?.length) form.append('readers', JSON.stringify(options.readers));
    if (options.metadata) form.append('metadata', JSON.stringify(options.metadata));

    const res = await this.fetchFn(`${this.baseUrl}/v1/storage/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Sovereign Drive upload failed (${res.status}): ${errBody}`);
    }

    return (await res.json()) as StoredAsset;
  }

  async getDownloadUrl(assetId: string): Promise<string> {
    const token = await this.getAccessToken();
    const res = await this.fetchFn(`${this.baseUrl}/v1/storage/asset/${assetId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Sovereign Drive getDownloadUrl failed (${res.status}): ${errBody}`);
    }

    const body = (await res.json()) as { url: string };
    return body.url;
  }

  async delete(assetId: string): Promise<boolean> {
    const token = await this.getAccessToken();
    const res = await this.fetchFn(`${this.baseUrl}/v1/storage/asset/${assetId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 404) return false;
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Sovereign Drive delete failed (${res.status}): ${errBody}`);
    }

    const body = (await res.json()) as { deleted: boolean };
    return Boolean(body.deleted);
  }
}
