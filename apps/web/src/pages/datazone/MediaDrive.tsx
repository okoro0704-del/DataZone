import { useEffect, useMemo, useState, startTransition } from 'react';
import {
  distribute,
  fetchDrive,
  type MediaAssetSummary,
  type PlatformTarget,
} from '../../api/datazone';
import styles from './MediaDrive.module.css';

type ViewMode = 'grid' | 'list';

const PUBLISH_TARGETS: { id: PlatformTarget; label: string; ratio: string }[] = [
  { id: 'INSTAGRAM_REELS', label: 'Instagram Reels', ratio: '9:16' },
  { id: 'FACEBOOK_PAGE', label: 'Facebook Page', ratio: '1.91:1' },
  { id: 'YOUTUBE_SHORTS', label: 'YouTube Shorts', ratio: '9:16' },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function aspectLabel(w?: number | null, h?: number | null): string {
  if (!w || !h) return '—';
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.05) return '9:16';
  if (Math.abs(r - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(r - 1) < 0.05) return '1:1';
  if (Math.abs(r - 4 / 5) < 0.08) return '4:5';
  return `${w}×${h}`;
}

export function MediaDrive() {
  const [assets, setAssets] = useState<MediaAssetSummary[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(10 * 1024 ** 3);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('grid');
  const [selected, setSelected] = useState<MediaAssetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<PlatformTarget[]>([
    'INSTAGRAM_REELS',
    'FACEBOOK_PAGE',
  ]);
  const [caption, setCaption] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      startTransition(() => {
        void (async () => {
          setLoading(true);
          setError(null);
          try {
            const drive = await fetchDrive(query || undefined);
            if (cancelled) return;
            setAssets(drive.assets);
            setUsedBytes(drive.storage.usedBytes);
            setQuotaBytes(drive.storage.quotaBytes);
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : 'Failed to load drive');
            }
          } finally {
            if (!cancelled) setLoading(false);
          }
        })();
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const usagePct = useMemo(
    () => Math.min(100, Math.round((usedBytes / quotaBytes) * 100)),
    [usedBytes, quotaBytes],
  );

  function toggleTarget(id: PlatformTarget) {
    setSelectedTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }

  async function onPublish() {
    if (!selected || selectedTargets.length === 0) return;
    setPublishing(true);
    setPublishNote(null);
    try {
      const result = await distribute(selected.id, selectedTargets, caption || undefined);
      const ok = result.jobs.filter((j) => j.status === 'PUBLISHED').length;
      const fail = result.jobs.length - ok;
      setPublishNote(
        fail === 0
          ? `Published to ${ok} platform${ok === 1 ? '' : 's'}.`
          : `${ok} published, ${fail} failed.`,
      );
    } catch (err) {
      setPublishNote(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }

  function triggerDownload(url?: string, filename?: string) {
    if (!url || url === '#') {
      setPublishNote('Download link unavailable in mock mode.');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'asset';
    a.rel = 'noopener';
    a.click();
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <p className={styles.brand}>Data Zone</p>
          <h1 className={styles.title}>Media Drive</h1>
        </div>
        <div className={styles.storage}>
          <div className={styles.storageMeta}>
            <span>Vault usage</span>
            <strong>
              {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
            </strong>
          </div>
          <div className={styles.meter} aria-hidden>
            <div className={styles.meterFill} style={{ width: `${usagePct}%` }} />
          </div>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span className={styles.srOnly}>Search assets</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search masters…"
            type="search"
          />
        </label>
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          <button
            type="button"
            className={view === 'grid' ? styles.activeToggle : undefined}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={view === 'list' ? styles.activeToggle : undefined}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.muted}>Loading drive…</p>}

      {!loading && assets.length === 0 && (
        <p className={styles.empty}>No media yet. Upload to Sovereign Drive to populate the vault.</p>
      )}

      <div className={view === 'grid' ? styles.grid : styles.list}>
        {assets.map((asset, index) => (
          <button
            key={asset.id}
            type="button"
            className={styles.card}
            style={{ animationDelay: `${index * 40}ms` }}
            onClick={() => {
              setSelected(asset);
              setPublishNote(null);
            }}
          >
            <div className={styles.thumb} data-kind={asset.kind}>
              <span className={styles.kind}>{asset.kind}</span>
              <span className={styles.ratio}>
                {aspectLabel(asset.width, asset.height)}
              </span>
            </div>
            <div className={styles.cardBody}>
              <strong className={styles.filename}>{asset.filename}</strong>
              <span className={styles.meta}>
                {formatBytes(asset.sizeBytes)} · {asset.variants.length} renders ·{' '}
                {asset.encryptionState === 'ENCRYPTED_ESFS' ? 'eSFS' : asset.encryptionState}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <aside className={styles.drawer} role="dialog" aria-label="Asset inspector">
          <div className={styles.drawerScrim} onClick={() => setSelected(null)} />
          <div className={styles.drawerPanel}>
            <header className={styles.drawerHead}>
              <div>
                <p className={styles.eyebrow}>Asset inspector</p>
                <h2>{selected.filename}</h2>
              </div>
              <button type="button" className={styles.iconBtn} onClick={() => setSelected(null)}>
                Close
              </button>
            </header>

            <div className={styles.preview} data-kind={selected.kind}>
              <div className={styles.previewFrame}>
                <span>{selected.kind}</span>
                <strong>{aspectLabel(selected.width, selected.height)}</strong>
              </div>
            </div>

            <section className={styles.section}>
              <h3>Rendered variants</h3>
              <ul className={styles.variantList}>
                {selected.variants.length === 0 && (
                  <li className={styles.muted}>Renders queued or pending…</li>
                )}
                {selected.variants.map((v) => (
                  <li key={v.id}>
                    <div>
                      <strong>{v.preset?.code ?? 'CUSTOM'}</strong>
                      <span>
                        {aspectLabel(v.width, v.height)} · {formatBytes(v.sizeBytes)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerDownload(v.downloadUrl, v.filename)}
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.section}>
              <h3>1-click publish</h3>
              <p className={styles.muted}>
                Uses OmniHub Meta / YouTube tokens. Dry-run enabled in local configs.
              </p>
              <div className={styles.targets}>
                {PUBLISH_TARGETS.map((t) => (
                  <label key={t.id} className={styles.targetChip}>
                    <input
                      type="checkbox"
                      checked={selectedTargets.includes(t.id)}
                      onChange={() => toggleTarget(t.id)}
                    />
                    <span>
                      {t.label}
                      <em>{t.ratio}</em>
                    </span>
                  </label>
                ))}
              </div>
              <textarea
                className={styles.caption}
                rows={3}
                placeholder="Caption (optional)"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => triggerDownload(selected.downloadUrl, selected.filename)}
                >
                  Download master
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={publishing || selectedTargets.length === 0}
                  onClick={() => void onPublish()}
                >
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
              </div>
              {publishNote && <p className={styles.publishNote}>{publishNote}</p>}
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}

export default MediaDrive;
