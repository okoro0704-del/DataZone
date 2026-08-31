# Data Zone Developer SDK (`@datazone/sdk`)

```ts
import { DataZoneClient } from '@datazone/sdk';

const client = new DataZoneClient({
  baseUrl: 'http://localhost:4200',
  apiKey: process.env.DATAZONE_API_KEY!,
  getTidPasskey: async () => process.env.TID_PASSKEY_JWT!,
});

const asset = await client.uploadAsset(file, { filename: 'clip.mp4', mimeType: 'video/mp4' });
await client.setLicensing(asset.assetId, {
  isPublic: false,
  allowReuse: false,
  allowedPlatforms: ['LIVE_OS', 'INSTAGRAM', 'FACEBOOK'],
  monetizationTerms: 'rev-share-10',
  royaltyFeeVidCap: 10,
  expirationTimestamp: null,
});
await client.distribute(asset.assetId, {
  channels: ['LIVE_OS_PERSONAL', 'INSTAGRAM_REELS', 'FACEBOOK'],
  caption: 'Shipped from Data Zone BaaS',
});
```
