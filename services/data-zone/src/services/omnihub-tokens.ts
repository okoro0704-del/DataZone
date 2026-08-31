import type { DataZoneConfig } from '../config.js';

export interface OmniHubToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  provider: 'META' | 'GOOGLE' | 'YOUTUBE';
  externalAccountId: string;
  pageId?: string;
  scopes: string[];
}

/**
 * Fetches social OAuth tokens connected via OmniHub for the Trust ID subject.
 * Production: HTTP call to OmniHub token vault.
 * Dev: returns deterministic stub tokens when OMNIHUB is unreachable / dry-run.
 */
export class OmniHubTokenService {
  constructor(private readonly config: DataZoneConfig) {}

  async getMetaTokens(tidOwner: string, tenantId: string): Promise<OmniHubToken | null> {
    try {
      const res = await fetch(
        `${this.config.omniHubBaseUrl}/v1/connections/meta/token?tid=${encodeURIComponent(tidOwner)}&tenantId=${encodeURIComponent(tenantId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        return (await res.json()) as OmniHubToken;
      }
    } catch {
      /* fall through to stub */
    }

    if (this.config.dryRunPublishing) {
      return {
        accessToken: `stub-meta-token-${tidOwner}`,
        provider: 'META',
        externalAccountId: `page_${tenantId}`,
        pageId: `page_${tenantId}`,
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_manage_posts'],
      };
    }
    return null;
  }

  async getYouTubeTokens(tidOwner: string, tenantId: string): Promise<OmniHubToken | null> {
    try {
      const res = await fetch(
        `${this.config.omniHubBaseUrl}/v1/connections/youtube/token?tid=${encodeURIComponent(tidOwner)}&tenantId=${encodeURIComponent(tenantId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        return (await res.json()) as OmniHubToken;
      }
    } catch {
      /* stub */
    }

    if (this.config.dryRunPublishing) {
      return {
        accessToken: `stub-yt-token-${tidOwner}`,
        provider: 'YOUTUBE',
        externalAccountId: `channel_${tenantId}`,
        scopes: ['https://www.googleapis.com/auth/youtube.upload'],
      };
    }
    return null;
  }
}
