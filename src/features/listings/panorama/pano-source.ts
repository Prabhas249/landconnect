import { FilterMode, MipmapMode, Skia, type SkData, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

/**
 * Panorama loading, deliberately not `useImage`: a 4096×2048 JPG decodes to 32 MB and `useImage`
 * neither downscales nor decodes ahead of the first draw (that decode would land on the UI thread
 * as a frame hitch). Here the encoded bytes are fetched once per URL and kept (a few MB), then
 * decoded into two pre-rasterised tiers:
 *
 * - `preview`: ≤1024 px wide, used by the live card on the detail screen and as the instant
 *   first frame of the fullscreen viewer.
 * - `full`: ≤4096 px wide (the safe GL_MAX_TEXTURE_SIZE on current mid-range Android), only held
 *   while the fullscreen viewer is mounted — `releasePanorama` drops it on close.
 *
 * Rasterising draws the lazy encoded image into an offscreen surface with mipmapped linear
 * sampling (a clean downscale, no aliasing) and copies the result to a CPU image so it can be
 * drawn from the UI-thread canvas.
 */

export type PanoTier = 'preview' | 'full';

const MAX_WIDTH: Record<PanoTier, number> = { preview: 1024, full: 4096 };
const MAX_ENTRIES = 4;

type Entry = {
  data?: Promise<SkData>;
  pending: Partial<Record<PanoTier, Promise<SkImage>>>;
  ready: Partial<Record<PanoTier, SkImage>>;
};

const cache = new Map<string, Entry>();

function entryFor(url: string) {
  const existing = cache.get(url);
  if (existing) {
    // Refresh LRU position.
    cache.delete(url);
    cache.set(url, existing);
    return existing;
  }
  const created: Entry = { pending: {}, ready: {} };
  cache.set(url, created);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return created;
}

function rasterize(src: SkImage, maxWidth: number): SkImage {
  const sw = src.width();
  const sh = src.height();
  const w = Math.min(maxWidth, sw);
  const h = Math.max(1, Math.round(sh * (w / sw)));
  const from = Skia.XYWHRect(0, 0, sw, sh);
  const to = Skia.XYWHRect(0, 0, w, h);

  const gpu = Skia.Surface.MakeOffscreen(w, h);
  if (gpu) {
    gpu.getCanvas().drawImageRectOptions(src, from, to, FilterMode.Linear, MipmapMode.Linear, null);
    gpu.flush();
    const snapshot = gpu.makeImageSnapshot();
    const cpu = snapshot.makeNonTextureImage();
    if (cpu) return cpu;
  }
  const raster = Skia.Surface.Make(w, h);
  if (!raster) throw new Error('No surface for panorama');
  raster.getCanvas().drawImageRectOptions(src, from, to, FilterMode.Linear, MipmapMode.Linear, null);
  raster.flush();
  return raster.makeImageSnapshot();
}

/** Yields one frame so the loading state paints before the synchronous decode. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function loadPanorama(url: string, tier: PanoTier): Promise<SkImage> {
  const entry = entryFor(url);
  const ready = entry.ready[tier];
  if (ready) return Promise.resolve(ready);
  const pending = entry.pending[tier];
  if (pending) return pending;

  if (!entry.data) {
    const data = Skia.Data.fromURI(url);
    entry.data = data;
    data.catch(() => {
      if (entry.data === data) entry.data = undefined;
    });
  }
  const bytes = entry.data;

  const job = (async () => {
    const data = await bytes;
    await nextFrame();
    const encoded = Skia.Image.MakeImageFromEncoded(data);
    if (!encoded || encoded.width() < 2) throw new Error('Panorama could not be decoded');
    const image = rasterize(encoded, MAX_WIDTH[tier]);
    entry.ready[tier] = image;
    return image;
  })();
  entry.pending[tier] = job;
  job.then(
    () => {
      if (entry.pending[tier] === job) entry.pending[tier] = undefined;
    },
    () => {
      if (entry.pending[tier] === job) entry.pending[tier] = undefined;
    },
  );
  return job;
}

/** Synchronous peek so a viewer can paint the preview tier on its first frame. */
export function peekPanorama(url: string | null | undefined, tier: PanoTier) {
  return url ? (cache.get(url)?.ready[tier] ?? null) : null;
}

/** Drops a decoded tier; the encoded bytes stay cached so reopening never re-downloads. */
export function releasePanorama(url: string, tier: PanoTier) {
  const entry = cache.get(url);
  if (!entry) return;
  entry.ready[tier] = undefined;
  entry.pending[tier] = undefined;
}

/** Forgets everything for a URL, so a retry really refetches. */
function forgetPanorama(url: string) {
  cache.delete(url);
}

export type PanoramaState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  image: SkImage | null;
  retry: () => void;
};

export function usePanorama(url: string | null | undefined, tier: PanoTier): PanoramaState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; image: SkImage | null; failed: boolean } | null>(null);
  const key = url ? `${url}|${tier}|${attempt}` : '';

  useEffect(() => {
    if (!url) return;
    let alive = true;
    loadPanorama(url, tier).then(
      (image) => {
        if (alive) setResult({ key, image, failed: false });
      },
      () => {
        if (alive) setResult({ key, image: null, failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [url, tier, key]);

  const retry = () => {
    if (!url) return;
    forgetPanorama(url);
    setAttempt((a) => a + 1);
  };

  if (!url) return { status: 'idle', image: null, retry };
  const settled = result && result.key === key ? result : null;
  const image = settled?.image ?? peekPanorama(url, tier);
  if (image) return { status: 'ready', image, retry };
  if (settled?.failed) return { status: 'error', image: null, retry };
  return { status: 'loading', image: null, retry };
}
