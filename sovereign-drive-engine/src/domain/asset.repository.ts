import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssetRecord } from '../domain/index.js';

/**
 * Lightweight JSON-backed asset catalog for local/dev.
 * Swap for Postgres / Dynamo in production without changing StorageService.
 */
export class AssetRepository {
  private readonly assets = new Map<string, AssetRecord>();
  private readonly catalogPath: string;
  private ready: Promise<void>;

  constructor(dataDir: string) {
    this.catalogPath = path.join(dataDir, 'catalog.json');
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      await mkdir(path.dirname(this.catalogPath), { recursive: true });
      const raw = await readFile(this.catalogPath, 'utf8');
      const list = JSON.parse(raw) as AssetRecord[];
      for (const asset of list) {
        this.assets.set(asset.assetId, asset);
      }
    } catch {
      this.assets.clear();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.catalogPath), { recursive: true });
    const list = [...this.assets.values()];
    await writeFile(this.catalogPath, JSON.stringify(list, null, 2));
  }

  async save(asset: AssetRecord): Promise<void> {
    await this.ready;
    this.assets.set(asset.assetId, asset);
    await this.persist();
  }

  async get(assetId: string): Promise<AssetRecord | undefined> {
    await this.ready;
    return this.assets.get(assetId);
  }

  async softDelete(assetId: string): Promise<boolean> {
    await this.ready;
    const asset = this.assets.get(assetId);
    if (!asset || asset.deletedAt) return false;
    asset.deletedAt = new Date().toISOString();
    this.assets.set(assetId, asset);
    await this.persist();
    return true;
  }

  /** Test helper — wipe catalog */
  async clear(): Promise<void> {
    await this.ready;
    this.assets.clear();
    await this.persist();
  }
}
