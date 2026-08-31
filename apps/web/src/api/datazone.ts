export type PlatformTarget =
  | 'INSTAGRAM_REEL'
  | 'INSTAGRAM_REELS'
  | 'INSTAGRAM_FEED'
  | 'FACEBOOK_PAGE'
  | 'FACEBOOK_REEL'
  | 'YOUTUBE_SHORTS'
  | 'YOUTUBE_VIDEO'
  | 'FB_FEED';

export interface MediaVariant {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  downloadUrl?: string;
  preset?: { code: string; width: number; height: number } | null;
  renderStatus: string;
}

export interface MediaAssetSummary {
  id: string;
  sovereignAssetId: string;
  filename: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  encryptionState: string;
  renderStatus: string;
  createdAt: string;
  downloadUrl?: string;
  variants: MediaVariant[];
}

export interface DriveResponse {
  assets: MediaAssetSummary[];
  storage: { usedBytes: number; quotaBytes: number };
}

export interface DistributeResponse {
  assetId: string;
  jobs: Array<{
    id: string;
    platform: string;
    target: string;
    status: string;
    externalPostId: string | null;
    externalUrl: string | null;
    errorMessage: string | null;
  }>;
}

const API_BASE = import.meta.env.VITE_DATAZONE_API_URL ?? '';
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('tid_token') ?? '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const MOCK_ASSETS: MediaAssetSummary[] = [
  {
    id: 'asset_master_1',
    sovereignAssetId: 'sd_1',
    filename: 'launch-reel-master.mp4',
    mimeType: 'video/mp4',
    kind: 'VIDEO',
    sizeBytes: 48_200_000,
    width: 2160,
    height: 3840,
    durationMs: 28_400,
    encryptionState: 'ENCRYPTED_ESFS',
    renderStatus: 'READY',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    downloadUrl: '#',
    variants: [
      {
        id: 'v_reel',
        filename: 'launch-reel_INSTAGRAM_REEL.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 18_400_000,
        width: 1080,
        height: 1920,
        preset: { code: 'INSTAGRAM_REEL', width: 1080, height: 1920 },
        renderStatus: 'READY',
        downloadUrl: '#',
      },
      {
        id: 'v_feed',
        filename: 'launch-reel_FB_FEED.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 420_000,
        width: 1080,
        height: 1080,
        preset: { code: 'FB_FEED', width: 1080, height: 1080 },
        renderStatus: 'READY',
        downloadUrl: '#',
      },
      {
        id: 'v_yt',
        filename: 'launch-reel_YOUTUBE_SHORTS.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 22_100_000,
        width: 1080,
        height: 1920,
        preset: { code: 'YOUTUBE_SHORTS', width: 1080, height: 1920 },
        renderStatus: 'READY',
        downloadUrl: '#',
      },
    ],
  },
  {
    id: 'asset_master_2',
    sovereignAssetId: 'sd_2',
    filename: 'menu-hero.jpg',
    mimeType: 'image/jpeg',
    kind: 'IMAGE',
    sizeBytes: 3_200_000,
    width: 4000,
    height: 3000,
    durationMs: null,
    encryptionState: 'ENCRYPTED_ESFS',
    renderStatus: 'READY',
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    downloadUrl: '#',
    variants: [
      {
        id: 'v_ig_feed',
        filename: 'menu-hero_INSTAGRAM_FEED.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 680_000,
        width: 1080,
        height: 1350,
        preset: { code: 'INSTAGRAM_FEED', width: 1080, height: 1350 },
        renderStatus: 'READY',
        downloadUrl: '#',
      },
    ],
  },
];

export async function fetchDrive(q?: string): Promise<DriveResponse> {
  if (USE_MOCK) {
    const assets = q
      ? MOCK_ASSETS.filter((a) => a.filename.toLowerCase().includes(q.toLowerCase()))
      : MOCK_ASSETS;
    const usedBytes = assets.reduce((s, a) => s + a.sizeBytes, 0);
    return { assets, storage: { usedBytes, quotaBytes: 10 * 1024 ** 3 } };
  }

  const url = new URL(`${API_BASE}/v1/datazone/drive`, window.location.origin);
  if (q) url.searchParams.set('q', q);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function distribute(
  assetId: string,
  platforms: PlatformTarget[],
  caption?: string,
): Promise<DistributeResponse> {
  if (USE_MOCK) {
    return {
      assetId,
      jobs: platforms.map((target, i) => ({
        id: `job_${i}`,
        platform: target.startsWith('YOUTUBE') ? 'YOUTUBE' : 'META',
        target,
        status: 'PUBLISHED',
        externalPostId: `dry_${Date.now()}_${i}`,
        externalUrl: `https://example.com/p/${i}`,
        errorMessage: null,
      })),
    };
  }

  const res = await fetch(`${API_BASE}/v1/datazone/distribute`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ assetId, platforms, caption }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
