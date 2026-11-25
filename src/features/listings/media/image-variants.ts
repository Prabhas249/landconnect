/**
 * Size-appropriate variants of listing photo URLs.
 *
 * Seeded photos come from the Unsplash (imgix) CDN at w=1600 q=80. A feed card is ~355pt wide
 * (≈930px on a 2.6x phone) and a filmstrip thumb is 52–84pt, so downloading the 1600px original
 * everywhere wastes bandwidth and decode time. Imgix resizes on the edge from query params, so a
 * variant is a pure string rewrite. Any other host (Supabase uploads) is returned unchanged.
 */

export type PhotoSize = 'thumb' | 'card' | 'full';

const SPEC: Record<Exclude<PhotoSize, 'full'>, { w: number; q: number }> = {
  // Compact-card thumbs (84pt) and the viewer filmstrip (52pt) at up to 3x.
  thumb: { w: 240, q: 50 },
  // Feed card media: 355pt × 208pt cover-fit on a 2.6x screen needs ~930 × 546px. The variant
  // keeps the original's aspect ratio (no extra crop) so it doubles as the detail hero's and the
  // viewer's low-res stand-in without a jump when the full photo cross-fades in.
  card: { w: 960, q: 55 },
};

const IMGIX = /^https:\/\/images\.unsplash\.com\//;
const memo = new Map<string, string>();

function param(params: string[], key: string) {
  const hit = params.find((p) => p.startsWith(`${key}=`));
  return hit ? Number(hit.slice(key.length + 1)) || 0 : 0;
}

export function photoUrl(uri: string, size: PhotoSize): string {
  if (size === 'full' || !uri || !IMGIX.test(uri)) return uri;
  const memoKey = `${size}|${uri}`;
  const known = memo.get(memoKey);
  if (known) return known;

  const q = uri.indexOf('?');
  const base = q === -1 ? uri : uri.slice(0, q);
  const params = q === -1 ? [] : uri.slice(q + 1).split('&').filter(Boolean);
  const w0 = param(params, 'w');
  const h0 = param(params, 'h');
  const spec = SPEC[size];

  let out = uri;
  if (!w0 || w0 > spec.w) {
    const kept = params.filter((p) => !/^(w|h|q|fm|auto)=/.test(p));
    kept.push(`w=${spec.w}`);
    // Keep an explicit crop's aspect ratio.
    if (w0 && h0) kept.push(`h=${Math.round((h0 * spec.w) / w0)}`);
    // Measured on the 46 seeded photos: JPEG with imgix's compress pass comes out smaller than
    // WebP at these sizes (avg 345 KB original → 111 KB card → 8 KB thumb). `auto=format` still
    // upgrades to AVIF/WebP for clients that advertise them.
    kept.push(`q=${spec.q}`, 'fm=jpg', 'auto=format,compress');
    out = `${base}?${kept.join('&')}`;
  }
  memo.set(memoKey, out);
  return out;
}

/** Smaller variants of `uri` that make a good low-res stand-in, best first. */
export function smallerVariants(uri: string, size: PhotoSize): string[] {
  if (size === 'full') return [photoUrl(uri, 'card'), photoUrl(uri, 'thumb')].filter((u) => u !== uri);
  if (size === 'card') return [photoUrl(uri, 'thumb')].filter((u) => u !== photoUrl(uri, 'card'));
  return [];
}
