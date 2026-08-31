import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export * from '@prisma/client';

/** Seed default platform render presets (idempotent upserts). */
export const DEFAULT_RENDER_PRESETS = [
  {
    code: 'INSTAGRAM_REEL' as const,
    label: 'Instagram Reel',
    width: 1080,
    height: 1920,
    outputMime: 'video/mp4',
    fitMode: 'cover',
    maxDurationMs: 90_000,
    bitrateKbps: 5_000,
  },
  {
    code: 'INSTAGRAM_FEED' as const,
    label: 'Instagram Feed',
    width: 1080,
    height: 1350,
    outputMime: 'image/jpeg',
    fitMode: 'cover',
    bitrateKbps: null,
  },
  {
    code: 'YOUTUBE_SHORTS' as const,
    label: 'YouTube Shorts',
    width: 1080,
    height: 1920,
    outputMime: 'video/mp4',
    fitMode: 'cover',
    maxDurationMs: 60_000,
    bitrateKbps: 8_000,
  },
  {
    code: 'YOUTUBE_VIDEO' as const,
    label: 'YouTube Video',
    width: 1920,
    height: 1080,
    outputMime: 'video/mp4',
    fitMode: 'contain',
    bitrateKbps: 10_000,
  },
  {
    code: 'FB_FEED' as const,
    label: 'Facebook Feed',
    width: 1080,
    height: 1080,
    outputMime: 'image/jpeg',
    fitMode: 'cover',
    bitrateKbps: null,
  },
  {
    code: 'FACEBOOK_PAGE' as const,
    label: 'Facebook Page Post',
    width: 1200,
    height: 630,
    outputMime: 'image/jpeg',
    fitMode: 'cover',
    bitrateKbps: null,
  },
  {
    code: 'FACEBOOK_REEL' as const,
    label: 'Facebook Reel',
    width: 1080,
    height: 1920,
    outputMime: 'video/mp4',
    fitMode: 'cover',
    maxDurationMs: 90_000,
    bitrateKbps: 5_000,
  },
] as const;
