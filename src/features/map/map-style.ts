import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';

import { formatPrice, fuzzLocation } from '@/lib/format';
import type { LandType, ListingWithOwner, LngLat } from '@/lib/types';
import { palette } from '@/theme/tokens';

import { PILL_WIDTHS } from './map-sprites';

/** Stock keyless basemap; the branded style is derived from a bundled snapshot of it (see map-basemap). */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Glyph stacks published by the OpenFreeMap style (needed for symbol text). */
export const MAP_FONT_BOLD = ['Noto Sans Bold'];
export const MAP_FONT_REGULAR = ['Noto Sans Regular'];
export const MAP_FONT_ITALIC = ['Noto Sans Italic'];

/** Bengaluru (Vidhana Soudha). Distances fall back to this when the viewer's position is unknown. */
export const DEFAULT_CENTER: LngLat = [77.5946, 12.9716];
export const DEFAULT_ZOOM = 9.5;

/** Above this zoom clusters break into individual price pills. */
export const PILL_ZOOM = 11;
/** Zoom a pin without a boundary is framed at. */
export const FOCUS_ZOOM = 15;
/** A touch of pitch gives parcels depth when the camera settles on one. */
export const FOCUS_PITCH = 42;
/** Parcels of every listing fade in from here; below it they are smaller than a pill. */
export const PARCEL_ZOOM = 12.5;

/**
 * Radius of the "somewhere around here" disc for hidden locations. `fuzzLocation` moves the
 * centre 330–670 m, so 750 m always contains the true parcel without centring on it.
 */
export const APPROX_RADIUS_M = 750;

// ── colour helpers: every map tone is mixed from brand tokens, never invented.

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

export function mix(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${ca
    .map((v, i) =>
      Math.round(v + (cb[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Land-type legend shared by pills, parcels, chips and cards.
 * `fill` paints solid shapes, `ink` is the same hue dark enough for text and lines on white,
 * `on` is the text colour that sits on `fill`.
 */
export const LAND_COLORS: Record<LandType, { fill: string; ink: string; on: string }> = {
  agricultural: { fill: palette.green, ink: palette.green, on: palette.white },
  // Same hues as `LAND_TINT` in listings/meta.ts, so a land type reads identically on the map and in the feed.
  // Dark fills carry white text and double as their own ink; light fills get a forest-mixed ink.
  farmhouse: { fill: palette.clay, ink: palette.clay, on: palette.white },
  residential: { fill: palette.blue, ink: palette.blue, on: palette.white },
  commercial: { fill: palette.amber, ink: mix(palette.amber, palette.forest, 0.42), on: palette.forest },
  industrial: { fill: palette.slate, ink: palette.slate, on: palette.white },
};

/** `['match', ['get', 'landType'], …]` over the legend. */
export function byLandType(key: 'fill' | 'ink' | 'on'): ExpressionSpecification {
  const pairs = (Object.keys(LAND_COLORS) as LandType[]).flatMap((t) => [t, LAND_COLORS[t][key]]);
  return ['match', ['get', 'landType'], ...pairs, LAND_COLORS.agricultural[key]] as unknown as ExpressionSpecification;
}

/**
 * Phase-shifted dash patterns; stepping through them makes a dashed line march.
 * (Line dash phase is not animatable in MapLibre, so the pattern itself rotates.)
 */
export const MARCH_DASHES: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

// ── listings on the map

export type MapListing = {
  listing: ListingWithOwner;
  /** Coordinates to plot — fuzzed when the exact spot is private to the viewer. */
  lngLat: LngLat;
  approximate: boolean;
  priceLabel: string;
  /** Exact boundary, only when the viewer may see it. */
  boundary: LngLat[] | null;
};

export type PointProps = { id: string; priceLabel: string; landType: LandType; approx: boolean; pill: string };
export type AreaProps = { id: string; kind: 'parcel' | 'approx'; landType: LandType };

/** Hidden exact locations stay hidden from everyone but the owner: no true pin, no polygon. */
export function toMapListings(listings: ListingWithOwner[], viewerId: string | null): MapListing[] {
  return listings
    .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
    .map((listing) => {
      const approximate = listing.hide_exact_location && listing.owner_id !== viewerId;
      const at = approximate
        ? fuzzLocation(listing.id, listing.lat, listing.lng)
        : { lat: listing.lat, lng: listing.lng };
      const ring = !approximate && listing.boundary ? openRing(listing.boundary) : null;
      return {
        listing,
        lngLat: [at.lng, at.lat] as LngLat,
        approximate,
        priceLabel: formatPrice(listing.price_total),
        boundary: ring && ring.length >= 3 ? ring : null,
      };
    });
}

/** Advance widths of Noto Sans Bold at 24 px (from the glyph server), for sizing pills to their text. */
const ADVANCE: Record<string, number> = { ' ': 6, '.': 6, C: 15, K: 15, L: 13, r: 10 };
const PILL_TEXT_SIZE = 12;
const PILL_PAD_X = 10;

/** Smallest SDF pill sprite that fits the label. */
export function pillFor(label: string) {
  let w = 0;
  for (const ch of label) w += ADVANCE[ch] ?? 13;
  const need = (w * PILL_TEXT_SIZE) / 24 + PILL_PAD_X * 2;
  const fit = PILL_WIDTHS.find((pw) => pw >= need) ?? PILL_WIDTHS[PILL_WIDTHS.length - 1];
  return `lc-pill-${fit}`;
}

export function listingPoints(items: MapListing[]): GeoJSON.FeatureCollection<GeoJSON.Point, PointProps> {
  return {
    type: 'FeatureCollection',
    features: items.map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: m.lngLat },
      properties: {
        id: m.listing.id,
        priceLabel: m.priceLabel,
        landType: m.listing.land_type,
        approx: m.approximate,
        pill: pillFor(m.priceLabel),
      },
    })),
  };
}

/** Parcel outlines for exact listings, soft discs for approximate ones. */
export function listingAreas(items: MapListing[]): GeoJSON.FeatureCollection<GeoJSON.Polygon, AreaProps> {
  const features: GeoJSON.Feature<GeoJSON.Polygon, AreaProps>[] = [];
  for (const m of items) {
    const props = { id: m.listing.id, landType: m.listing.land_type };
    if (m.approximate) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circleRing(m.lngLat, APPROX_RADIUS_M)] },
        properties: { ...props, kind: 'approx' },
      });
    } else if (m.boundary) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [closeRing(m.boundary)] },
        properties: { ...props, kind: 'parcel' },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ── geometry

/** Drops a repeated closing vertex. */
export function openRing(points: LngLat[]): LngLat[] {
  if (points.length < 2) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? points.slice(0, -1) : points;
}

export function closeRing(points: LngLat[]): LngLat[] {
  if (points.length === 0) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? points : [...points, a];
}

/** Geodesic-enough circle polygon (equirectangular) around a point. */
export function circleRing(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const [lng, lat] = center;
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    ring.push([lng + Math.cos(t) * dLng, lat + Math.sin(t) * dLat]);
  }
  return ring;
}

/** [west, south, east, north] around points, padded so a single point still has extent. */
export function boundsOf(points: LngLat[], minSpan = 0.004): LngLatBounds | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  if (e - w < minSpan) {
    const c = (e + w) / 2;
    w = c - minSpan / 2;
    e = c + minSpan / 2;
  }
  if (n - s < minSpan) {
    const c = (n + s) / 2;
    s = c - minSpan / 2;
    n = c + minSpan / 2;
  }
  return [w, s, e, n];
}

export function inBounds([x, y]: LngLat, [w, s, e, n]: LngLatBounds) {
  return x >= w && x <= e && y >= s && y <= n;
}

export function centroid(points: LngLat[]): LngLat {
  const sum = points.reduce<[number, number]>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

/** Ray casting; fine at parcel scale. */
export function pointInPolygon([x, y]: LngLat, polygon: LngLat[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Great-circle distance in metres. */
export function distanceM(a: LngLat, b: LngLat) {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "86 m", "1.4 km", "32 km". */
export function formatDistance(m: number) {
  if (m < 1000) return `${Math.max(1, Math.round(m))} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1).replace(/\.0$/, '')} km`;
  return `${Math.round(m / 1000)} km`;
}

/** Text rotation (clockwise degrees) that lays a label along an edge and keeps it upright. */
export function edgeRotation(a: LngLat, b: LngLat) {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  let deg = (-Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/** Ground metres per screen point (MapLibre uses 512-pt tiles). */
export function metresPerPoint(zoom: number, lat: number) {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** "13.2468° N, 77.7120° E" */
export function formatCoords(lat: number, lng: number) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
}

/** "2 acres 14 guntas" — how parcels are spoken about in Karnataka. */
export function acresAndGuntas(acres: number) {
  const totalGuntas = Math.round(acres * 40);
  const a = Math.floor(totalGuntas / 40);
  const g = totalGuntas % 40;
  const parts: string[] = [];
  if (a > 0) parts.push(`${a} ${a === 1 ? 'acre' : 'acres'}`);
  if (g > 0 || a === 0) parts.push(`${g} ${g === 1 ? 'gunta' : 'guntas'}`);
  return parts.join(' ');
}

/**
 * Camera commands throw synchronously before the native view mounts and return a
 * promise that can reject while the style reloads. Neither is worth surfacing.
 */
export function runCamera(command: () => unknown) {
  try {
    const result = command();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Map not ready yet; the next user action will retry.
  }
}
