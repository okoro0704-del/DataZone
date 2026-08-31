import type { PlatformTarget } from '@datazone/db';
import type { DataZoneConfig } from '../config.js';
import type { OmniHubToken } from './omnihub-tokens.js';

export interface PublishRequest {
  target: PlatformTarget;
  videoUrl: string;
  caption?: string;
  coverUrl?: string;
}

export interface PublishResult {
  externalPostId: string;
  externalUrl?: string;
  dryRun: boolean;
}

/**
 * Meta Graph API distribution handlers (Instagram Reels / Facebook Page & Reels).
 *
 * Flow (video):
 *  1. Create container  POST /{ig-user-id}/media  { video_url, media_type: REELS, caption }
 *  2. Poll status       GET  /{container-id}?fields=status_code
 *  3. Publish           POST /{ig-user-id}/media_publish { creation_id }
 *
 * Dry-run mode skips network and returns synthetic post ids for local/dev.
 */
export class MetaGraphPublisher {
  constructor(private readonly config: DataZoneConfig) {}

  async publish(token: OmniHubToken, req: PublishRequest): Promise<PublishResult> {
    switch (req.target) {
      case 'INSTAGRAM_REEL':
      case 'INSTAGRAM_FEED':
        return this.publishInstagram(token, req);
      case 'FACEBOOK_PAGE':
      case 'FB_FEED':
      case 'FACEBOOK_REEL':
        return this.publishFacebook(token, req);
      default:
        throw Object.assign(new Error(`Meta publisher does not handle ${req.target}`), {
          status: 400,
        });
    }
  }

  private async publishInstagram(
    token: OmniHubToken,
    req: PublishRequest,
  ): Promise<PublishResult> {
    const igUserId = token.externalAccountId;
    if (this.config.dryRunPublishing) {
      const id = `ig_dry_${Date.now()}`;
      return {
        externalPostId: id,
        externalUrl: `https://instagram.com/reel/${id}`,
        dryRun: true,
      };
    }

    const isReel = req.target === 'INSTAGRAM_REEL';
    const containerBody: Record<string, string> = {
      access_token: token.accessToken,
      caption: req.caption ?? '',
    };

    if (isReel) {
      containerBody.media_type = 'REELS';
      containerBody.video_url = req.videoUrl;
      if (req.coverUrl) containerBody.cover_url = req.coverUrl;
    } else {
      containerBody.image_url = req.videoUrl;
    }

    const containerRes = await fetch(`${this.config.metaGraphBaseUrl}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerBody),
    });
    if (!containerRes.ok) {
      throw new Error(`IG container create failed: ${await containerRes.text()}`);
    }
    const container = (await containerRes.json()) as { id: string };

    await this.waitForContainer(token.accessToken, container.id);

    const publishRes = await fetch(
      `${this.config.metaGraphBaseUrl}/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: container.id,
          access_token: token.accessToken,
        }),
      },
    );
    if (!publishRes.ok) {
      throw new Error(`IG publish failed: ${await publishRes.text()}`);
    }
    const published = (await publishRes.json()) as { id: string };
    return {
      externalPostId: published.id,
      externalUrl: `https://instagram.com/p/${published.id}`,
      dryRun: false,
    };
  }

  private async publishFacebook(
    token: OmniHubToken,
    req: PublishRequest,
  ): Promise<PublishResult> {
    const pageId = token.pageId ?? token.externalAccountId;
    if (this.config.dryRunPublishing) {
      const id = `fb_dry_${Date.now()}`;
      return {
        externalPostId: id,
        externalUrl: `https://facebook.com/${pageId}/posts/${id}`,
        dryRun: true,
      };
    }

    const isReel = req.target === 'FACEBOOK_REEL';
    const endpoint = isReel
      ? `${this.config.metaGraphBaseUrl}/${pageId}/video_reels`
      : `${this.config.metaGraphBaseUrl}/${pageId}/videos`;

    const body: Record<string, string> = {
      access_token: token.accessToken,
      description: req.caption ?? '',
      file_url: req.videoUrl,
    };
    if (isReel) {
      body.upload_phase = 'finish';
      body.video_state = 'PUBLISHED';
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`FB publish failed: ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return {
      externalPostId: data.id,
      externalUrl: `https://facebook.com/${data.id}`,
      dryRun: false,
    };
  }

  private async waitForContainer(
    accessToken: string,
    containerId: string,
    attempts = 20,
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      const res = await fetch(
        `${this.config.metaGraphBaseUrl}/${containerId}?fields=status_code&access_token=${accessToken}`,
      );
      if (!res.ok) throw new Error(`IG status poll failed: ${await res.text()}`);
      const data = (await res.json()) as { status_code?: string };
      if (data.status_code === 'FINISHED') return;
      if (data.status_code === 'ERROR') {
        throw new Error('IG container processing error');
      }
      await sleep(2_000);
    }
    throw new Error('IG container processing timeout');
  }
}

/**
 * YouTube Data API stub — Shorts / long-form upload via resumable session.
 * Full resumable upload wiring lands when Google OAuth is production-ready.
 */
export class YouTubePublisher {
  constructor(private readonly config: DataZoneConfig) {}

  async publish(token: OmniHubToken, req: PublishRequest): Promise<PublishResult> {
    if (this.config.dryRunPublishing) {
      const id = `yt_dry_${Date.now()}`;
      return {
        externalPostId: id,
        externalUrl: `https://youtube.com/shorts/${id}`,
        dryRun: true,
      };
    }

    // Stub: initiate resumable upload session (bytes streamed from CDN URL in worker).
    const init = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify({
          snippet: {
            title: req.caption?.slice(0, 100) || 'Data Zone upload',
            description: req.caption ?? '',
            categoryId: '22',
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      },
    );
    if (!init.ok) {
      throw new Error(`YouTube session init failed: ${await init.text()}`);
    }
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube missing resumable upload URL');

    // Caller/worker should PUT media bytes to uploadUrl; return placeholder id.
    return {
      externalPostId: `yt_pending_${Date.now()}`,
      externalUrl: undefined,
      dryRun: false,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
