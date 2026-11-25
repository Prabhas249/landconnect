import { toAcres } from '@/lib/format';
import type { AreaUnit, LandType, Listing } from '@/lib/types';
import { spring } from '@/theme/tokens';

import { median } from '../geometry';
import { BENGALURU_CENTRE, publicPoint } from '../location';

/* ------------------------------------------------------------------ */
/* Layout (points)                                                      */
/* ------------------------------------------------------------------ */

/** The map panel is inset from the card edge by this much on three sides. */
export const PANEL_INSET = 8;
export const PANEL_H = 152;
export const PANEL_RADIUS = 22;
export const CARD_RADIUS = 28;
/** Horizontal (and top) padding of the text block under the panel. */
export const PAD = 20;
export const PAD_BOTTOM = 20;
/** Content widths below this use the narrow variants (40pt figure). */
export const NARROW_BELOW = 300;

/** Callout: a 44pt photo in a white frame with two label lines under it. */
export const CALLOUT_W = 56;
export const CALLOUT_H = 85;
export const POINTER = 6;
/** Keep-out for the "Map" pill in the panel's top-right corner. */
export const PILL_W = 70;
export const PILL_H = 28;
export const PILL_INSET = 10;
/** The small "N" mark in the panel's bottom-left corner (callouts keep clear of it too). */
export const COMPASS = 22;
export const COMPASS_INSET = 10;

/* ------------------------------------------------------------------ */
/* Motion                                                               */
/* ------------------------------------------------------------------ */

/**
 * The gentle spring made critically damped (damping = 2·√(k·m)): settles in ~420 ms with no
 * overshoot. Every moving part of the card uses it.
 */
export const CALM = { ...spring.gentle, damping: 2 * Math.sqrt(spring.gentle.stiffness * spring.gentle.mass) };
/** ω of CALM, for the JS-side count-up so the figure lands with the springs. */
export const CALM_OMEGA = Math.sqrt(CALM.stiffness / CALM.mass);

/* ------------------------------------------------------------------ */
/* Market figures                                                       */
/* ------------------------------------------------------------------ */

export type Rated = {
  id: string;
  rate: number;
  type: LandType;
  verified: boolean;
  title: string;
  acres: number;
  areaValue: number;
  areaUnit: AreaUnit;
  locality: string;
  district: string;
  photo: string | null;
};

/** A parcel with a usable public point. */
export type Placed = { id: string; lat: number; lng: number; verified: boolean };

export type Pulse = {
  total: number;
  verified: number;
  /** Parcels with a usable per-acre rate, cheapest first. */
  rated: Rated[];
  medianRate: number;
  minRate: number;
  maxRate: number;
  districts: number;
  /** Most common state, for the caption ("across Karnataka"). */
  region: string;
  placed: Placed[];
  /** Cheapest, median and dearest parcel with a point (fewer when there are fewer). */
  featured: Rated[];
};

const validPoint = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function pulseOf(listings: Listing[]): Pulse {
  const rated: Rated[] = [];
  const placed: Placed[] = [];
  const districts = new Set<string>();
  const states = new Map<string, number>();
  let verified = 0;
  for (const l of listings) {
    const d = (l.district ?? '').trim().toLowerCase();
    if (d) districts.add(d);
    const st = (l.state ?? '').trim();
    if (st) states.set(st, (states.get(st) ?? 0) + 1);
    if (l.verified) verified += 1;
    const p = publicPoint(l, false);
    if (validPoint(p.lat, p.lng)) placed.push({ id: l.id, lat: p.lat, lng: p.lng, verified: l.verified });
    const acres = toAcres(l.area_value, l.area_unit);
    if (acres > 0 && l.price_total > 0) {
      rated.push({
        id: l.id,
        rate: l.price_total / acres,
        type: l.land_type,
        verified: l.verified,
        title: l.title,
        acres,
        areaValue: l.area_value,
        areaUnit: l.area_unit,
        locality: (l.locality || l.district || '').trim(),
        district: (l.district || '').trim(),
        photo: l.images[0] ?? null,
      });
    }
  }
  rated.sort((a, b) => a.rate - b.rate || a.id.localeCompare(b.id));
  const rates = rated.map((r) => r.rate);

  const onMap = new Set(placed.map((p) => p.id));
  const mappable = rated.filter((r) => onMap.has(r.id));
  let featured: Rated[];
  if (mappable.length <= 3) featured = mappable;
  else featured = [mappable[0], mappable[Math.floor((mappable.length - 1) / 2)], mappable[mappable.length - 1]];

  let region = 'Karnataka';
  let best = 0;
  for (const [name, n] of states) {
    if (n > best) {
      best = n;
      region = name;
    }
  }

  return {
    total: listings.length,
    verified,
    rated,
    medianRate: median(rates),
    minRate: rates.length ? rates[0] : 0,
    maxRate: rates.length ? rates[rates.length - 1] : 0,
    districts: districts.size,
    region,
    placed,
    featured,
  };
}

/* ------------------------------------------------------------------ */
/* Map projection                                                       */
/* ------------------------------------------------------------------ */

export type Projection = {
  toXY: (lat: number, lng: number) => { x: number; y: number };
  /** Points per degree of latitude: how far in the fit is zoomed. */
  scale: number;
};

/** Smallest span (degrees of latitude) the panel will zoom to, so a tight cluster stays a cluster. */
const MIN_SPAN = 0.35;
/** Dots stay this far from the panel edge. */
const EDGE = 22;

/**
 * Equirectangular fit of every placed parcel plus Bengaluru into the panel, aspect preserved
 * (longitude scaled by cos(latitude)) and centred.
 */
export function projectionOf(placed: Placed[], w: number, h: number): Projection {
  let minLat = BENGALURU_CENTRE.lat;
  let maxLat = BENGALURU_CENTRE.lat;
  let minLng = BENGALURU_CENTRE.lng;
  let maxLng = BENGALURU_CENTRE.lng;
  for (const p of placed) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const midLat = (minLat + maxLat) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const spanY = Math.max(maxLat - minLat, MIN_SPAN);
  const spanX = Math.max((maxLng - minLng) * k, MIN_SPAN);
  const innerW = w - EDGE * 2;
  const innerH = h - EDGE * 2;
  const s = Math.min(innerW / spanX, innerH / spanY);
  const cx = ((minLng + maxLng) / 2) * k;
  const cy = midLat;
  return {
    toXY: (lat, lng) => ({ x: w / 2 + (lng * k - cx) * s, y: h / 2 - (lat - cy) * s }),
    scale: s,
  };
}

/* ------------------------------------------------------------------ */
/* Callout placement                                                    */
/* ------------------------------------------------------------------ */

export type CalloutSide = 'above' | 'below' | 'left' | 'right';
export type CalloutBox = {
  id: string;
  /** The parcel dot the callout points at. */
  dot: { x: number; y: number };
  /** Top-left of the white frame. */
  x: number;
  y: number;
  side: CalloutSide;
  /** Pointer centre along the frame edge facing the dot (x for above/below, y for left/right). */
  pointer: number;
};

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? { ox, oy } : null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const SIDES: CalloutSide[] = ['above', 'below', 'right', 'left'];
/** Mild preference: above reads most like a pin, then below, then beside. */
const SIDE_COST: Record<CalloutSide, number> = { above: 0, below: 30, right: 60, left: 60 };

/**
 * Tries every side (above, below, right, left) for every callout (4^n, n ≤ 3) and keeps the
 * arrangement with no clipping, no frame over its own dot, the least overlap between frames and
 * with the Map pill, and the fewest featured dots hidden. A few nudging passes clean up anything
 * left. Pointers follow their dot along the facing edge.
 */
export function placeCallouts(
  dots: { id: string; x: number; y: number }[],
  w: number,
  h: number,
  opts: { pill?: boolean } = {},
): CalloutBox[] {
  const M = 6;
  const R = 12;
  const gap = POINTER + 2;
  const pill: Rect =
    opts.pill === false
      ? { x: -1000, y: -1000, w: 0, h: 0 }
      : { x: w - PILL_INSET - PILL_W - 4, y: 0, w: PILL_W + PILL_INSET + 4, h: PILL_INSET + PILL_H + 4 };
  const compass: Rect = { x: 0, y: h - COMPASS_INSET - COMPASS - 4, w: COMPASS_INSET + COMPASS + 4, h: COMPASS_INSET + COMPASS + 4 };
  const fixed = [pill, compass];

  const candidate = (d: { x: number; y: number }, side: CalloutSide) => {
    let x: number;
    let y: number;
    if (side === 'above') [x, y] = [d.x - CALLOUT_W / 2, d.y - gap - CALLOUT_H];
    else if (side === 'below') [x, y] = [d.x - CALLOUT_W / 2, d.y + gap];
    else if (side === 'right') [x, y] = [d.x + gap, d.y - CALLOUT_H / 2];
    else [x, y] = [d.x - gap - CALLOUT_W, d.y - CALLOUT_H / 2];
    const cx = clamp(x, M, w - M - CALLOUT_W);
    const cy = clamp(y, M, h - M - CALLOUT_H);
    // Sliding along the pointer edge is fine; sliding toward the dot would cover it.
    const across = side === 'above' || side === 'below' ? Math.abs(cy - y) : Math.abs(cx - x);
    return { x: cx, y: cy, w: CALLOUT_W, h: CALLOUT_H, bad: across > 2 ? 1 : 0 };
  };

  const n = dots.length;
  let best: { sides: CalloutSide[]; score: number } = { sides: dots.map(() => 'above'), score: Infinity };
  for (let combo = 0; combo < 4 ** n; combo++) {
    const sides = dots.map((_, i) => SIDES[Math.floor(combo / 4 ** i) % 4]);
    const rects = dots.map((d, i) => candidate(d, sides[i]));
    let score = 0;
    rects.forEach((r, i) => {
      score += r.bad * 1e6 + SIDE_COST[sides[i]];
      for (const k of fixed) {
        const p = overlap(r, k);
        if (p) score += p.ox * p.oy * 20;
      }
      dots.forEach((d, j) => {
        if (j !== i && d.x > r.x - 4 && d.x < r.x + r.w + 4 && d.y > r.y - 4 && d.y < r.y + r.h + 4) score += 400;
      });
      for (let j = i + 1; j < rects.length; j++) {
        const o = overlap(r, rects[j]);
        if (o) score += o.ox * o.oy * 10;
      }
    });
    if (score < best.score) best = { sides, score };
  }

  const boxes = dots.map((d, i) => ({ id: d.id, dot: d, side: best.sides[i], ...candidate(d, best.sides[i]) }));
  const fit = (b: Rect) => {
    b.x = clamp(b.x, M, w - M - b.w);
    b.y = clamp(b.y, M, h - M - b.h);
  };
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const o = overlap(a, b);
        if (!o) continue;
        moved = true;
        if (o.ox <= o.oy) {
          const dir = a.x + a.w / 2 <= b.x + b.w / 2 ? -1 : 1;
          a.x += (dir * (o.ox + 6)) / 2;
          b.x -= (dir * (o.ox + 6)) / 2;
        } else {
          const dir = a.y + a.h / 2 <= b.y + b.h / 2 ? -1 : 1;
          a.y += (dir * (o.oy + 6)) / 2;
          b.y -= (dir * (o.oy + 6)) / 2;
        }
        fit(a);
        fit(b);
      }
    }
    // The pill and the N mark never move: anything the nudges pushed onto them steps off
    // along the shorter way out.
    for (const b of boxes) {
      for (const k of fixed) {
        const o = overlap(b, k);
        if (!o) continue;
        moved = true;
        const steps = [
          { dx: k.x - (b.x + b.w), dy: 0 },
          { dx: k.x + k.w - b.x, dy: 0 },
          { dx: 0, dy: k.y - (b.y + b.h) },
          { dx: 0, dy: k.y + k.h - b.y },
        ]
          .filter((s) => b.x + s.dx >= M && b.x + s.dx <= w - M - b.w && b.y + s.dy >= M && b.y + s.dy <= h - M - b.h)
          .sort((p, q) => Math.abs(p.dx + p.dy) - Math.abs(q.dx + q.dy));
        if (!steps.length) continue;
        b.x += steps[0].dx;
        b.y += steps[0].dy;
        fit(b);
      }
    }
    if (!moved) break;
  }

  return boxes.map((b) => ({
    id: b.id,
    dot: b.dot,
    x: Math.round(b.x),
    y: Math.round(b.y),
    side: b.side,
    pointer:
      b.side === 'above' || b.side === 'below'
        ? clamp(b.dot.x - b.x, R, CALLOUT_W - R)
        : clamp(b.dot.y - b.y, R, CALLOUT_H - R),
  }));
}
