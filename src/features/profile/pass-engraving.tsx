import { Circle, DashPathEffect, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { qk } from '@/data/keys';
import { fetchMyListings, fetchSavedListings } from '@/data/listings';
import { fuzzLocation, toAcres } from '@/lib/format';
import type { LngLat, Profile } from '@/lib/types';
import { canManageListings } from '@/stores/session';
import { palette } from '@/theme/tokens';

/** Bengaluru city centre: the engraving's fixed reference point. */
const BLR = { lat: 12.9716, lng: 77.5946 };
/** Smallest map span (degrees) so a single nearby parcel does not blow up to fill the card. */
const MIN_SPAN = 0.12;
/** Engraved line: 1pt mint at 55%. */
const STROKE = 1;
const INK = 0.55;

export type EngravingKind = 'parcels' | 'shortlist' | 'compass' | 'loading';

type Site = { id: string; lat: number; lng: number; acres: number; outline: LngLat[] | null };

export type PassEngravingData = {
  kind: EngravingKind;
  sites: Site[];
  /** Field label and value for the pass's front strip, so the engraving is named in words. */
  label: string;
  value: string;
  /** Caption under the engraving on the back of the pass. */
  caption: string;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function acresText(a: number) {
  return a < 10 ? `${Math.round(a * 10) / 10}` : `${Math.round(a)}`;
}

/**
 * What the pass engraves, from the member's own data:
 * sellers and brokers see their own parcels' true outlines (they own those boundaries);
 * buyers see the approximate areas of their shortlist; anyone without either sees a compass on their city.
 */
export function usePassEngraving(profile: Profile): PassEngravingData {
  const manages = canManageListings(profile.role);
  const mine = useQuery({ queryKey: qk.myListings, queryFn: fetchMyListings, enabled: manages });
  const saved = useQuery({ queryKey: qk.savedListings, queryFn: fetchSavedListings, enabled: !manages });
  const city = profile.city ?? 'Karnataka';

  if (manages) {
    if (mine.isPending) return { kind: 'loading', sites: [], label: 'Holdings', value: '', caption: '' };
    const own = (mine.data ?? []).filter((l) => l.status !== 'sold');
    if (own.length > 0) {
      const sites = own.map((l) => ({
        id: l.id,
        lat: l.lat,
        lng: l.lng,
        acres: toAcres(l.area_value, l.area_unit),
        outline: l.boundary && l.boundary.length >= 3 ? l.boundary : null,
      }));
      const total = sites.reduce((s, x) => s + x.acres, 0);
      return {
        kind: 'parcels',
        sites,
        label: 'Holdings',
        value: `${plural(sites.length, 'parcel', 'parcels')} · ${acresText(total)} ${total === 1 ? 'acre' : 'acres'}`,
        caption: 'Your parcels, relative to Bengaluru',
      };
    }
  } else {
    if (saved.isPending) return { kind: 'loading', sites: [], label: 'Shortlist', value: '', caption: '' };
    const list = saved.data ?? [];
    if (list.length > 0) {
      // Other owners' parcels: only ever their approximate area, offset the same way the map does.
      const sites = list.map((l) => {
        const at = l.hide_exact_location ? fuzzLocation(l.id, l.lat, l.lng) : { lat: l.lat, lng: l.lng };
        return { id: l.id, lat: at.lat, lng: at.lng, acres: toAcres(l.area_value, l.area_unit), outline: null };
      });
      return { kind: 'shortlist', sites, label: 'Shortlist', value: `${sites.length} saved`, caption: 'Your shortlist, relative to Bengaluru' };
    }
  }
  return { kind: 'compass', sites: [], label: 'Based in', value: city, caption: `Based in ${city}` };
}

export type Box = { x: number; y: number; w: number; h: number };

type Placed = { cx: number; cy: number; glyph: SkPath; dot: boolean };

/** Equirectangular around Bengaluru, fitted into the box with room for each glyph. */
function layout(sites: Site[], kind: EngravingKind, box: Box) {
  const k = Math.cos((BLR.lat * Math.PI) / 180);
  const pts = sites.map((s) => ({ x: (s.lng - BLR.lng) * k, y: -(s.lat - BLR.lat) }));
  const all = [...pts, { x: 0, y: 0 }];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const maxAcres = Math.max(...sites.map((s) => s.acres), 0.01);
  const glyphMax = Math.min(30, box.h * 0.34);
  const inset = glyphMax / 2 + 2;
  const fitW = box.w - inset * 2;
  const fitH = box.h - inset * 2;
  const spanX = Math.max(maxX - minX, MIN_SPAN);
  const spanY = Math.max(maxY - minY, MIN_SPAN);
  const scale = Math.min(fitW / spanX, fitH / spanY);
  const ox = box.x + box.w / 2 - ((minX + maxX) / 2) * scale;
  const oy = box.y + box.h / 2 - ((minY + maxY) / 2) * scale;
  const to = (p: { x: number; y: number }) => ({ cx: ox + p.x * scale, cy: oy + p.y * scale });

  const placed: Placed[] = sites.map((s, i) => {
    const { cx, cy } = to(pts[i]);
    // Glyph size follows true area (square-root, so a 40-acre parcel is not 40x a 1-acre one).
    const size = Math.max(10, glyphMax * Math.sqrt(s.acres / maxAcres));
    if (kind === 'parcels' && s.outline) return { cx, cy, glyph: outlinePath(s.outline, cx, cy, size), dot: true };
    // Approximate area: a ring, never a boundary.
    return { cx, cy, glyph: Skia.PathBuilder.Make().addCircle(cx, cy, size / 2).build(), dot: true };
  });
  return { placed, city: to({ x: 0, y: 0 }) };
}

/** The parcel's own boundary, true to shape, scaled so its longest side is `size`. */
function outlinePath(ring: LngLat[], cx: number, cy: number, size: number): SkPath {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const lng0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const local = ring.map(([lng, lat]) => ({ x: (lng - lng0) * k, y: -(lat - lat0) }));
  let span = 0;
  for (const p of local) span = Math.max(span, Math.abs(p.x) * 2, Math.abs(p.y) * 2);
  const s = span > 0 ? size / span : 1;
  const b = Skia.PathBuilder.Make();
  local.forEach((p, i) => {
    const x = cx + p.x * s;
    const y = cy + p.y * s;
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  });
  b.close();
  return b.build();
}

function bearingPath(from: { cx: number; cy: number }, to: { cx: number; cy: number }): SkPath {
  return Skia.PathBuilder.Make().moveTo(from.cx, from.cy).lineTo(to.cx, to.cy).build();
}

/** A clean engraved rose: a tick ring (long every 30°), and a north needle. */
function compassPaths(cx: number, cy: number, r: number) {
  const ring = Skia.PathBuilder.Make().addCircle(cx, cy, r).build();
  const ticks = Skia.PathBuilder.Make();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const inner = i % 3 === 0 ? r - 5 : r - 2.5;
    ticks.moveTo(cx + inner * Math.sin(a), cy - inner * Math.cos(a)).lineTo(cx + r * Math.sin(a), cy - r * Math.cos(a));
  }
  const w = r * 0.16;
  const n = r - 8;
  const north = Skia.PathBuilder.Make().moveTo(cx, cy - n).lineTo(cx + w, cy).lineTo(cx - w, cy).close().build();
  const south = Skia.PathBuilder.Make().moveTo(cx, cy + n * 0.7).lineTo(cx + w, cy).lineTo(cx - w, cy).close().build();
  const cross = Skia.PathBuilder.Make()
    .moveTo(cx - n * 0.7, cy)
    .lineTo(cx + n * 0.7, cy)
    .build();
  return { ring, ticks: ticks.build(), north, south, cross };
}

/**
 * The engraving, drawn into an enclosing Skia `Canvas` on the back of the pass. Fine mint lines;
 * `draw` (0..1) traces them in the first time the pass is turned over.
 */
export function Engraving({
  data,
  box,
  draw,
  tint = palette.mint,
}: {
  data: PassEngravingData;
  box: Box;
  draw: SharedValue<number>;
  /** Line colour: mint on a dark ground, brand green on a light one. */
  tint?: string;
}) {
  const art = useMemo(() => {
    if (data.kind === 'compass') return { compass: compassPaths(box.x + box.w * 0.68, box.y + box.h / 2, Math.min(box.h / 2, box.w / 3) - 2) };
    if (data.kind === 'loading' || data.sites.length === 0) return {};
    return { map: layout(data.sites, data.kind, box) };
  }, [data, box]);

  if (art.compass) {
    const c = art.compass;
    return (
      <Group>
        <Path path={c.ring} style="stroke" strokeWidth={STROKE} color={tint} opacity={INK} start={0} end={draw} />
        <Path path={c.ticks} style="stroke" strokeWidth={STROKE} color={tint} opacity={INK} end={draw} />
        <Path path={c.cross} style="stroke" strokeWidth={STROKE} color={tint} opacity={INK * 0.6} end={draw} />
        <Path path={c.south} style="stroke" strokeWidth={STROKE} color={tint} opacity={INK} end={draw} />
        <Path path={c.north} color={tint} opacity={INK} />
      </Group>
    );
  }

  if (!art.map) return null;
  const { placed, city } = art.map;
  return (
    <Group>
      {/* Bearings from the city centre: where each parcel lies from Bengaluru. */}
      {placed.map((p, i) => (
        <Path key={`b${i}`} path={bearingPath(city, p)} style="stroke" strokeWidth={STROKE} color={tint} opacity={INK * 0.5} start={0} end={draw}>
          <DashPathEffect intervals={[2, 3]} />
        </Path>
      ))}
      <Circle cx={city.cx} cy={city.cy} r={3} style="stroke" strokeWidth={STROKE} color={tint} opacity={INK} />
      <Circle cx={city.cx} cy={city.cy} r={1} color={tint} opacity={INK} />
      {placed.map((p, i) => (
        <Group key={`p${i}`}>
          <Path path={p.glyph} color={tint} opacity={0.07} />
          <Path path={p.glyph} style="stroke" strokeWidth={STROKE} strokeJoin="round" color={tint} opacity={INK} start={0} end={draw} />
          {p.dot ? <Circle cx={p.cx} cy={p.cy} r={1.4} color={palette.amber} opacity={0.85} /> : null}
        </Group>
      ))}
    </Group>
  );
}
