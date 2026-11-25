import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import {
  BlurMask,
  Canvas,
  Circle,
  DashPathEffect,
  Fill,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Oval,
  Path,
  Rect,
  RoundedRect,
  Skia,
  Text as SkText,
  useFont,
  useImage,
  usePathValue,
  vec,
  type SkFont,
  type SkImage,
  type Transforms3d,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, gutter, palette } from '@/theme/tokens';

import {
  applyCamera,
  buildLand,
  buildStoryCameras,
  callCardTop,
  cameraAt,
  DISC_R,
  FADE_START,
  GROUND_PX,
  ISO_Y,
  withAlpha,
  type Camera,
  type Land,
  type ParcelModel,
  type Pt,
  type TreeModel,
} from './scene';
import { CallCard } from './story-call';
import {
  BEAT,
  beat,
  clamp01,
  critical,
  easeInOut,
  easeOut,
  persistAfterDiscover,
  parallax,
  persistAfterTalk,
  settle,
  type Beat,
  type StoryTimeline,
} from './timeline';

/** Listing photos, shown as round thumbnails on each approximate area. */
const LISTING_PHOTOS = [
  require('../../../assets/images/onboarding/parcel-1.jpg'),
  require('../../../assets/images/onboarding/parcel-2.jpg'),
  require('../../../assets/images/onboarding/parcel-3.jpg'),
];
/** Top-down drone photographs, mapped onto a handful of parcels (see `GROUND_TARGETS`). */
const GROUND_PHOTOS = [
  require('../../../assets/images/onboarding/ground-1.jpg'),
  require('../../../assets/images/onboarding/ground-2.jpg'),
  require('../../../assets/images/onboarding/ground-3.jpg'),
  require('../../../assets/images/onboarding/ground-4.jpg'),
  require('../../../assets/images/onboarding/ground-5.jpg'),
];

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

/** Measurement readouts only (acreage, lengths, coordinates). Everything else is shape or photo. */
const LABEL_SIZE = 10.5;
const PILL_H = 20;
const PILL_PAD = 8;
/** Room for the status dot at the start of a capsule. */
const DOT_SPACE = 11;
/** How quickly a capsule pops in once its beat starts. */
const POP_MS = 260;
/** One period of the ambient loop: breathing areas, voice levels. */
const LOOP = 2400;
/** Survey reference point near Devanahalli. */
const LAT = 13.2468;
const LON = 77.7116;
const SQM_PER_ACRE = 4046.86;
/** Points on the morphing outline (approximate area → exact boundary). */
const MORPH_N = 72;
const THUMB_R = 15;
/** The land's entrance: the ripple outward from the chosen plot, and how long each parcel takes to settle. */
const INTRO_MS = 1700;
const RISE_MS = 620;
/** Price chips: a Geist figure with a small unit, a step up from the mono readouts. */
const PRICE_SIZE = 13;
const UNIT_SIZE = 10;
const PRICE_H = 24;
const PRICE_PAD = 10;
/** Asking price of the chosen plot, in crore per acre; the deal total follows from its acreage. */
const PRICE_CR_PER_ACRE = 1.8;
/** How far floating chips drift past the land mid-transition. */
const PARALLAX = 8;

const CANVAS_CLEAR = withAlpha(colors.canvas, 0);
const SHINE_CLEAR = withAlpha(palette.white, 0);

/**
 * Transform for a layer laid out in screen space as seen by camera `ref`, so it stays glued
 * to the land while the camera moves away from that pose. (screen' = A + k · screen)
 */
function useRelativeCamera(cams: Camera[], progress: SharedValue<number>, ref: number) {
  return useDerivedValue<Transforms3d>(() => {
    const c = cameraAt(cams, progress.get());
    const r = cams[ref];
    const k = c.z / r.z;
    return [
      { translateX: c.tx + c.z * (r.fx - c.fx) - k * r.tx },
      { translateY: c.ty + c.z * (r.fy - c.fy) - k * r.ty },
      { scale: k },
    ];
  });
}

/** Advance width (not ink bounds), so leading spaces and side bearings are counted. */
function advance(font: SkFont, text: string) {
  const widths = font.getGlyphWidths(font.getGlyphIDs(text));
  let w = 0;
  for (let i = 0; i < widths.length; i++) w += widths[i];
  return w;
}

/** Baseline offset that centres figures and capitals optically, whatever the font's line metrics. */
function capOffset(font: SkFont) {
  const b = font.measureText('0');
  return -(b.y + b.height / 2);
}

function pillWidth(font: SkFont, text: string, dot = false) {
  return advance(font, text) + PILL_PAD * 2 + (dot ? DOT_SPACE : 0);
}

/* ------------------------------------------------------------------ */
/* Land                                                                 */
/* ------------------------------------------------------------------ */

function Parcel({
  model,
  intro,
  photo,
  photoIn,
}: {
  model: ParcelModel;
  /** The land's one entrance clock, 0..1 (see `INTRO_MS`); each parcel reads its own slice. */
  intro: SharedValue<number>;
  /** This parcel's ground photo once decoded; until then the drawn block shows on its own. */
  photo: SkImage | null;
  photoIn: SharedValue<number>;
}) {
  // Already drawn on the first frame, sitting a little low; the ripple lifts it into place.
  // Nothing here waits on a JS effect, an image or a font: an empty field is impossible.
  const rise = useDerivedValue(() => easeOut(clamp01((intro.get() * INTRO_MS - model.delay) / RISE_MS)));
  const transform = useDerivedValue<Transforms3d>(() => [{ translateY: (1 - rise.get()) * 14 }]);
  const opacity = useDerivedValue(() => 0.72 + 0.28 * rise.get());

  return (
    <Group transform={transform} opacity={opacity}>
      <Path path={model.left} color={model.leftFill} />
      <Path path={model.right} color={model.rightFill} />
      <Path path={model.top} color={model.fill} />
      <GroundPhoto model={model} photo={photo} opacity={photoIn} />
      {model.rows ? (
        <Path path={model.rows} style="stroke" strokeWidth={1} strokeCap="round" color={model.rowColor} opacity={model.rowOpacity} />
      ) : null}
    </Group>
  );
}

/**
 * Real ground on a parcel's top face: the photo is mapped onto the face's plane, clipped to it,
 * then tinted toward the palette and given a surveyed hairline edge.
 */
function GroundPhoto({ model, photo, opacity }: { model: ParcelModel; photo: SkImage | null; opacity: SharedValue<number> }) {
  const { ground } = model;
  if (!ground || !photo) return null;
  return (
    <Group opacity={opacity} clip={model.top}>
      <Group matrix={ground.matrix}>
        <SkiaImage image={photo} x={0} y={0} width={GROUND_PX} height={GROUND_PX} />
      </Group>
      <Path path={model.top} color={palette.green} opacity={0.1} />
      <Path path={model.top} style="stroke" strokeWidth={1.2} strokeJoin="round" color={palette.white} opacity={0.55} />
    </Group>
  );
}

function Tree({ model, intro }: { model: TreeModel; intro: SharedValue<number> }) {
  const grow = useDerivedValue(() => easeOut(clamp01((intro.get() * INTRO_MS - model.delay) / RISE_MS)));
  const transform = useDerivedValue<Transforms3d>(() => [{ scale: 0.9 + 0.1 * grow.get() }]);
  const opacity = useDerivedValue(() => grow.get());
  const { x, y, r } = model;

  return (
    <Group transform={transform} origin={vec(x, y)} opacity={opacity}>
      <Oval x={x - r * 0.4} y={y - r * 0.45} width={r * 2.6} height={r * 0.9} color={palette.forest} opacity={0.12} />
      <Circle cx={x} cy={y - r * 1.05} r={r} color={palette.green} opacity={0.85} />
      <Circle cx={x - r * 0.32} cy={y - r * 1.38} r={r * 0.46} color={palette.mint} opacity={0.7} />
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 (Find): verified parcels surface on the map                  */
/* ------------------------------------------------------------------ */

/** A round photo thumbnail with a white ring, standing upright on the ground. */
function Thumb({ at, photo, r }: { at: Pt; photo: SkImage | null; r: number }) {
  const clip = useMemo(() => Skia.PathBuilder.Make().addCircle(at.x, at.y, r).build(), [at.x, at.y, r]);
  return (
    <Group>
      <Circle cx={at.x} cy={at.y + 2} r={r + 2.5} color={palette.forest} opacity={0.16}>
        <BlurMask blur={4} style="normal" />
      </Circle>
      <Circle cx={at.x} cy={at.y} r={r + 2.5} color={palette.white} />
      <Group clip={clip}>
        <Circle cx={at.x} cy={at.y} r={r} color={palette.mintSoft} />
        {photo ? <SkiaImage image={photo} x={at.x - r} y={at.y - r} width={r * 2} height={r * 2} fit="cover" /> : null}
      </Group>
    </Group>
  );
}

/**
 * A matching listing the buyer has not chosen: an approximate area (never an exact boundary) that
 * breathes softly, with its photo. Once another is chosen it quietens and its photo shrinks to a dot.
 */
function AreaDisc({
  center,
  rx,
  photo,
  appear,
  thumbIn,
  quiet,
  clock,
}: {
  center: Pt;
  rx: number;
  photo: SkImage | null;
  appear: SharedValue<number>;
  thumbIn: SharedValue<number>;
  quiet: SharedValue<number>;
  clock: SharedValue<number>;
}) {
  const ry = rx * ISO_Y;
  const origin = vec(center.x, center.y);
  const discTransform = useDerivedValue<Transforms3d>(() => [
    { scale: (0.9 + 0.1 * appear.get()) * (1 + 0.025 * Math.sin(clock.get() * Math.PI * 2) * (1 - quiet.get())) },
  ]);
  const discOpacity = useDerivedValue(() => clamp01(appear.get() * 1.6) * (1 - 0.55 * quiet.get()));
  const thumbTransform = useDerivedValue<Transforms3d>(() => [{ scale: (0.9 + 0.1 * thumbIn.get()) * (1 - 0.5 * quiet.get()) }]);
  const thumbOpacity = useDerivedValue(() => clamp01(thumbIn.get() * 1.6) * (1 - 0.3 * quiet.get()));

  return (
    <Group>
      <Group transform={discTransform} origin={origin} opacity={discOpacity}>
        <Oval x={center.x - rx} y={center.y - ry} width={rx * 2} height={ry * 2} color={palette.mintSoft} opacity={0.38} />
        <Oval x={center.x - rx} y={center.y - ry} width={rx * 2} height={ry * 2} color={palette.green} style="stroke" strokeWidth={1.4} opacity={0.7}>
          <DashPathEffect intervals={[5, 5]} />
        </Oval>
      </Group>
      <Group transform={thumbTransform} origin={origin} opacity={thumbOpacity}>
        <Thumb at={center} photo={photo} r={THUMB_R} />
      </Group>
    </Group>
  );
}

/**
 * Where the outline goes as the approximate area resolves: for each point on the ellipse, the point
 * on the exact boundary in the same direction from the centre. Built once; the morph only lerps.
 */
function buildMorph(center: Pt, rx: number, corners: Pt[]) {
  const ry = rx * ISO_Y;
  const ex: number[] = [];
  const ey: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  for (let i = 0; i < MORPH_N; i++) {
    const th = (i / MORPH_N) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(th) * rx;
    const dy = Math.sin(th) * ry;
    ex.push(center.x + dx);
    ey.push(center.y + dy);
    // Nearest hit of the ray (centre + s·d) on the four boundary edges.
    let best = Infinity;
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      const ux = b.x - a.x;
      const uy = b.y - a.y;
      const den = dx * uy - dy * ux;
      if (Math.abs(den) < 1e-6) continue;
      const s = ((a.x - center.x) * uy - (a.y - center.y) * ux) / den;
      const t = ((a.x - center.x) * dy - (a.y - center.y) * dx) / den;
      if (s > 0 && t >= -1e-6 && t <= 1 + 1e-6 && s < best) best = s;
    }
    const s = Number.isFinite(best) ? best : 1;
    bx.push(center.x + dx * s);
    by.push(center.y + dy * s);
  }
  return { ex, ey, bx, by };
}

/**
 * The chosen listing: its approximate area and — once buyer and owner connect — the area flowing
 * into the exact boundary in one continuous outline.
 */
function ChosenArea({
  land,
  photo,
  font,
  priceFonts,
  progress,
  discover,
  talk,
  clock,
  survey,
}: {
  land: Land;
  photo: SkImage | null;
  font: SkFont | null;
  priceFonts: PriceFonts | null;
  progress: SharedValue<number>;
  discover: SharedValue<number>;
  talk: SharedValue<number>;
  clock: SharedValue<number>;
  /** 0..1 as the camera reaches step 3, where the survey re-draws the boundary edge by edge. */
  survey: SharedValue<number>;
}) {
  const D = BEAT.find;
  const T = BEAT.connect;
  const { plot, unit } = land;
  const center = plot.center;
  const rx = unit * DISC_R[0];
  const ry = rx * ISO_Y;
  const morph = useMemo(() => buildMorph(center, rx, plot.corners), [center, rx, plot.corners]);

  const appear = useDerivedValue(() => Math.max(easeOut(beat(discover.get(), D.disc[0])), persistAfterDiscover(progress.get())));
  const thumbIn = useDerivedValue(() => Math.max(easeOut(beat(discover.get(), D.thumb[0])), persistAfterDiscover(progress.get())));
  const picked = useDerivedValue(() => Math.max(easeInOut(beat(discover.get(), D.pick)), persistAfterDiscover(progress.get())));
  const m = useDerivedValue(() => Math.max(easeInOut(beat(talk.get(), T.morph)), persistAfterTalk(progress.get())));
  const wash = useDerivedValue(() => Math.max(easeOut(beat(talk.get(), T.wash)), persistAfterTalk(progress.get())));

  const outline = usePathValue((b) => {
    'worklet';
    const t = m.get();
    const { ex, ey, bx, by } = morph;
    for (let i = 0; i < MORPH_N; i++) {
      const x = ex[i] + (bx[i] - ex[i]) * t;
      const y = ey[i] + (by[i] - ey[i]) * t;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    b.close();
  });

  const origin = vec(center.x, center.y);
  // Breathes while it is still an estimate; holds still once it is exact.
  const breathe = useDerivedValue<Transforms3d>(() => [
    { scale: (0.9 + 0.1 * appear.get()) * (1 + 0.025 * Math.sin(clock.get() * Math.PI * 2) * (1 - m.get())) },
  ]);
  const areaOpacity = useDerivedValue(() => clamp01(appear.get() * 1.6) * (1 - 0.7 * survey.get()));
  const estimateFill = useDerivedValue(() => 0.38 * (1 - wash.get()));
  const exactFill = useDerivedValue(() => 0.5 * wash.get());
  const greenStroke = useDerivedValue(() => 0.7 * (1 - picked.get()) * (1 - m.get()));
  const dashedAmber = useDerivedValue(() => picked.get() * (1 - m.get()));
  const solidAmber = useDerivedValue(() => m.get());

  const thumbTransform = useDerivedValue<Transforms3d>(() => [{ scale: (0.9 + 0.1 * thumbIn.get()) * (1 + 0.08 * picked.get()) }]);
  // The listing photo gives way to the land itself once the exact boundary is shown.
  const thumbOpacity = useDerivedValue(() => clamp01(thumbIn.get() * 1.6) * (1 - m.get()));

  // The step's one figure.
  const acreage = `${Math.round(plot.areaSqm / SQM_PER_ACRE)} acres`;
  const acreIn = useDerivedValue(() => beat(discover.get(), D.acreage) * (1 - clamp01(progress.get() * 2.2)));
  const acreW = font ? pillWidth(font, acreage) : 0;

  // Once picked, the listing earns a tick and shows its asking price above the photo.
  const leave = useDerivedValue(() => 1 - clamp01(progress.get() * 2.2));
  const verifiedIn = useDerivedValue(() => Math.max(beat(discover.get(), D.verified), persistAfterDiscover(progress.get())));
  const priceIn = useDerivedValue(() => beat(discover.get(), [D.price[0], POP_MS + 120]) * leave.get());
  const priceCount = useDerivedValue(() => beat(discover.get(), D.price));
  const drift = useDerivedValue(() => -parallax(progress.get()) * PARALLAX);
  const thumbOuter = THUMB_R + 2 + 2.5;
  const tickAt = { x: center.x + thumbOuter * 0.72, y: center.y - thumbOuter * 0.72 };

  return (
    <Group>
      <Group transform={breathe} origin={origin} opacity={areaOpacity}>
        <Path path={outline} color={palette.mintSoft} opacity={estimateFill} />
        <Path path={outline} color={palette.amberWash} opacity={exactFill} />
        <Path path={outline} style="stroke" strokeWidth={1.4} color={palette.green} opacity={greenStroke}>
          <DashPathEffect intervals={[5, 5]} />
        </Path>
        <Path path={outline} style="stroke" strokeWidth={1.8} color={palette.amber} opacity={dashedAmber}>
          <DashPathEffect intervals={[5, 5]} />
        </Path>
        <Path path={outline} style="stroke" strokeWidth={2.2} strokeJoin="round" color={palette.amber} opacity={solidAmber} />
      </Group>

      <Group transform={thumbTransform} origin={origin} opacity={thumbOpacity}>
        <Thumb at={center} photo={photo} r={THUMB_R + 2} />
        <VerifiedTick at={tickAt} appear={verifiedIn} />
      </Group>

      {priceFonts ? (
        <PricePill
          cx={center.x}
          y={center.y - thumbOuter * 1.08 - 8 - PRICE_H}
          fonts={priceFonts}
          value={PRICE_CR_PER_ACRE}
          unit="Cr / acre"
          appear={priceIn}
          count={priceCount}
          drift={drift}
        />
      ) : null}

      {font ? <Pill x={center.x - acreW / 2} y={center.y + ry + 8} w={acreW} font={font} text={acreage} appear={acreIn} /> : null}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Shared drawing bits                                                  */
/* ------------------------------------------------------------------ */

/** Floating label surface: white capsule with a soft tinted shadow, no border. */
function Capsule({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <Group>
      <RoundedRect x={x} y={y + 2} width={w} height={PILL_H} r={PILL_H / 2} color={palette.forest} opacity={0.1}>
        <BlurMask blur={3} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={w} height={PILL_H} r={PILL_H / 2} color={palette.white} />
    </Group>
  );
}

/**
 * The one style for every readout in the scene: small mono figures on a white capsule. Capsule and
 * text share one opacity and pop in together, and the caller only mounts it once the font exists —
 * so there is never a capsule without its words.
 */
function Pill({
  x,
  y,
  w,
  font,
  text,
  appear,
  dot,
}: {
  x: number;
  y: number;
  w: number;
  font: SkFont;
  text: string | SharedValue<string>;
  /** 0..1 linear; the pop is eased here. */
  appear: SharedValue<number>;
  dot?: string;
}) {
  const origin = vec(x + w / 2, y + PILL_H / 2);
  const opacity = useDerivedValue(() => clamp01(appear.get() * 1.8));
  const transform = useDerivedValue<Transforms3d>(() => [{ scale: 0.9 + 0.1 * critical(appear.get()) }]);
  const offset = capOffset(font);
  return (
    <Group transform={transform} origin={origin} opacity={opacity}>
      <Capsule x={x} y={y} w={w} />
      {dot ? <Circle cx={x + PILL_PAD + 2.5} cy={y + PILL_H / 2} r={2.5} color={dot} /> : null}
      <SkText x={x + PILL_PAD + (dot ? DOT_SPACE : 0)} y={y + PILL_H / 2 + offset} text={text} font={font} color={colors.ink} />
    </Group>
  );
}

export type PriceFonts = { figure: SkFont; unit: SkFont };

/**
 * A price on the land, in the Market-pulse style: white capsule, soft shadow, a Geist 700 figure
 * that counts up and a small unit after it. The unit sits at a fixed x (measured from the final
 * figure), so nothing shifts while the digits change. Springs in critically damped: no overshoot.
 */
function PricePill({
  cx,
  y,
  fonts,
  value,
  unit,
  appear,
  count,
  drift,
  dot,
}: {
  /** Horizontal centre of the capsule. */
  cx: number;
  y: number;
  fonts: PriceFonts;
  /** Final figure, in crore. */
  value: number;
  unit: string;
  /** 0..1 linear pop. */
  appear: SharedValue<number>;
  /** 0..1 linear count-up. */
  count: SharedValue<number>;
  /** Horizontal parallax offset, in points. */
  drift?: SharedValue<number>;
  dot?: string;
}) {
  const { figure, unit: unitFont } = fonts;
  const final = `₹${value.toFixed(1)}`;
  const figureW = advance(figure, final);
  const unitW = advance(unitFont, unit);
  const lead = dot ? DOT_SPACE : 0;
  const w = PRICE_PAD * 2 + lead + figureW + 3 + unitW;
  const x = cx - w / 2;
  const mid = y + PRICE_H / 2;
  const origin = vec(cx, mid);
  const figureBase = mid + capOffset(figure);
  const unitBase = mid + capOffset(unitFont);

  const opacity = useDerivedValue(() => clamp01(appear.get() * 1.8));
  const transform = useDerivedValue<Transforms3d>(() => {
    const c = critical(appear.get());
    return [{ translateX: drift ? drift.get() : 0 }, { translateY: (1 - c) * 6 }, { scale: 0.92 + 0.08 * c }];
  });
  const text = useDerivedValue(() => `₹${(value * critical(count.get())).toFixed(1)}`);

  return (
    <Group transform={transform} origin={origin} opacity={opacity}>
      <RoundedRect x={x} y={y + 3} width={w} height={PRICE_H} r={PRICE_H / 2} color={palette.forest} opacity={0.12}>
        <BlurMask blur={5} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={w} height={PRICE_H} r={PRICE_H / 2} color={palette.white} />
      {dot ? <Circle cx={x + PRICE_PAD + 2.5} cy={mid} r={2.5} color={dot} /> : null}
      <SkText x={x + PRICE_PAD + lead} y={figureBase} text={text} font={figure} color={colors.ink} />
      <SkText x={x + PRICE_PAD + lead + figureW + 3} y={unitBase} text={unit} font={unitFont} color={colors.inkSecondary} />
    </Group>
  );
}

/** A small verified tick that pops onto the chosen listing's photo once the buyer picks it. */
function VerifiedTick({ at, appear }: { at: Pt; appear: SharedValue<number> }) {
  const r = 6.5;
  const check = useMemo(
    () =>
      Skia.PathBuilder.Make()
        .moveTo(at.x - r * 0.42, at.y + r * 0.02)
        .lineTo(at.x - r * 0.1, at.y + r * 0.34)
        .lineTo(at.x + r * 0.45, at.y - r * 0.3)
        .build(),
    [at.x, at.y],
  );
  const opacity = useDerivedValue(() => clamp01(appear.get() * 2));
  const transform = useDerivedValue<Transforms3d>(() => [{ scale: 0.5 + 0.5 * critical(appear.get()) }]);
  const tick = useDerivedValue(() => clamp01((appear.get() - 0.35) / 0.65));
  return (
    <Group transform={transform} origin={vec(at.x, at.y)} opacity={opacity}>
      <Circle cx={at.x} cy={at.y} r={r + 1.5} color={palette.white} />
      <Circle cx={at.x} cy={at.y} r={r} color={palette.green} />
      <Path path={check} style="stroke" strokeWidth={1.6} strokeCap="round" strokeJoin="round" color={palette.white} start={0} end={tick} />
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 (Buy): the plot measured corner by corner, then sealed       */
/* ------------------------------------------------------------------ */

function rosette(cx: number, cy: number, r: number) {
  const b = Skia.PathBuilder.Make();
  const steps = 120;
  for (let j = 0; j <= steps; j++) {
    const th = (j / steps) * Math.PI * 2;
    const rr = r * (0.955 + 0.045 * Math.cos(16 * th));
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    if (j === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  return b.close().build();
}

const V = BEAT.buy;
/** When corner k is staked; edge k then runs from corner k to corner k + 1. */
const stakeBeat = (k: number): Beat => [V.stake[0] + k * V.edgeStep, V.stake[1]];
const edgeBeat = (k: number): Beat => [V.stake[0] + k * V.edgeStep + V.edgeDraw[0], V.edgeDraw[1]];
const EDGE_BEATS = [edgeBeat(0), edgeBeat(1), edgeBeat(2), edgeBeat(3)];
/** Capsules pop in quickly at the start of their beat, then their figures keep counting. */
const AREA_POP: Beat = [V.area[0], POP_MS];
const GEOTAG_POP: Beat = [V.geotag[0], POP_MS];

function buildSurvey(land: Land, cam: Camera) {
  const corners = land.plot.corners.map((c) => applyCamera(cam, c));
  const center = applyCamera(cam, land.plot.center);
  const lengths = corners.map((c, i) => {
    const n = corners[(i + 1) % 4];
    return Math.hypot(n.x - c.x, n.y - c.y);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  // Share of the boundary trim taken by each edge (trim runs by length, not by edge).
  const share = lengths.map((l) => l / total);

  const edges = corners.map((c, i) => {
    const n = corners[(i + 1) % 4];
    const mid = { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 };
    const dx = (n.x - c.x) / lengths[i];
    const dy = (n.y - c.y) / lengths[i];
    // Normal that points out of the plot, so each label sits on the outside of its own edge.
    const flip = (mid.x - center.x) * -dy + (mid.y - center.y) * dx < 0 ? -1 : 1;
    return { mid, nx: -dy * flip, ny: dx * flip, metres: Math.round(land.plot.edges[i]), index: i };
  });

  // The seal sits a little above centre so the area can rest beneath it without crowding the edges.
  const seal = { x: center.x, y: center.y - 20, r: 21 };
  const check = Skia.PathBuilder.Make()
    .moveTo(seal.x - seal.r * 0.36, seal.y + seal.r * 0.02)
    .lineTo(seal.x - seal.r * 0.08, seal.y + seal.r * 0.3)
    .lineTo(seal.x + seal.r * 0.4, seal.y - seal.r * 0.26)
    .build();

  return {
    corners,
    center,
    boundary: Skia.PathBuilder.Make()
      .moveTo(corners[0].x, corners[0].y)
      .lineTo(corners[1].x, corners[1].y)
      .lineTo(corners[2].x, corners[2].y)
      .lineTo(corners[3].x, corners[3].y)
      .close()
      .build(),
    share,
    edges,
    seal,
    sealPath: rosette(seal.x, seal.y, seal.r),
    check,
    /** Under the plot's nearest corner, clear of the edge labels. */
    geotag: { x: corners[2].x, y: corners[2].y + 14 },
    /** The area counts up at the centre, then settles beneath the seal. */
    areaFrom: center.y - PILL_H / 2,
    areaTo: seal.y + seal.r + 6,
  };
}

type SurveyGeometry = ReturnType<typeof buildSurvey>;

function Stake({ at, verify, index }: { at: Pt; verify: SharedValue<number>; index: number }) {
  const b = stakeBeat(index);
  const t = useDerivedValue(() => beat(verify.get(), b));
  const transform = useDerivedValue<Transforms3d>(() => [{ translateY: (1 - easeOut(t.get())) * -10 }, { scale: 0.9 + 0.1 * easeOut(t.get()) }]);
  const opacity = useDerivedValue(() => clamp01(t.get() * 3));
  return (
    <Group transform={transform} origin={vec(at.x, at.y)} opacity={opacity}>
      <Circle cx={at.x} cy={at.y + 1.5} r={5.5} color={palette.forest} opacity={0.2}>
        <BlurMask blur={2} style="normal" />
      </Circle>
      <Circle cx={at.x} cy={at.y} r={5.5} color={palette.amber} />
      <Circle cx={at.x} cy={at.y} r={2} color={palette.white} />
    </Group>
  );
}

function EdgeLabel({
  edge,
  verify,
  quiet,
  font,
}: {
  edge: SurveyGeometry['edges'][number];
  verify: SharedValue<number>;
  /** 0..1: steps back once the seal lands, so the poster reads seal → area → details. */
  quiet: SharedValue<number>;
  font: SkFont;
}) {
  const final = `${edge.metres} m`;
  const chars = final.length;
  const w = pillWidth(font, final);
  // Touch the edge at its midpoint from the outside: push out by the capsule's extent along the normal.
  const push = Math.abs(edge.nx) * (w / 2) + Math.abs(edge.ny) * (PILL_H / 2) + 3;
  const cx = edge.mid.x + edge.nx * push;
  const cy = edge.mid.y + edge.ny * push;

  const b = EDGE_BEATS[edge.index];
  const pop: Beat = [b[0], POP_MS];
  const appear = useDerivedValue(() => beat(verify.get(), pop));
  // Mono digits keep the capsule still while the figure counts up with the line.
  const text = useDerivedValue(() => `${Math.round(edge.metres * easeInOut(beat(verify.get(), b)))} m`.padStart(chars, ' '));
  const quietTransform = useDerivedValue<Transforms3d>(() => [{ scale: 1 - 0.1 * quiet.get() }]);
  const quietOpacity = useDerivedValue(() => 1 - 0.45 * quiet.get());
  return (
    <Group transform={quietTransform} origin={vec(cx, cy)} opacity={quietOpacity}>
      <Pill x={cx - w / 2} y={cy - PILL_H / 2} w={w} font={font} text={text} appear={appear} />
    </Group>
  );
}

function SurveyLayer({
  geo,
  transform,
  visible,
  verify,
  areaSqm,
  font,
  priceFonts,
  width,
}: {
  geo: SurveyGeometry;
  transform: SharedValue<Transforms3d>;
  visible: SharedValue<number>;
  verify: SharedValue<number>;
  areaSqm: number;
  font: SkFont | null;
  priceFonts: PriceFonts | null;
  width: number;
}) {
  const { share } = geo;
  const edgeEnd = useDerivedValue(() => {
    const t = verify.get();
    let end = 0;
    for (let k = 0; k < 4; k++) end += share[k] * easeInOut(beat(t, EDGE_BEATS[k]));
    return end;
  });
  const areaT = useDerivedValue(() => easeOut(beat(verify.get(), V.area)));
  const fillOpacity = useDerivedValue(() => areaT.get() * 0.4);
  const areaAppear = useDerivedValue(() => beat(verify.get(), AREA_POP));
  const settleT = useDerivedValue(() => easeInOut(beat(verify.get(), V.settle)));
  const areaShift = useDerivedValue<Transforms3d>(() => [{ translateY: (geo.areaTo - geo.areaFrom) * settleT.get() }]);

  const sealT = useDerivedValue(() => beat(verify.get(), V.seal));
  const sealCheck = useDerivedValue(() => easeOut(beat(verify.get(), V.check)));
  const sealRing = useDerivedValue(() => beat(verify.get(), V.ring));
  const sealOrigin = vec(geo.seal.x, geo.seal.y);
  const sealTransform = useDerivedValue<Transforms3d>(() => [{ scale: 1.6 - 0.6 * settle(sealT.get()) }]);
  const sealOpacity = useDerivedValue(() => clamp01(sealT.get() * 2.5));
  const ringTransform = useDerivedValue<Transforms3d>(() => [{ scale: 1 + sealRing.get() * 1.1 }]);
  const ringOpacity = useDerivedValue(() => (sealRing.get() > 0 && sealRing.get() < 1 ? (1 - sealRing.get()) * 0.6 : 0));

  // One soft sweep of light across the seal once it has landed; gone at rest (and under reduced motion).
  const shine = useDerivedValue(() => beat(verify.get(), V.shimmer));
  const shineBand = geo.seal.r * 0.8;
  const shineTransform = useDerivedValue<Transforms3d>(() => [
    { translateX: geo.seal.r * (-1.7 + 3.4 * easeInOut(shine.get())) },
    { skewX: -0.4 },
  ]);
  const shineOpacity = useDerivedValue(() => Math.sin(Math.PI * shine.get()) * 0.9);

  // The accepted offer: the asking price times the plot's acreage, counting up as it settles in.
  const offerIn = useDerivedValue(() => beat(verify.get(), [V.offer[0], POP_MS + 120]));
  const offerCount = useDerivedValue(() => beat(verify.get(), V.offer));

  // Plain language, matching the listing: the plot is 8 acres.
  const acres = Math.round(areaSqm / SQM_PER_ACRE);
  const offerTotal = Math.round(PRICE_CR_PER_ACRE * acres * 10) / 10;
  const areaFinal = `${acres} acres`;
  const areaText = useDerivedValue(() => {
    const n = Math.round(acres * areaT.get());
    return n === 1 ? '1 acre ' : `${n} acres`;
  });

  const geoFinal = `${LAT.toFixed(4)}° N  ${LON.toFixed(4)}° E`;
  // GPS converging: the fix starts loose and settles on the plot.
  const geoText = useDerivedValue(() => {
    const loose = (1 - easeOut(beat(verify.get(), V.geotag))) ** 2;
    return `${(LAT + loose * 0.0137).toFixed(4)}° N  ${(LON - loose * 0.0091).toFixed(4)}° E`;
  });
  const geoAppear = useDerivedValue(() => beat(verify.get(), GEOTAG_POP));

  const areaW = font ? pillWidth(font, areaFinal) : 0;
  const geoW = font ? pillWidth(font, geoFinal) : 0;
  const geoX = Math.min(width - gutter - geoW, Math.max(gutter, geo.geotag.x - geoW / 2));

  return (
    <Group transform={transform} opacity={visible}>
      <Path path={geo.boundary} color={palette.amberWash} opacity={fillOpacity} />
      <Path path={geo.boundary} style="stroke" strokeWidth={2.4} strokeJoin="round" strokeCap="round" color={palette.amber} start={0} end={edgeEnd} />
      {geo.corners.map((c, i) => (
        <Stake key={`k${i}`} at={c} verify={verify} index={i} />
      ))}

      {font ? geo.edges.map((e) => <EdgeLabel key={`e${e.index}`} edge={e} verify={verify} quiet={settleT} font={font} />) : null}
      {font ? <Pill x={geoX} y={geo.geotag.y} w={geoW} font={font} text={geoText} appear={geoAppear} /> : null}
      {font ? (
        <Group transform={areaShift}>
          <Pill x={geo.center.x - areaW / 2} y={geo.areaFrom} w={areaW} font={font} text={areaText} appear={areaAppear} />
        </Group>
      ) : null}

      <Group transform={ringTransform} origin={sealOrigin} opacity={ringOpacity}>
        <Circle cx={geo.seal.x} cy={geo.seal.y} r={geo.seal.r} color={palette.green} style="stroke" strokeWidth={1.5} />
      </Group>
      <Group transform={sealTransform} origin={sealOrigin} opacity={sealOpacity}>
        <Circle cx={geo.seal.x} cy={geo.seal.y + 4} r={geo.seal.r * 0.9} color={palette.forest} opacity={0.22}>
          <BlurMask blur={6} style="normal" />
        </Circle>
        <Path path={geo.sealPath} color={palette.green} />
        <Circle cx={geo.seal.x} cy={geo.seal.y} r={geo.seal.r * 0.74} color={palette.mint} style="stroke" strokeWidth={1} opacity={0.6} />
        <Path path={geo.check} style="stroke" strokeWidth={2.6} strokeCap="round" strokeJoin="round" color={palette.white} start={0} end={sealCheck} />
        <Group clip={geo.sealPath} opacity={shineOpacity}>
          <Group transform={shineTransform} origin={sealOrigin}>
            <Rect x={geo.seal.x - shineBand / 2} y={geo.seal.y - geo.seal.r} width={shineBand} height={geo.seal.r * 2}>
              <LinearGradient
                start={vec(geo.seal.x - shineBand / 2, 0)}
                end={vec(geo.seal.x + shineBand / 2, 0)}
                colors={[SHINE_CLEAR, withAlpha(palette.white, 0.55), SHINE_CLEAR]}
              />
            </Rect>
          </Group>
        </Group>
      </Group>

      {priceFonts ? (
        <PricePill
          cx={geo.seal.x}
          y={geo.seal.y - geo.seal.r - 10 - PRICE_H}
          fonts={priceFonts}
          value={offerTotal}
          unit="Cr · offer accepted"
          appear={offerIn}
          count={offerCount}
          dot={palette.green}
        />
      ) : null}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Story canvas                                                         */
/* ------------------------------------------------------------------ */

export type StoryCanvasProps = {
  width: number;
  height: number;
  /** Fractional pager position, 0..2. Drives the camera and every cross-fade. */
  progress: SharedValue<number>;
  /** Per-panel clocks from `useStoryTimeline`; every beat in the scene reads from them. */
  timeline: StoryTimeline;
  reduced: boolean;
  /** First y below anything overlaid on the hero (the brand row); subjects stay beneath it. */
  top: number;
  /** First y taken by the copy that overlaps the hero's bottom; the call card sits above it. */
  bottom?: number;
};

/**
 * One continuous aerial scene for the whole welcome story, in three steps — Find, Connect, Buy:
 * verified parcels surface on the map and the buyer picks one → buyer and owner talk on a private
 * in-app line under anonymous IDs, real names revealed at the end → the plot is measured edge by
 * edge, verified, and sealed. The camera glides over the same
 * land; things transform rather than cut. Static geometry is built once; per frame only
 * transforms, opacity, trim, one morphing outline and a few short strings change, on the UI thread.
 */
export function StoryCanvas({ width, height, progress, timeline, reduced, top, bottom }: StoryCanvasProps) {
  const copyTop = bottom ?? height - 84;
  const land = useMemo(() => buildLand(width, height), [width, height]);
  const cams = useMemo(() => buildStoryCameras(land, width, top, copyTop), [land, width, top, copyTop]);
  const surveyGeo = useMemo(() => buildSurvey(land, cams[2]), [land, cams]);
  const font = useFont(GeistMono_500Medium, LABEL_SIZE);
  const priceFigure = useFont(Geist_700Bold, PRICE_SIZE);
  const priceUnit = useFont(Geist_500Medium, UNIT_SIZE);
  const priceFonts = useMemo(() => (priceFigure && priceUnit ? { figure: priceFigure, unit: priceUnit } : null), [priceFigure, priceUnit]);
  // Every image starts decoding on mount, long before its step needs it; fallbacks draw meanwhile.
  const l0 = useImage(LISTING_PHOTOS[0]);
  const l1 = useImage(LISTING_PHOTOS[1]);
  const l2 = useImage(LISTING_PHOTOS[2]);
  const g0 = useImage(GROUND_PHOTOS[0]);
  const g1 = useImage(GROUND_PHOTOS[1]);
  const g2 = useImage(GROUND_PHOTOS[2]);
  const g3 = useImage(GROUND_PHOTOS[3]);
  const g4 = useImage(GROUND_PHOTOS[4]);
  const groundPhotos = [g0, g1, g2, g3, g4];
  const groundsReady = groundPhotos.every((g) => g !== null);
  // Ground photos fade in over the drawn blocks together once decoded, so nothing pops.
  const photoIn = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!groundsReady) return;
    photoIn.set(reduced ? 1 : withTiming(1, { duration: 600 }));
  }, [groundsReady, reduced, photoIn]);

  const [discover, talk, verify] = timeline.clocks;
  const D = BEAT.find;

  // Ambient: the road settling in, and one slow loop for breathing areas and voice levels.
  // The land's entrance: one UI-thread clock for every parcel and tree, instead of ~50 springs
  // each started from a JS effect. The road needs no entrance at all.
  const intro = useSharedValue(reduced ? 1 : 0);
  const clock = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    intro.set(withTiming(1, { duration: INTRO_MS, easing: Easing.linear }));
    clock.set(withRepeat(withTiming(1, { duration: LOOP, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(intro);
      cancelAnimation(clock);
    };
  }, [reduced, intro, clock]);

  const landTransform = useDerivedValue<Transforms3d>(() => {
    const c = cameraAt(cams, progress.get());
    return [{ translateX: c.tx }, { translateY: c.ty }, { scale: c.z }, { translateX: -c.fx }, { translateY: -c.fy }];
  });
  const surveyTransform = useRelativeCamera(cams, progress, 2);

  const v1 = useDerivedValue(() => clamp01(1 - Math.abs(progress.get() - 1) * 1.6));
  const v2 = useDerivedValue(() => clamp01(1 - (2 - progress.get()) * 1.6));
  const cardUp = useDerivedValue(() => Math.max(easeOut(beat(talk.get(), BEAT.connect.card)), persistAfterTalk(progress.get())));
  // Land not taking part steps back; a little more while the call card is up.
  const veil = useDerivedValue(() => v1.get() * (0.3 + 0.12 * cardUp.get()) + v2.get() * 0.3);
  const focus = useDerivedValue(() => clamp01(v1.get() + v2.get()));

  // The two listings not chosen: they surface, then quieten once the buyer picks.
  const picked = useDerivedValue(() => Math.max(easeInOut(beat(discover.get(), D.pick)), persistAfterDiscover(progress.get())));
  const disc1 = useDerivedValue(() => Math.max(easeOut(beat(discover.get(), D.disc[1])), persistAfterDiscover(progress.get())));
  const disc2 = useDerivedValue(() => Math.max(easeOut(beat(discover.get(), D.disc[2])), persistAfterDiscover(progress.get())));
  const thumb1 = useDerivedValue(() => Math.max(easeOut(beat(discover.get(), D.thumb[1])), persistAfterDiscover(progress.get())));
  const thumb2 = useDerivedValue(() => Math.max(easeOut(beat(discover.get(), D.thumb[2])), persistAfterDiscover(progress.get())));

  const { unit } = land;
  const chosenParcel = useMemo(() => land.parcels.find((p) => p.ground?.index === 0) ?? null, [land.parcels]);
  const fadeTop = height * FADE_START;

  return (
    <View style={{ width, height }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color={colors.canvasDeep} />

        <Group transform={landTransform}>
          <Path path={land.road} color={palette.white} opacity={0.85} />
          {land.parcels.map((p) => (
            <Parcel key={p.key} model={p} intro={intro} photo={p.ground ? groundPhotos[p.ground.index] : null} photoIn={photoIn} />
          ))}
          {land.trees.map((t) => (
            <Tree key={t.key} model={t} intro={intro} />
          ))}
          <AreaDisc center={land.listings[1]} rx={unit * DISC_R[1]} photo={l1} appear={disc1} thumbIn={thumb1} quiet={picked} clock={clock} />
          <AreaDisc center={land.listings[2]} rx={unit * DISC_R[2]} photo={l2} appear={disc2} thumbIn={thumb2} quiet={picked} clock={clock} />
        </Group>

        <Rect x={0} y={0} width={width} height={height} color={colors.canvas} opacity={veil} />

        {/* The chosen plot stays the richest thing on screen through every step. */}
        <Group transform={landTransform}>
          {chosenParcel ? <GroundPhoto model={chosenParcel} photo={g0} opacity={focus} /> : null}
          <ChosenArea land={land} photo={l0} font={font} priceFonts={priceFonts} progress={progress} discover={discover} talk={talk} clock={clock} survey={v2} />
        </Group>

        {/* Calm the status bar area, then dissolve the land into the canvas under the copy. */}
        <Rect x={0} y={0} width={width} height={height * 0.18}>
          <LinearGradient start={vec(0, 0)} end={vec(0, height * 0.18)} colors={[withAlpha(colors.canvas, 0.9), CANVAS_CLEAR]} />
        </Rect>
        <Rect x={0} y={fadeTop} width={width} height={height - fadeTop + 1}>
          <LinearGradient
            start={vec(0, fadeTop)}
            end={vec(0, height)}
            colors={[CANVAS_CLEAR, withAlpha(colors.canvas, 0.72), colors.canvas]}
            positions={[0, 0.5, 1]}
          />
        </Rect>

        <SurveyLayer
          geo={surveyGeo}
          transform={surveyTransform}
          visible={v2}
          verify={verify}
          areaSqm={land.plot.areaSqm}
          font={font}
          priceFonts={priceFonts}
          width={width}
        />
      </Canvas>

      <CallCard width={width} top={callCardTop(copyTop)} progress={progress} talk={talk} clock={clock} reduced={reduced} />
    </View>
  );
}
