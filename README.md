# Data Zone — Media Drive & Cross-Platform Publishing

Re-architected from a bandwidth marketplace into a **Media Drive** backed by Sovereign Drive, with automated platform renders and Meta/YouTube distribution.

## Packages

| Path | Role |
|------|------|
| `packages/db` | Prisma: MediaAsset, RenderPreset, DistributionJob, MediaProvenance, LicensePolicy, BaaS keys |
| `packages/sdk-datazone` | Developer BaaS SDK (`@datazone/sdk`) |
| `services/data-zone` | Media processor, distribution, BaaS gateway, revocation |
| `apps/web` | Media Drive PWA UI |
| `sovereign-drive-engine` | Encrypted object storage primitive |

## BaaS (Developer API)

```bash
# Mint API key (Trust ID JWT)
POST /v1/baas/keys

# Presigned upload
POST /v1/baas/assets/upload-intent
POST /v1/baas/assets/upload/:token

# License + distribute + render + revoke
POST /v1/baas/assets/:id/license
POST /v1/baas/assets/:id/distribute
GET  /v1/baas/assets/:id/render
POST /v1/baas/assets/:id/revoke
```

```ts
import { DataZoneClient } from '@datazone/sdk';
```

## Quick start

```bash
npm install
cp packages/db/.env.example packages/db/.env
# set DATABASE_URL, then:
npm run db:generate
npm run db:push
npm run build -w @datazone/db

# API (dry-run publishing on by default)
npm run dev:datazone

# UI (mock drive data unless VITE_USE_MOCK=false)
npm run dev:web
```

## Key product APIs

- `GET  /v1/datazone/drive` — master assets + storage usage
- `POST /v1/datazone/assets/register` — register Sovereign Drive upload + enqueue renders
- `POST /v1/datazone/distribute` — shell distribution
- `GET  /cdn/:assetId?exp&sig` — timed CDN gateway (honors revocation tombstones)
