import {
  BlurMask,
  BlurStyle,
  Canvas,
  Circle,
  createPicture,
  DashPathEffect,
  FilterMode,
  Group,
  Image,
  LinearGradient,
  MipmapMode,
  PaintStyle,
  Path,
  Picture,
  Rect,
  Skia,
  StrokeCap,
  vec,
  type SkImage,
  type SkPath,
} from '@shopify/react-native-skia';
import { router } from 'expo-router';
import { ArrowRight, Trees } from 'lucide-react-native';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { Animated as RNAnimated, Easing as RNEasing, PixelRatio, StyleSheet, View, useWindowDimensions } from 'react-native';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
  cancelAnimation,
  Easing,
  type EntryExitAnimationFunction,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatPrice } from '@/lib/format';
import { font, palette, radius } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { BENGALURU_CENTRE } from '../location';
import { withAlpha } from '../meta';
import { Photo } from '../media/photo';
import {
  CALLOUT_H,
  CALLOUT_W,
  CALM,
  CALM_OMEGA,
  COMPASS,
  COMPASS_INSET,
  PANEL_H,
  PANEL_RADIUS,
  PILL_H,
  PILL_INSET,
  POINTER,
  placeCallouts,
  projectionOf,
  type CalloutBox,
  type Placed,
  type Pulse,
  type Rated,
} from './pulse-model';

/* ------------------------------------------------------------------ */
/* Palette                                                              */
/* ------------------------------------------------------------------ */

export const INK = palette.forest;
const GREEN = palette.green;
const LAND = ['#DCEFE5', '#CFE8DC'] as const;
/** The refined ground adds a paler mint and a faint sage for field patches. Still light, no lines. */
const LAND_SOFT = ['#E3F3EA', '#D5ECDF', '#E9F1DF'] as const;
const PANEL_TOP = '#E6F4EC';
const DOT_R = 4;
/** Featured dots closer than this share one callout. */
const CLEAR = 48;

/* ------------------------------------------------------------------ */
/* Motion helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Springs to `target` with CALM (instantly under reduced motion). Starts at `from` when given,
 * and waits `delay` ms on the first run only, so entrances stagger but later changes don't.
 */
export function useSpringTo(target: number, reduced: boolean, from?: number, delay = 0) {
  const v = useSharedValue(reduced || from === undefined ? target : from);
  const first = useRef(true);
  useEffect(() => {
    const wait = first.current ? delay : 0;
    first.current = false;
    if (reduced) v.set(target);
    else v.set(wait ? withDelay(wait, withSpring(target, CALM)) : withSpring(target, CALM));
  }, [target, reduced, delay, v]);
  return v;
}

/** Fade-and-rise entrance (6pt), once, after `delay` ms. */
export function useRise(reduced: boolean, delay = 0, distance = 6) {
  const p = useSpringTo(1, reduced, 0, delay);
  return useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (1 - p.get()) * distance }] }));
}

/* ------------------------------------------------------------------ */
/* Static art: soft land, pale roads, Bengaluru                         */
/* ------------------------------------------------------------------ */

/** A smooth closed blob through `n` wobbling points (Catmull-Rom as cubics). Deterministic per seed. */
function blobPath(cx: number, cy: number, rx: number, ry: number, seed: number): SkPath {
  const n = 9;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.14 * Math.sin(a * 2 + seed) + 0.08 * Math.sin(a * 3 + seed * 1.7);
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  const b = Skia.PathBuilder.Make();
  b.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    b.cubicTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  b.close();
  return b.detach();
}

/** Gentle curved roads leaving the city toward the panel edges. */
function roadPaths(x: number, y: number, w: number, h: number): SkPath[] {
  const reach = Math.hypot(w, h);
  return [-18, 52, 128, 205, 292].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const bend = (i % 2 ? 1 : -1) * 0.22;
    const ex = x + Math.cos(a) * reach;
    const ey = y + Math.sin(a) * reach;
    const mx = x + Math.cos(a + bend) * reach * 0.45;
    const my = y + Math.sin(a + bend) * reach * 0.45;
    return Skia.PathBuilder.Make().moveTo(x, y).quadTo(mx, my, ex, ey).detach();
  });
}

/** Deterministic 0–1 noise for scattering field patches. */
const hash = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Soft land blobs, pale roads and the Bengaluru dot, laid out around `city`. */
function landArt(w: number, h: number, city: { x: number; y: number }, rich: boolean) {
  const blobs: { p: SkPath; c: string; blur: number }[] = [
    { p: blobPath(city.x - w * 0.06, city.y + h * 0.02, w * 0.26, h * 0.42, 0.6), c: LAND[0], blur: 8 },
    { p: blobPath(w * 0.18, h * 0.82, w * 0.2, h * 0.3, 2.1), c: LAND[1], blur: 8 },
    { p: blobPath(w * 0.86, h * 0.72, w * 0.22, h * 0.36, 4.2), c: LAND[0], blur: 8 },
    { p: blobPath(w * 0.62, h * 0.12, w * 0.16, h * 0.22, 1.3), c: LAND[1], blur: 8 },
    { p: blobPath(city.x + w * 0.04, city.y - h * 0.04, w * 0.1, h * 0.16, 3.3), c: LAND[1], blur: 8 },
  ];
  if (rich) {
    // A wide pale layer reaching past the edges (so a re-fit pan never shows bare corners),
    // then small soft field patches scattered across it.
    const under = [
      { p: blobPath(w * 0.08, h * 0.2, w * 0.3, h * 0.5, 5.1), c: LAND_SOFT[0], blur: 14 },
      { p: blobPath(w * 0.5, h * 1.02, w * 0.36, h * 0.34, 0.9), c: LAND_SOFT[0], blur: 14 },
      { p: blobPath(w * 1.02, h * 0.18, w * 0.22, h * 0.4, 2.7), c: LAND_SOFT[0], blur: 14 },
      { p: blobPath(w * 0.4, h * 0.44, w * 0.18, h * 0.24, 6.3), c: LAND_SOFT[2], blur: 12 },
    ];
    const patches = Array.from({ length: 9 }, (_, i) => {
      const x = (0.06 + 0.88 * hash(i, 1)) * w;
      const y = (0.1 + 0.8 * hash(i, 2)) * h;
      const r = 10 + 12 * hash(i, 3);
      return { p: blobPath(x, y, r * 1.5, r, i * 1.9), c: LAND_SOFT[i % 3 === 0 ? 2 : 1], blur: 5 };
    });
    blobs.unshift(...under);
    blobs.push(...patches);
  }
  return { blobs, roads: roadPaths(city.x, city.y, w, h) };
}

/** The pale mint-to-white wash behind the land. */
function MapBackdrop({ width, height }: { width: number; height: number }) {
  return (
    <Rect x={0} y={0} width={width} height={height}>
      <LinearGradient start={vec(0, 0)} end={vec(width * 0.35, height)} colors={[PANEL_TOP, palette.white]} />
    </Rect>
  );
}

function MapLand({ width, height, city, rich = false }: { width: number; height: number; city: { x: number; y: number }; rich?: boolean }) {
  const art = useMemo(() => landArt(width, height, city, rich), [width, height, city.x, city.y, rich]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {art.blobs.map((b, i) => (
        <Path key={i} path={b.p} color={b.c}>
          <BlurMask blur={b.blur} style="normal" />
        </Path>
      ))}
      {art.roads.map((p, i) => (
        <Path key={i} path={p} style="stroke" strokeWidth={2.5} strokeCap="round" color={withAlpha(palette.white, 0.9)} />
      ))}
      <Circle cx={city.x} cy={city.y} r={4.5} color={palette.white} />
      <Circle cx={city.x} cy={city.y} r={2.5} color={withAlpha(INK, 0.5)} />
    </>
  );
}

/** How far the pre-drawn land reaches past the panel on each side, as a share of its size. */
const LAND_BLEED = 0.3;
const landImages = new Map<string, SkImage>();

/**
 * The land art drawn once into a bitmap (blurs and all) so the re-fit pan and zoom move one
 * textured quad per frame instead of re-blurring every blob. Cached per size; null when no
 * surface is available, in which case the caller draws the vector art.
 */
function landImage(w: number, h: number, city: { x: number; y: number }, rich: boolean): SkImage | null {
  const key = `${w}|${h}|${city.x.toFixed(1)}|${city.y.toFixed(1)}|${rich}`;
  const hit = landImages.get(key);
  if (hit) return hit;
  try {
    const d = Math.min(PixelRatio.get(), 3);
    const bx = w * LAND_BLEED;
    const by = h * LAND_BLEED;
    const pw = Math.ceil((w + bx * 2) * d);
    const ph = Math.ceil((h + by * 2) * d);
    const surface = Skia.Surface.MakeOffscreen(pw, ph) ?? Skia.Surface.Make(pw, ph);
    if (!surface) return null;
    const c = surface.getCanvas();
    c.scale(d, d);
    c.translate(bx, by);
    const art = landArt(w, h, city, rich);
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    for (const b of art.blobs) {
      paint.setColor(Skia.Color(b.c));
      paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, b.blur, true));
      c.drawPath(b.p, paint);
    }
    paint.setMaskFilter(null);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(2.5);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setColor(Skia.Color(withAlpha(palette.white, 0.9)));
    for (const r of art.roads) c.drawPath(r, paint);
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(Skia.Color(palette.white));
    c.drawCircle(city.x, city.y, 4.5, paint);
    paint.setColor(Skia.Color(withAlpha(INK, 0.5)));
    c.drawCircle(city.x, city.y, 2.5, paint);
    surface.flush();
    const snap = surface.makeImageSnapshot();
    // A raster copy: the GPU texture belongs to this thread's context, the canvas draws on the UI thread.
    const image = snap.makeNonTextureImage() ?? snap;
    if (landImages.size > 6) landImages.clear();
    landImages.set(key, image);
    return image;
  } catch {
    return null;
  }
}

const LAND_SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

/** The land art for the animated panel: the cached bitmap when there is one, vectors otherwise. */
function MapLandFast({ width, height, city, rich }: { width: number; height: number; city: { x: number; y: number }; rich: boolean }) {
  const image = useMemo(() => landImage(width, height, city, rich), [width, height, city.x, city.y, rich]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!image) return <MapLand width={width} height={height} city={city} rich={rich} />;
  const bx = width * LAND_BLEED;
  const by = height * LAND_BLEED;
  return <Image image={image} x={-bx} y={-by} width={width + bx * 2} height={height + by * 2} fit="fill" sampling={LAND_SAMPLING} />;
}

/**
 * The illustrated map ground: pale mint fading to white, a few soft green land blobs, pale roads
 * radiating from Bengaluru and its centre dot. No grid, no outlines. Drawn once per size.
 */
export function MapGround({ width, height, city, rich = false }: { width: number; height: number; city: { x: number; y: number }; rich?: boolean }) {
  return (
    <>
      <MapBackdrop width={width} height={height} />
      <MapLand width={width} height={height} city={city} rich={rich} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Parcel dots                                                          */
/* ------------------------------------------------------------------ */

/** What the panel wants each dot to be: where, whether it is leaving, and its pop-in delay if new. */
type DotTarget = { id: string; x: number; y: number; verified: boolean; leaving: boolean; delay: number };
/** One dot's current transition, from → to; `delay` holds back its pop (new dots only). */
type DotState = { id: string; verified: boolean; fx: number; fy: number; fp: number; tx: number; ty: number; tp: number; delay: number };

/** CALM's step response (critically damped, so x = 1 − (1 + ωt)·e^(−ωt)) at `ms` after it starts. */
function calm(ms: number) {
  'worklet';
  if (ms <= 0) return 0;
  const t = (ms / 1000) * CALM_OMEGA;
  return 1 - (1 + t) * Math.exp(-t);
}
/** Time for CALM to land within 0.1% of its target. */
const SETTLE_MS = Math.ceil((9.3 / CALM_OMEGA) * 1000);

const DOT_WHITE = Skia.Color(palette.white);
const DOT_GREEN = Skia.Color(GREEN);
const DOT_INK = Skia.Color(INK);

/**
 * Every parcel dot as one Skia picture, driven by one clock. Each dot is a white-haloed dot
 * (filled when verified) that pops in after its delay when new, glides to new positions, and
 * shrinks and fades away when leaving (a filter dropped it). Retargeting mid-flight carries on
 * from where each dot is. The per-dot springs and React nodes this replaces made a filter change
 * cost hundreds of mappers per frame; this is one recorded picture per frame while moving and
 * nothing at rest.
 */
function ParcelDots({
  dots,
  reduced,
  refined,
  width,
  height,
}: {
  dots: DotTarget[];
  reduced: boolean;
  refined: boolean;
  width: number;
  height: number;
}) {
  const targets = useSharedValue<{ dots: DotTarget[]; reduced: boolean } | null>(null);
  const field = useSharedValue<DotState[]>([]);
  const clock = useSharedValue(0);

  useEffect(() => {
    targets.set({ dots, reduced });
  }, [dots, reduced, targets]);

  useAnimatedReaction(
    () => targets.get(),
    (next) => {
      if (!next) return;
      const now = clock.get();
      const kMove = calm(now);
      const prev: Record<string, DotState> = {};
      for (const d of field.get()) prev[d.id] = d;
      const out: DotState[] = [];
      let wait = 0;
      for (const n of next.dots) {
        const tp = n.leaving ? 0 : 1;
        const o = prev[n.id];
        if (next.reduced) {
          if (!n.leaving) out.push({ id: n.id, verified: n.verified, fx: n.x, fy: n.y, fp: 1, tx: n.x, ty: n.y, tp: 1, delay: 0 });
          continue;
        }
        if (o) {
          const fp = o.fp + (o.tp - o.fp) * calm(now - o.delay);
          out.push({
            id: n.id,
            verified: n.verified,
            fx: o.fx + (o.tx - o.fx) * kMove,
            fy: o.fy + (o.ty - o.fy) * kMove,
            fp,
            tx: n.x,
            ty: n.y,
            tp,
            delay: 0,
          });
        } else if (!n.leaving) {
          out.push({ id: n.id, verified: n.verified, fx: n.x, fy: n.y, fp: 0, tx: n.x, ty: n.y, tp: 1, delay: n.delay });
          wait = Math.max(wait, n.delay);
        }
      }
      field.set(out);
      cancelAnimation(clock);
      const end = wait + SETTLE_MS;
      if (next.reduced) clock.set(end);
      else {
        clock.set(0);
        clock.set(withTiming(end, { duration: end, easing: Easing.linear }));
      }
    },
  );

  const picture = useDerivedValue(() => {
    const list = field.get();
    const now = clock.get();
    const kMove = calm(now);
    return createPicture(
      (c) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        const blur = refined ? Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 1.6, true) : null;
        const halo = DOT_R + (refined ? 2 : 1.5);
        for (const d of list) {
          const p = d.fp + (d.tp - d.fp) * calm(now - d.delay);
          if (p <= 0.001) continue;
          const x = d.fx + (d.tx - d.fx) * kMove;
          const y = d.fy + (d.ty - d.fy) * kMove;
          const a = Math.min(1, p * 1.4);
          if (blur) {
            paint.setColor(DOT_INK);
            paint.setAlphaf(0.1 * a);
            paint.setMaskFilter(blur);
            c.drawCircle(x, y, (DOT_R + 2.6) * p, paint);
            paint.setMaskFilter(null);
          }
          paint.setColor(DOT_WHITE);
          paint.setAlphaf(a);
          c.drawCircle(x, y, halo * p, paint);
          paint.setColor(DOT_GREEN);
          if (d.verified) {
            paint.setAlphaf(a);
            c.drawCircle(x, y, DOT_R * p, paint);
          } else {
            paint.setAlphaf(0.6 * a);
            paint.setStyle(PaintStyle.Stroke);
            paint.setStrokeWidth(1.5);
            c.drawCircle(x, y, (DOT_R - 0.75) * p, paint);
            paint.setStyle(PaintStyle.Fill);
          }
        }
      },
      { width, height },
    );
  });

  return <Picture picture={picture} />;
}

/* ------------------------------------------------------------------ */
/* Dotted route linking the featured parcels, cheap to dear             */
/* ------------------------------------------------------------------ */

type Slot = { x: SharedValue<number>; y: SharedValue<number> };

function useSlot(p: { x: number; y: number } | undefined, fallback: { x: number; y: number }, reduced: boolean): Slot {
  const t = p ?? fallback;
  return { x: useSpringTo(t.x, reduced), y: useSpringTo(t.y, reduced) };
}

function Route({
  points,
  reduced,
  width,
  height,
  redrawKey = '',
}: {
  points: { x: number; y: number }[];
  reduced: boolean;
  width: number;
  height: number;
  /** When this changes (new featured parcels), the route retracts and draws again. */
  redrawKey?: string;
}) {
  const centre = { x: width / 2, y: height / 2 };
  const a = useSlot(points[0], centre, reduced);
  const b = useSlot(points[1], points[0] ?? centre, reduced);
  const c = useSlot(points[2], points[1] ?? points[0] ?? centre, reduced);
  const count = points.length;
  const draw = useSharedValue(reduced ? 1 : 0);
  const first = useRef(true);
  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (reduced) draw.set(1);
    else if (isFirst) draw.set(withDelay(820, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) })));
    else
      draw.set(
        withSequence(
          withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) }),
          withDelay(120, withTiming(1, { duration: 640, easing: Easing.inOut(Easing.cubic) })),
        ),
      );
  }, [draw, reduced, redrawKey]);

  const path = useDerivedValue(() => {
    const builder = Skia.PathBuilder.Make();
    const p = [
      { x: a.x.get(), y: a.y.get() },
      { x: b.x.get(), y: b.y.get() },
      { x: c.x.get(), y: c.y.get() },
    ].slice(0, count);
    if (p.length < 2) return builder.detach();
    builder.moveTo(p[0].x, p[0].y);
    if (p.length === 2) {
      // One gentle arc between the two.
      const mx = (p[0].x + p[1].x) / 2;
      const my = (p[0].y + p[1].y) / 2;
      const dx = p[1].x - p[0].x;
      const dy = p[1].y - p[0].y;
      builder.quadTo(mx - dy * 0.18, my + dx * 0.18, p[1].x, p[1].y);
    } else {
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[Math.max(0, i - 1)];
        const p1 = p[i];
        const p2 = p[i + 1];
        const p3 = p[Math.min(p.length - 1, i + 2)];
        builder.cubicTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
      }
    }
    return builder.detach();
  });

  if (count < 2) return null;
  return (
    <Path path={path} start={0} end={draw} style="stroke" strokeWidth={2.4} strokeCap="round" color={withAlpha(GREEN, 0.55)}>
      <DashPathEffect intervals={[0.1, 6.5]} />
    </Path>
  );
}

/* ------------------------------------------------------------------ */
/* Photo callouts                                                       */
/* ------------------------------------------------------------------ */

const PHOTO = 44;
const FRAME_PAD = (CALLOUT_W - PHOTO) / 2;

function Pointer({ box }: { box: CalloutBox }) {
  const s = POINTER * 1.5;
  const half = s / 2;
  let pos;
  if (box.side === 'above') pos = { left: box.pointer - half, top: CALLOUT_H - half - 1 };
  else if (box.side === 'below') pos = { left: box.pointer - half, top: -half + 1 };
  else if (box.side === 'right') pos = { left: -half + 1, top: box.pointer - half };
  else pos = { left: CALLOUT_W - half - 1, top: box.pointer - half };
  return <View style={[styles.pointer, { width: s, height: s }, pos]} />;
}

/** What a callout says under its photo, and how a screen reader hears it. */
export type CalloutText = (r: Rated) => { value: string; a11y: string };
const perAcre: CalloutText = (r) => {
  const price = formatPrice(r.rate);
  return { value: price, a11y: `${price} per acre` };
};

/** "Narsapura Hobli, Kolar" → "Narsapura": the first name, minus admin suffixes. */
export function shortPlace(name: string) {
  const head = name.split(/[,/(|]| - /)[0].trim();
  const bare = head.replace(/\s+(taluk|taluka|hobli|village|grama|rural|town|post|district|dist\.?)$/i, '').trim();
  return bare || head || name;
}

/** Callouts scale from the side facing their dot. */
const ORIGIN: Record<CalloutBox['side'], string> = { above: '50% 100%', below: '50% 0%', left: '100% 50%', right: '0% 50%' };

function calloutIn(delay: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.86 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 200 })),
        transform: [{ scale: withDelay(delay, withSpring(1, CALM)) }],
      },
    };
  };
}

const calloutOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 180 }),
      transform: [{ scale: withTiming(0.86, { duration: 200 }) }],
    },
  };
};

function Callout({
  box,
  parcel,
  delay,
  reduced,
  text,
  refined,
}: {
  box: CalloutBox;
  parcel: Rated;
  delay: number;
  reduced: boolean;
  text: CalloutText;
  refined: boolean;
}) {
  const x = useSpringTo(box.x, reduced);
  const y = useSpringTo(box.y, reduced);
  // The glide is a translate on the outer slot (a transform stays on the UI thread; animating
  // left/top re-ran layout for the whole tree every frame). The inner view owns the entry/exit
  // scale and fade, scaled from the side facing its dot.
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));
  const { value, a11y } = text(parcel);
  const place = parcel.locality || parcel.district || 'Parcel';
  return (
    <Animated.View style={[styles.callout, slide]} pointerEvents="box-none">
      <Animated.View
        entering={reduced ? undefined : calloutIn(delay)}
        exiting={reduced ? undefined : calloutOut}
        style={[styles.calloutBody, { transformOrigin: ORIGIN[box.side] }]}>
      <PressableScale
        haptic="selection"
        to={0.95}
        onPress={() => router.push({ pathname: '/listing/[id]', params: { id: parcel.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${parcel.title || parcel.locality}, ${a11y}. Open listing`}
        style={[styles.frameShadow, refined && styles.frameShadowSoft]}>
        <Pointer box={box} />
        <View style={styles.frame}>
          <View style={styles.photo}>
            {parcel.photo ? (
              <Photo uri={parcel.photo} size="thumb" tint={palette.mintWash} recyclingKey={`pulse:${parcel.id}`} style={styles.photoImg} />
            ) : (
              <View style={styles.photoEmpty}>
                <Trees size={18} color={GREEN} strokeWidth={2} />
              </View>
            )}
          </View>
          {refined ? (
            <Text style={[styles.place, styles.placeRefined]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {shortPlace(place)}
            </Text>
          ) : (
            <Text style={styles.place} numberOfLines={1}>
              {place}
            </Text>
          )}
          <Text style={styles.rate} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {value}
          </Text>
        </View>
      </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                            */
/* ------------------------------------------------------------------ */

export function MapPill() {
  return (
    <PressableScale
      haptic="selection"
      to={0.95}
      onPress={() => router.navigate('/map')}
      accessibilityLabel="Open the map"
      style={styles.pill}>
      <Text style={styles.pillText}>Map</Text>
      <ArrowRight size={13} color={INK} strokeWidth={2.3} />
    </PressableScale>
  );
}

/** The panel's rounded ground on its own (loading and empty states use it without marks). */
export function MapPanelShell({ width, children }: { width: number; children?: ReactNode }) {
  const proj = projectionOf([], width, PANEL_H);
  const city = proj.toXY(BENGALURU_CENTRE.lat, BENGALURU_CENTRE.lng);
  return (
    <View style={[styles.panel, { width }]}>
      <View style={styles.clip}>
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <MapGround width={width} height={PANEL_H} city={city} />
        </Canvas>
      </View>
      <NorthMark />
      {children}
    </View>
  );
}

/** A small "N" in a soft white disc, bottom-left: the panel is a map, and north is up. */
function NorthMark() {
  return (
    <View style={styles.north} pointerEvents="none" accessible={false}>
      <View style={styles.northTick} />
      <Text style={styles.northText}>N</Text>
    </View>
  );
}

/** One soft ring off the median dot every few seconds: the only idle motion on the card. */
const BREATH_MS = 1700;
const BREATH_REST = 2600;
const BREATH_D = 10;

function Breath({ x, y, reduced, live }: { x: number; y: number; reduced: boolean; live: SharedValue<boolean> }) {
  const cx = useSpringTo(x, reduced);
  const cy = useSpringTo(y, reduced);
  // The ring loops on RN's native driver: it updates the view directly, so this idle motion never
  // goes through a Reanimated shadow-tree commit (which re-diffs the whole Explore tree per frame).
  const [on, setOn] = useState(false);
  useAnimatedReaction(
    () => live.get(),
    (now, was) => {
      if (now !== was) scheduleOnRN(setOn, now);
    },
  );
  const phase = useRef(new RNAnimated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      phase.setValue(1);
      return;
    }
    phase.setValue(1);
    const loop = RNAnimated.sequence([
      RNAnimated.delay(1600),
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(phase, { toValue: 0, duration: 0, useNativeDriver: true }),
          RNAnimated.timing(phase, { toValue: 1, duration: BREATH_MS, easing: RNEasing.out(RNEasing.quad), useNativeDriver: true }),
          RNAnimated.delay(BREATH_REST),
        ]),
      ),
    ]);
    loop.start();
    return () => loop.stop();
  }, [on, phase]);
  const place = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.get() - BREATH_D / 2 }, { translateY: cy.get() - BREATH_D / 2 }],
  }));
  const ring = {
    opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
  };
  return (
    <Animated.View pointerEvents="none" style={[styles.breathBox, place]}>
      <RNAnimated.View style={[styles.breath, ring]} />
    </Animated.View>
  );
}

/**
 * True while the panel is worth animating: screen focused, motion allowed, and (when the host
 * passes its scroll offset) the panel still inside the window. Only flips, never streams.
 */
function useLive(reduced: boolean, scrollY: SharedValue<number> | undefined, ref: RefObject<ComponentRef<typeof View> | null>) {
  const focused = useIsFocused();
  const { height: screenH } = useWindowDimensions();
  const awake = useSharedValue(false);
  /** Panel top in window coordinates at scroll offset 0, and its height. */
  const rest = useSharedValue({ top: 0, h: PANEL_H, known: false });
  const live = useSharedValue(false);

  useEffect(() => {
    awake.set(focused && !reduced);
  }, [awake, focused, reduced]);

  const measure = () => {
    const at = scrollY ? scrollY.get() : 0;
    ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => rest.set({ top: y + at, h, known: true }));
  };

  useAnimatedReaction(
    () => {
      if (!awake.get()) return false;
      const r = rest.get();
      if (!scrollY || !r.known) return true;
      const top = r.top - scrollY.get();
      return top + r.h > 0 && top < screenH;
    },
    (on, was) => {
      if (on !== was) live.set(on);
    },
  );
  return { live, measure };
}

export type PulseMapProps = {
  width: number;
  pulse: Pulse;
  reduced: boolean;
  /** Callout label under each photo; per-acre rate by default. */
  calloutText?: CalloutText;
  /** Dotted route linking the featured parcels, cheap to dear. */
  route?: boolean;
  /** The "Map" pill, top-right. */
  pill?: boolean;
  /** The median dot's soft idle ring. */
  breathe?: boolean;
  /** Host list's scroll offset, so idle motion pauses once the panel scrolls away. */
  scrollY?: SharedValue<number>;
  /** Richer land texture, lifted dots, softer callout shadows and short place names. */
  refined?: boolean;
};

type Ghost = Placed & { age: number };
/** How far the land itself zooms for a re-fit: a gentle echo of the dots' zoom, clamped. */
const groundZoom = (ratio: number) => Math.min(1.35, Math.max(0.8, Math.pow(ratio, 0.3)));

/**
 * "Land on the map": every parcel projected onto a soft illustrated Karnataka panel, the
 * cheapest, median and dearest parcels raised as photo callouts, joined cheap → dear by a dotted
 * route. Callouts open their listing; the pill opens the full map. When the fit changes (a land-
 * type filter), the ground crossfades rather than jumping.
 */
export function PulseMap({
  width,
  pulse,
  reduced,
  calloutText = perAcre,
  route: showRoute = true,
  pill = true,
  breathe = false,
  scrollY,
  refined = false,
}: PulseMapProps) {
  const proj = useMemo(() => projectionOf(pulse.placed, width, PANEL_H), [pulse.placed, width]);
  const city = proj.toXY(BENGALURU_CENTRE.lat, BENGALURU_CENTRE.lng);

  // Parcels a filter just dropped stay a moment as "ghosts" so they can shrink away; a ghost
  // that comes back (quick taps) is the same keyed dot and simply grows again.
  const placedKey = pulse.placed.map((p) => p.id).join(',');
  const [trail, setTrail] = useState<{ key: string; prev: Placed[]; ghosts: Ghost[] }>({ key: placedKey, prev: pulse.placed, ghosts: [] });
  if (trail.key !== placedKey) {
    const now = new Set(pulse.placed.map((p) => p.id));
    const seen = new Set<string>();
    const ghosts: Ghost[] = [];
    for (const g of [...trail.prev.map((p) => ({ ...p, age: 0 })), ...trail.ghosts.filter((g) => g.age < 1).map((g) => ({ ...g, age: g.age + 1 }))]) {
      if (now.has(g.id) || seen.has(g.id)) continue;
      seen.add(g.id);
      ghosts.push(g);
    }
    setTrail({ key: placedKey, prev: pulse.placed, ghosts });
  }

  // The land is drawn once around a base fit, then panned and gently zoomed to each new fit.
  const [base, setBase] = useState({ width, city, scale: proj.scale });
  if (base.width !== width) setBase({ width, city, scale: proj.scale });
  const cityX = useSpringTo(city.x, reduced);
  const cityY = useSpringTo(city.y, reduced);
  const zoom = useSpringTo(groundZoom(proj.scale / base.scale), reduced);
  const landTransform = useDerivedValue(() => [
    { translateX: cityX.get() },
    { translateY: cityY.get() },
    { scale: zoom.get() },
    { translateX: -base.city.x },
    { translateY: -base.city.y },
  ]);
  const cityLabel = useAnimatedStyle(() => ({ transform: [{ translateX: cityX.get() + 7 }, { translateY: cityY.get() - 15 }] }));

  const rise = useRise(reduced, 0, 8);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const later = mounted.current;

  // Everything below is a pure function of the data and the fit: computed once per change, so a
  // re-render of the card (Live beat, width, unrelated state) hands the dots the same targets.
  const layout = useMemo(() => {
    const dots = pulse.placed.map((p) => ({ ...p, ...proj.toXY(p.lat, p.lng) }));
    const byId = new Map(dots.map((d) => [d.id, d]));
    const route = pulse.featured.filter((r) => byId.has(r.id));
    // Median first, then the ends, each only if its dot is clear of the ones already raised:
    // a tight cluster gets one or two callouts rather than a pile.
    const priority = route.length === 3 ? [route[1], route[0], route[2]] : route;
    const raised: Rated[] = [];
    for (const r of priority) {
      const d = byId.get(r.id)!;
      if (raised.every((o) => Math.hypot(byId.get(o.id)!.x - d.x, byId.get(o.id)!.y - d.y) >= CLEAR)) raised.push(r);
    }
    const featured = route.filter((r) => raised.includes(r));
    const boxes = placeCallouts(
      featured.map((r) => {
        const d = byId.get(r.id)!;
        return { id: r.id, x: d.x, y: d.y };
      }),
      width,
      PANEL_H,
      { pill },
    );
    // Ghosts underneath, featured dots last so their pointers land on top of any neighbour.
    const featuredIds = new Set(route.map((r) => r.id));
    const ghosts = trail.ghosts.filter((g) => !byId.has(g.id)).map((g) => ({ ...g, ...proj.toXY(g.lat, g.lng) }));
    const ordered = [...dots.filter((d) => !featuredIds.has(d.id)), ...dots.filter((d) => featuredIds.has(d.id))];
    const targets: DotTarget[] = [
      ...ghosts.map((g) => ({ id: g.id, x: g.x, y: g.y, verified: g.verified, leaving: true, delay: 0 })),
      ...ordered.map((d, i) => ({
        id: d.id,
        x: d.x,
        y: d.y,
        verified: d.verified,
        leaving: false,
        delay: later ? 120 + Math.min(i, 12) * 12 : 180 + Math.min(i + ghosts.length, 30) * 18,
      })),
    ];
    return {
      targets,
      boxes,
      featured,
      routePoints: route.map((r) => byId.get(r.id)!),
      routeKey: route.map((r) => r.id).join(','),
      median: priority[0] ? byId.get(priority[0].id) : undefined,
    };
    // `later` only matters on the first pass (it flips after mount); it must not re-run this.
  }, [pulse, proj, width, pill, trail.ghosts]); // eslint-disable-line react-hooks/exhaustive-deps
  const { targets, boxes, featured, median } = layout;

  const panelRef = useRef<ComponentRef<typeof View>>(null);
  const { live, measure } = useLive(reduced || !breathe, scrollY, panelRef);

  return (
    <Animated.View ref={panelRef} onLayout={measure} style={[styles.panel, { width }, rise]}>
      <View style={styles.clip}>
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <MapBackdrop width={width} height={PANEL_H} />
          <Group transform={landTransform}>
            <MapLandFast width={base.width} height={PANEL_H} city={base.city} rich={refined} />
          </Group>
        </Canvas>
        <Animated.View style={[styles.cityBox, cityLabel]} pointerEvents="none">
          <Text style={styles.city} numberOfLines={1}>
            Bengaluru
          </Text>
        </Animated.View>
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          {showRoute ? (
            <Route points={layout.routePoints} reduced={reduced} width={width} height={PANEL_H} redrawKey={layout.routeKey} />
          ) : null}
          <ParcelDots dots={targets} reduced={reduced} refined={refined} width={width} height={PANEL_H} />
        </Canvas>
        {breathe && median ? <Breath x={median.x} y={median.y} reduced={reduced} live={live} /> : null}
      </View>
      <NorthMark />
      {boxes.map((b, i) => (
        <Callout
          key={b.id}
          box={b}
          parcel={featured[i]}
          delay={later ? 90 + i * 40 : 360 + i * 90}
          reduced={reduced}
          text={calloutText}
          refined={refined}
        />
      ))}
      {pill ? <MapPill /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: { height: PANEL_H },
  clip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: PANEL_RADIUS, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: PANEL_TOP },
  cityBox: { position: 'absolute', left: 0, top: 0 },
  city: { fontFamily: font.medium, fontSize: 10, lineHeight: 12, letterSpacing: 0.1, color: withAlpha(INK, 0.5) },
  callout: { position: 'absolute', left: 0, top: 0, width: CALLOUT_W, height: CALLOUT_H },
  calloutBody: { width: CALLOUT_W, height: CALLOUT_H },
  frameShadow: {
    width: CALLOUT_W,
    height: CALLOUT_H,
    borderRadius: 14,
    borderCurve: 'continuous',
    boxShadow: '0 1px 2px rgba(16,32,28,0.08), 0 6px 16px rgba(16,32,28,0.14)',
    backgroundColor: palette.white,
  },
  frameShadowSoft: { boxShadow: '0 1px 1.5px rgba(16,32,28,0.05), 0 8px 22px rgba(16,32,28,0.10)' },
  frame: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    padding: FRAME_PAD,
    alignItems: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: palette.white,
  },
  pointer: { position: 'absolute', borderRadius: 2, backgroundColor: palette.white, transform: [{ rotate: '45deg' }] },
  photo: { width: PHOTO, height: PHOTO, borderRadius: 10, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: palette.mintWash },
  photoImg: { width: PHOTO, height: PHOTO },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  place: {
    alignSelf: 'stretch',
    marginTop: 5,
    textAlign: 'center',
    fontFamily: font.medium,
    fontSize: 10,
    lineHeight: 12,
    color: withAlpha(INK, 0.6),
  },
  /** A little more room and a touch tighter, so "Narsapura" fits before it would shrink or clip. */
  placeRefined: { marginHorizontal: -3, letterSpacing: -0.15 },
  rate: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 13,
    color: INK,
    fontVariant: ['tabular-nums'],
  },
  pill: {
    position: 'absolute',
    top: PILL_INSET,
    right: PILL_INSET,
    height: PILL_H,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: palette.white,
    boxShadow: '0 1px 2px rgba(16,32,28,0.06), 0 4px 12px rgba(16,32,28,0.10)',
  },
  pillText: { fontFamily: font.semibold, fontSize: 13, lineHeight: 16, color: INK },
  north: {
    position: 'absolute',
    left: COMPASS_INSET,
    bottom: COMPASS_INSET,
    width: COMPASS,
    height: COMPASS,
    borderRadius: COMPASS / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(palette.white, 0.9),
    boxShadow: '0 1px 2px rgba(16,32,28,0.06), 0 3px 8px rgba(16,32,28,0.08)',
  },
  northTick: { position: 'absolute', top: 2.5, width: 2, height: 3.5, borderRadius: 1, backgroundColor: GREEN },
  northText: { marginTop: 2, fontFamily: font.semibold, fontSize: 9, lineHeight: 11, letterSpacing: 0.2, color: withAlpha(INK, 0.6) },
  breathBox: { position: 'absolute', left: 0, top: 0, width: BREATH_D, height: BREATH_D },
  breath: {
    width: BREATH_D,
    height: BREATH_D,
    borderRadius: BREATH_D / 2,
    borderWidth: 1.5,
    borderColor: GREEN,
  },
});
