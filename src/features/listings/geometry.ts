import type { LngLat } from '@/lib/types';

/** Pure geometry used by the code-drawn parcel and terrain graphics. */

export type Pt = { x: number; y: number };

const M_PER_DEG = 111_320;
const SQM_PER_ACRE = 4046.86;

/** A deterministic PRNG so every listing keeps the same generated terrain across renders and devices. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drops a repeated closing vertex; GeoJSON rings repeat the first point, our drawings close themselves. */
export function openRing(boundary: LngLat[]): LngLat[] {
  if (boundary.length < 2) return boundary;
  const [a, b] = [boundary[0], boundary[boundary.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? boundary.slice(0, -1) : boundary;
}

export function hasBoundary(boundary: LngLat[] | null | undefined): boundary is LngLat[] {
  return !!boundary && openRing(boundary).length >= 3;
}

/** [lng, lat] → local metres, north up in screen space (y grows downward). */
export function projectMetres(points: LngLat[]): Pt[] {
  if (points.length === 0) return [];
  const lat0 = ((points.reduce((s, p) => s + p[1], 0) / points.length) * Math.PI) / 180;
  const mLng = M_PER_DEG * Math.cos(lat0);
  return points.map(([lng, lat]) => ({ x: lng * mLng, y: -lat * M_PER_DEG }));
}

/** Uniformly scales points into a w×h viewport with padding, centred. Returns px-per-unit. */
export function fitToBox(points: Pt[], w: number, h: number, pad: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = (w - bw * scale) / 2;
  const oy = (h - bh * scale) / 2;
  return {
    scale,
    points: points.map((p) => ({ x: ox + (p.x - minX) * scale, y: oy + (p.y - minY) * scale })),
  };
}

/** Indicative rectangle (metres) for a listing without a traced boundary. */
export function rectangleForAcres(acres: number, aspect = 1.45): Pt[] {
  const sqm = Math.max(acres, 0.01) * SQM_PER_ACRE;
  const w = Math.sqrt(sqm * aspect);
  const h = sqm / w;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

/** Slightly irregular four-sided plot used where we know nothing about the shape. */
export function genericPlot(seed: string): Pt[] {
  const r = seeded(seed);
  return [
    { x: 0.1 + r() * 0.12, y: 0.16 + r() * 0.1 },
    { x: 0.82 + r() * 0.08, y: 0.08 + r() * 0.12 },
    { x: 0.9 - r() * 0.08, y: 0.86 - r() * 0.1 },
    { x: 0.14 + r() * 0.1, y: 0.9 - r() * 0.08 },
  ];
}

export function edgeLengths(points: Pt[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

export function polygonPath(points: Pt[]) {
  if (points.length === 0) return '';
  return `M${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L')} Z`;
}

/** Closed Catmull-Rom spline through the points, as cubic Béziers — for organic contour lines. */
export function smoothClosedPath(points: Pt[]) {
  const n = points.length;
  if (n < 3) return polygonPath(points);
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

export function centroid(points: Pt[]): Pt {
  const n = points.length || 1;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Largest "nice" ground distance that fits within `maxPx` at the given px-per-metre. */
export function niceScaleBar(pxPerMetre: number, maxPx: number) {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  let best = steps[0];
  for (const s of steps) if (s * pxPerMetre <= maxPx) best = s;
  return { metres: best, px: best * pxPerMetre };
}

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
