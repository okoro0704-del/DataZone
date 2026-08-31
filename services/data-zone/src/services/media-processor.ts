import {
  prisma,
  type PlatformTarget,
  type RenderPreset,
} from '@datazone/db';
import type { DataZoneConfig } from '../config.js';
import { renderQueue, type RenderJobPayload } from '../queue/render.queue.js';
import { CdnLinkService } from './cdn-link.service.js';

export interface RegisterMasterInput {
  sovereignAssetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  originalUrl?: string;
  tidOwner: string;
  tenantId: string;
  checksumSha256?: string;
  /** Preset codes to auto-render after ingest */
  autoRenderPresets?: PlatformTarget[];
}

/**
 * Media Processing & Delivery Engine.
 *
 * Production path:
 *  1. Pull master bytes from Sovereign Drive (signed URL).
 *  2. FFmpeg (video) / sharp (image) → platform crop + encode.
 *  3. Re-upload variant to Sovereign Drive; persist MediaAsset row.
 *  4. Emit timed CDN links for raw + rendered variants.
 *
 * This module ships executable stubs that record render intent and create
 * READY variant rows with synthetic dimensions so the Drive UI and
 * distribution router can be exercised end-to-end without ffmpeg binaries.
 */
export class MediaProcessor {
  readonly cdn: CdnLinkService;

  constructor(config: DataZoneConfig) {
    this.cdn = new CdnLinkService(config);
    renderQueue.onProcess((job) => this.processRenderJob(job));
  }

  async registerMaster(input: RegisterMasterInput) {
    const kind = mimeToKind(input.mimeType);
    const master = await prisma.mediaAsset.create({
      data: {
        sovereignAssetId: input.sovereignAssetId,
        filename: input.filename,
        originalUrl: input.originalUrl,
        mimeType: input.mimeType,
        kind,
        sizeBytes: BigInt(input.sizeBytes),
        width: input.width,
        height: input.height,
        durationMs: input.durationMs,
        encryptionState: 'ENCRYPTED_ESFS',
        tidOwner: input.tidOwner,
        tenantId: input.tenantId,
        checksumSha256: input.checksumSha256,
        renderStatus: 'READY',
      },
    });

    const presets =
      input.autoRenderPresets ??
      (kind === 'VIDEO'
        ? (['INSTAGRAM_REEL', 'YOUTUBE_SHORTS', 'FB_FEED'] as PlatformTarget[])
        : (['FB_FEED', 'INSTAGRAM_FEED'] as PlatformTarget[]));

    for (const code of presets) {
      await this.enqueueRender(master.id, code, input.tidOwner, input.tenantId);
    }

    return master;
  }

  async enqueueRender(
    masterAssetId: string,
    presetCode: PlatformTarget | string,
    tidOwner: string,
    tenantId: string,
  ): Promise<void> {
    await prisma.mediaAsset.update({
      where: { id: masterAssetId },
      data: { renderStatus: 'QUEUED' },
    });
    await renderQueue.enqueue({
      masterAssetId,
      presetCode: String(presetCode),
      tidOwner,
      tenantId,
    });
  }

  async processRenderJob(job: RenderJobPayload): Promise<void> {
    const master = await prisma.mediaAsset.findUnique({
      where: { id: job.masterAssetId },
    });
    if (!master || master.deletedAt) return;

    const preset = await prisma.renderPreset.findUnique({
      where: { code: job.presetCode as PlatformTarget },
    });
    if (!preset || !preset.active) {
      await prisma.mediaAsset.update({
        where: { id: master.id },
        data: { renderStatus: 'FAILED' },
      });
      return;
    }

    await prisma.mediaAsset.update({
      where: { id: master.id },
      data: { renderStatus: 'RENDERING' },
    });

    try {
      const rendered = await this.runFfmpegOrSharpStub(master, preset);
      await prisma.mediaAsset.create({
        data: {
          sovereignAssetId: rendered.sovereignAssetId,
          filename: rendered.filename,
          originalUrl: rendered.cdnUrl,
          mimeType: preset.outputMime,
          kind: master.kind,
          sizeBytes: BigInt(rendered.sizeBytes),
          width: preset.width,
          height: preset.height,
          durationMs: master.durationMs,
          encryptionState: 'ENCRYPTED_ESFS',
          tidOwner: job.tidOwner,
          tenantId: job.tenantId,
          masterAssetId: master.id,
          renderPresetId: preset.id,
          renderStatus: 'READY',
          metadata: {
            fitMode: preset.fitMode,
            source: 'ffmpeg-sharp-stub',
            command: rendered.command,
          },
        },
      });

      await prisma.mediaAsset.update({
        where: { id: master.id },
        data: { renderStatus: 'READY' },
      });
    } catch (err) {
      await prisma.mediaAsset.update({
        where: { id: master.id },
        data: { renderStatus: 'FAILED' },
      });
      throw err;
    }
  }

  /**
   * FFmpeg / sharp queue stub.
   * Replace body with real child_process ffmpeg / sharp pipeline.
   *
   * Example FFmpeg crop-to-cover:
   *   ffmpeg -i master.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:v libx264 -b:v 5M out.mp4
   *
   * Example sharp:
   *   sharp(buf).resize(1080, 1080, { fit: 'cover' }).jpeg().toBuffer()
   */
  private async runFfmpegOrSharpStub(
    master: { id: string; filename: string; mimeType: string; sizeBytes: bigint },
    preset: RenderPreset,
  ): Promise<{ sovereignAssetId: string; filename: string; sizeBytes: number; cdnUrl: string; command: string }> {
    const isVideo = master.mimeType.startsWith('video/');
    const ext = isVideo ? 'mp4' : preset.outputMime.includes('png') ? 'png' : 'jpg';
    const filename = `${stripExt(master.filename)}_${preset.code}.${ext}`;
    const sovereignAssetId = `render_${master.id}_${preset.code}_${Date.now()}`;

    const command = isVideo
      ? `ffmpeg -i "$MASTER" -vf "scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height}" -c:v libx264 -b:v ${preset.bitrateKbps ?? 5000}k -c:a aac "$OUT"`
      : `sharp(master).resize(${preset.width}, ${preset.height}, { fit: '${preset.fitMode}' }).toFormat('${ext}').toFile("$OUT")`;

    // Simulate async encode latency
    await new Promise((r) => setTimeout(r, 25));

    const sizeBytes = Math.max(1_024, Number(master.sizeBytes) / 2);
    const cdnUrl = this.cdn.createTimedUrl(sovereignAssetId);

    return { sovereignAssetId, filename, sizeBytes, cdnUrl, command };
  }

  getDownloadLink(assetId: string): string {
    return this.cdn.createTimedUrl(assetId);
  }

  async listDrive(tidOwner: string, opts: { q?: string; limit?: number } = {}) {
    const masters = await prisma.mediaAsset.findMany({
      where: {
        tidOwner,
        masterAssetId: null,
        deletedAt: null,
        ...(opts.q
          ? { filename: { contains: opts.q, mode: 'insensitive' } }
          : {}),
      },
      include: {
        variants: {
          include: { renderPreset: true },
          where: { deletedAt: null },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
    });

    const usedBytes = masters.reduce((sum, m) => sum + Number(m.sizeBytes), 0);
    return {
      assets: masters.map((m) => ({
        ...serializeAsset(m),
        variants: m.variants.map(serializeAsset),
        downloadUrl: this.cdn.createTimedUrl(m.sovereignAssetId),
      })),
      storage: {
        usedBytes,
        // Soft quota placeholder until billing ties in
        quotaBytes: 10 * 1024 * 1024 * 1024,
      },
    };
  }
}

function mimeToKind(mime: string) {
  if (mime.startsWith('video/')) return 'VIDEO' as const;
  if (mime.startsWith('image/')) return 'IMAGE' as const;
  if (mime.startsWith('audio/')) return 'AUDIO' as const;
  if (mime.includes('pdf') || mime.includes('document')) return 'DOCUMENT' as const;
  return 'OTHER' as const;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function serializeAsset(m: {
  id: string;
  sovereignAssetId: string;
  filename: string;
  originalUrl: string | null;
  mimeType: string;
  kind: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  encryptionState: string;
  tidOwner: string;
  renderStatus: string;
  renderPreset?: { code: string; width: number; height: number } | null;
  createdAt: Date;
}) {
  return {
    id: m.id,
    sovereignAssetId: m.sovereignAssetId,
    filename: m.filename,
    originalUrl: m.originalUrl,
    mimeType: m.mimeType,
    kind: m.kind,
    sizeBytes: Number(m.sizeBytes),
    width: m.width,
    height: m.height,
    durationMs: m.durationMs,
    encryptionState: m.encryptionState,
    tidOwner: m.tidOwner,
    renderStatus: m.renderStatus,
    preset: m.renderPreset
      ? {
          code: m.renderPreset.code,
          width: m.renderPreset.width,
          height: m.renderPreset.height,
        }
      : null,
    createdAt: m.createdAt.toISOString(),
  };
}
