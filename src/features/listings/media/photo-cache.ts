import { Image, type ImageLoadEventData, type ImageSource } from 'expo-image';

import { photoUrl, smallerVariants, type PhotoSize } from './image-variants';

/**
 * Session memory about listing photos, shared by the feed card, the hero and the viewer.
 *
 * - Which URLs are already in the image cache (prefetched or displayed), so a larger variant can
 *   start from the smaller one already on the device instead of from a blank surface.
 * - Aspect ratios, so the fullscreen viewer can size its frame (and the open transition can
 *   land on the right rectangle) before the full image has decoded.
 * - Thumbhashes learned after a photo's first load, used when no smaller variant is cached.
 * - A background prefetch queue that never competes with what is on screen: at most a few
 *   downloads at a time, disk-only, drained after the foreground work.
 */

const aspects = new Map<string, number>();
const hashes = new Map<string, string>();
const learning = new Set<string>();
const MAX_HASHES = 300;

/** URLs known to be in the expo-image cache this session. */
const ready = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

export function aspectOf(uri: string, fallback = 4 / 3) {
  // The feed's card variant keeps the original's proportions, and has usually loaded first.
  return aspects.get(uri) ?? aspects.get(photoUrl(uri, 'card')) ?? fallback;
}

export function markReady(url: string) {
  if (url) ready.add(url);
}

export function isReady(url: string) {
  return ready.has(url);
}

export function rememberLoad(uri: string, e: ImageLoadEventData) {
  markReady(uri);
  const { width, height } = e.source;
  if (width > 0 && height > 0) aspects.set(uri, width / height);
}

/** Cheap native call, off the JS thread; only worth it for photos someone actually opened. */
export function learnPlaceholder(uri: string) {
  if (hashes.has(uri) || learning.has(uri)) return;
  learning.add(uri);
  Image.generateThumbhashAsync(uri)
    .then((hash) => {
      if (hashes.size >= MAX_HASHES) {
        const oldest = hashes.keys().next().value;
        if (oldest !== undefined) hashes.delete(oldest);
      }
      hashes.set(uri, hash);
    })
    .catch(() => {})
    .finally(() => learning.delete(uri));
}

export function placeholderFor(uri: string): ImageSource | undefined {
  const thumbhash = hashes.get(uri);
  return thumbhash ? { thumbhash } : undefined;
}

/**
 * Low-res-first stand-in for `original` shown at `size`: the best smaller variant already in
 * the cache (it decodes from memory instantly), else a learned thumbhash, else nothing — never a
 * placeholder that would cost its own download.
 */
export function lowResFor(original: string, size: PhotoSize): ImageSource | undefined {
  for (const url of smallerVariants(original, size)) {
    if (ready.has(url)) return { uri: url };
  }
  return placeholderFor(photoUrl(original, size)) ?? placeholderFor(original);
}

// ── prefetching

function fetchOne(url: string, cachePolicy: 'memory-disk' | 'disk') {
  if (!url || ready.has(url)) return Promise.resolve(true);
  const running = inflight.get(url);
  if (running) return running;
  const job = Image.prefetch(url, { cachePolicy })
    .then((ok) => {
      if (ok) ready.add(url);
      return ok;
    })
    .catch(() => false)
    .finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}

/** Foreground prefetch: decoded into memory, for what the next screen shows first. */
export function prefetchNow(urls: string[]) {
  return Promise.all(urls.map((u) => fetchOne(u, 'memory-disk'))).then(() => undefined);
}

const backlog: string[] = [];
const queued = new Set<string>();
let draining = false;
const BACKGROUND_CONCURRENCY = 3;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (backlog.length > 0) {
      const chunk = backlog.splice(0, BACKGROUND_CONCURRENCY);
      await Promise.all(chunk.map((u) => fetchOne(u, 'disk').finally(() => queued.delete(u))));
    }
  } finally {
    draining = false;
  }
}

/** Background prefetch to disk, a few at a time. `front` jumps the queue (still behind in-flight). */
export function prefetchLater(urls: string[], front = false) {
  const fresh = urls.filter((u) => u && !ready.has(u) && !queued.has(u) && !inflight.has(u));
  if (fresh.length === 0) return;
  for (const u of fresh) queued.add(u);
  if (front) backlog.unshift(...fresh);
  else backlog.push(...fresh);
  drain();
}

/** Warms the cache for the photos either side of the one on screen. */
export function prefetchAround(images: string[], index: number, reach = 2, size: PhotoSize = 'full') {
  const urls: string[] = [];
  for (let d = 1; d <= reach; d++) {
    const next = images[index + d];
    const prev = images[index - d];
    if (next) urls.push(photoUrl(next, size));
    if (prev) urls.push(photoUrl(prev, size));
  }
  if (urls.length > 0) prefetchNow(urls);
}

type WithImages = { images: string[] };

/** How many feed covers get decoded into memory up front (about two screens of cards). */
const HOT_COVERS = 6;

/**
 * Feed warm-up: every listing's cover at card size (the first few straight into memory), then
 * each listing's second photo — the first thing a swipe reveals — then the rest of the photos.
 */
export function warmFeed(listings: WithImages[]) {
  const covers = listings.map((l) => l.images[0]).filter(Boolean).map((u) => photoUrl(u, 'card'));
  prefetchNow(covers.slice(0, HOT_COVERS));
  const second = listings.map((l) => l.images[1]).filter(Boolean).map((u) => photoUrl(u, 'card'));
  const rest = listings.flatMap((l) => l.images.slice(2, 5)).map((u) => photoUrl(u, 'card'));
  prefetchLater([...covers.slice(HOT_COVERS), ...second, ...rest]);
}

/** Compact lists (Saved, My land): just the cover thumbs. */
export function warmThumbs(listings: WithImages[]) {
  prefetchLater(listings.map((l) => l.images[0]).filter(Boolean).map((u) => photoUrl(u, 'thumb')));
}

const warmedDetail = new Set<string>();

/**
 * Called as a finger lands on a card: the detail hero's first photo starts downloading at full
 * size before navigation begins, the second and the filmstrip thumbs queue right behind it.
 */
export function warmDetail(listing: { id: string } & WithImages) {
  if (warmedDetail.has(listing.id) || listing.images.length === 0) return;
  warmedDetail.add(listing.id);
  prefetchNow([listing.images[0]]);
  prefetchLater([...listing.images.slice(1, 2), ...listing.images.map((u) => photoUrl(u, 'thumb'))], true);
}
