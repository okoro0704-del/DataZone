import type {
  DataZoneClientOptions,
  DistributeOptions,
  DistributeResult,
  LicensePolicyInput,
  LicensePolicyResult,
  RenderResult,
  RevokeResult,
  UploadAssetOptions,
  UploadedAsset,
} from './types.js';

/**
 * Data Zone BaaS developer client.
 *
 * @example
 * ```ts
 * const dz = new DataZoneClient({
 *   baseUrl: 'http://localhost:4200',
 *   apiKey: 'dz_live_….dz_sec_…',
 *   getTidPasskey: async () => trustIdJwt,
 * });
 * const asset = await dz.uploadAsset(file, { filename: 'reel.mp4' });
 * await dz.setLicensing(asset.assetId, {
 *   isPublic: false,
 *   allowReuse: false,
 *   allowedPlatforms: ['LIVE_OS', 'INSTAGRAM'],
 *   monetizationTerms: 'royalty-share-10',
 *   expirationTimestamp: null,
 * });
 * ```
 */
export class DataZoneClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly getTidPasskey: () => Promise<string>;
  private readonly fetchFn: typeof fetch;

  constructor(options: DataZoneClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.getTidPasskey = options.getTidPasskey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async authHeaders(json = true): Promise<HeadersInit> {
    const tid = await this.getTidPasskey();
    const headers: Record<string, string> = {
      'X-Api-Key': this.apiKey,
      Authorization: `Bearer ${tid}`,
    };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  /**
   * Direct client-to-vault multipart upload.
   * 1) Creates a presigned upload intent
   * 2) PUTs/POSTs the file to the encrypted upload endpoint
   * 3) Returns an immutable `assetId`
   */
  async uploadAsset(
    file: Blob | ArrayBuffer | Uint8Array,
    options: UploadAssetOptions = {},
  ): Promise<UploadedAsset> {
    const mimeType =
      options.mimeType ??
      (typeof Blob !== 'undefined' && file instanceof Blob ? file.type : undefined) ??
      'application/octet-stream';
    const filename = options.filename ?? 'upload.bin';

    const intentRes = await this.fetchFn(`${this.baseUrl}/v1/baas/assets/upload-intent`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        filename,
        mimeType,
        maxSizeBytes: options.maxSizeBytes,
        deviceSignature: options.deviceSignature,
        parentAssetId: options.parentAssetId,
      }),
    });
    if (!intentRes.ok) {
      throw new Error(`upload-intent failed (${intentRes.status}): ${await intentRes.text()}`);
    }
    const intent = (await intentRes.json()) as { uploadUrl: string; intentId: string };

    let bytes: Blob;
    if (typeof Blob !== 'undefined' && file instanceof Blob) {
      bytes = file;
    } else if (file instanceof ArrayBuffer) {
      bytes = new Blob([file], { type: mimeType });
    } else {
      const view = file as Uint8Array;
      const copy = new Uint8Array(view.byteLength);
      copy.set(view);
      bytes = new Blob([copy.buffer], { type: mimeType });
    }

    const form = new FormData();
    form.append('file', bytes, filename);
    if (options.parentAssetId) form.append('parentAssetId', options.parentAssetId);

    const uploadRes = await this.fetchFn(intent.uploadUrl, {
      method: 'POST',
      body: form,
    });
    if (!uploadRes.ok) {
      throw new Error(`upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
    }

    const body = (await uploadRes.json()) as Omit<UploadedAsset, 'immutable'> & {
      immutable?: boolean;
    };
    return { ...body, immutable: true };
  }

  /**
   * Attach or replace a license / permission policy on an asset.
   */
  async setLicensing(
    assetId: string,
    policy: LicensePolicyInput,
  ): Promise<LicensePolicyResult> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/baas/assets/${assetId}/license`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        isPublic: policy.isPublic ?? false,
        allowReuse: policy.allowReuse ?? false,
        canReshare: policy.canReshare ?? policy.allowReuse ?? false,
        allowedPlatforms: policy.allowedPlatforms,
        monetizationTerms: policy.monetizationTerms,
        royaltyFeeVidCap: policy.royaltyFeeVidCap ?? 0,
        expirationTimestamp: policy.expirationTimestamp ?? null,
      }),
    });
    if (!res.ok) {
      throw new Error(`setLicensing failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as LicensePolicyResult;
  }

  /** Trigger render + multi-channel distribution. */
  async distribute(assetId: string, options: DistributeOptions): Promise<DistributeResult> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/baas/assets/${assetId}/distribute`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      throw new Error(`distribute failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as DistributeResult;
  }

  /** Fetch HLS / image render with lineage + watermark headers. */
  async getRender(assetId: string): Promise<RenderResult> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/baas/assets/${assetId}/render`, {
      method: 'GET',
      headers: await this.authHeaders(false),
    });
    if (!res.ok) {
      throw new Error(`render failed (${res.status}): ${await res.text()}`);
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const headers = {
      watermark: res.headers.get('x-datazone-watermark'),
      originHash: res.headers.get('x-datazone-origin-hash'),
      creatorTid: res.headers.get('x-datazone-creator-tid'),
      lineage: res.headers.get('x-datazone-lineage'),
    };
    if (contentType.includes('application/json')) {
      return { body: (await res.json()) as Record<string, unknown>, contentType, headers };
    }
    return { body: await res.text(), contentType, headers };
  }

  /** Instantly revoke asset everywhere (CDN + platforms + webhooks). */
  async revoke(assetId: string, reason?: string): Promise<RevokeResult> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/baas/assets/${assetId}/revoke`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      throw new Error(`revoke failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as RevokeResult;
  }
}

export type {
  DataZoneClientOptions,
  DistributeChannel,
  DistributeOptions,
  DistributeResult,
  LicensePolicyInput,
  LicensePolicyResult,
  RenderResult,
  RevokeResult,
  UploadAssetOptions,
  UploadedAsset,
} from './types.js';
