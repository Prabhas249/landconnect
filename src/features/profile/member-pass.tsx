import { Canvas, DashPathEffect, LinearGradient, Path, RadialGradient, Rect, Skia, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient as Gradient } from 'expo-linear-gradient';
import { useIsFocused } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Rect as SvgRect } from 'react-native-svg';

import { LogoLockup, LogoMark } from '@/features/auth/logo-mark';
import { ROLE_COPY, type Profile } from '@/lib/types';
import { colors, font, palette, radius, shadow, space, spring } from '@/theme/tokens';
import { initialsOf } from '@/ui/avatar';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { Engraving, usePassEngraving, type Box, type PassEngravingData } from './pass-engraving';
import { ROLE_RING, serialOf, withAlpha } from './parts';

/* ------------------------------------------------------------------ */
/* Geometry: ISO ID-1 card, everything derived from the measured width  */
/* ------------------------------------------------------------------ */

const ASPECT = 1.586;
const CARD_R = radius.xl;
const PAD = space[5];
const TOP_H = 24;
const LABEL_H = 12;
const VALUE_H = 20;
const FIELD_H = LABEL_H + 2 + VALUE_H;
/** The forest band along the foot of the pass that carries ID, holdings and year. */
const BAND_PAD = 14;
const BAND_H = FIELD_H + BAND_PAD * 2;
/** Breathing room between the portrait row and the band. */
const ABOVE_BAND = space[4];
const SEAL = 20;
const FRAME = 2;
/** White mat between the role frame and the photo, like a printed ID photo. */
const MAT = 1.5;
const PHOTO_R = radius.md;
const PHOTO_W = 72;
const PHOTO_H = 88;
/** Muted labels: ink at 45% on the light body, white at 50% on the forest band. */
const FAINT = withAlpha(palette.forest, 0.45);
const FAINT_ON_BAND = withAlpha(palette.white, 0.5);
const BACK_HEAD_H = LABEL_H + 2 + 30;
const BACK_CAPTION_H = 16;
const NAME = { fontFamily: font.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.6 } as const;

/** Calm: the sensor moves the pass at most 4°, a finger at most 6°. */
const SENSOR_MAX = 4;
const PRESS_MAX = 6;
/** Degrees of card tilt per m/s² of gravity change (about 6° of phone tilt per m/s²). */
const SENSOR_GAIN = 0.8;
/** Smallest tilt change (deg) worth a frame. */
const TILT_STEP = 0.08;

/** The app's light card shadow (0 12 32, forest @ 8%) over a hairline contact shadow. */
const CARD_SHADOW = `${shadow.hair}, 0 12px 32px rgba(16,32,28,0.08)`;
const CARD_BORDER = withAlpha(palette.forest, 0.05);
/** Pass material: white into a pale mint corner, so the pass is airy with a hint of the brand. */
const MATERIAL = [palette.white, '#F6FBF8', palette.mintWash] as const;
/** The forest band: brand forest, deepening into a green-lit end. */
const BAND = [palette.forest, '#132925', '#1A3B32'] as const;
/** The security foil along the band's top edge: the four brand tones, repeated so it can slide with the tilt. */
const FOIL = [palette.mint, '#3B6FD8', palette.amber, palette.mint, '#3B6FD8', palette.amber, palette.mint] as const;
const FOIL_H = 2;
/**
 * The one moving light, a 96pt band leaning 20°. A faint mint and amber fringe either side of the
 * white core gives it a holographic edge, so it still reads on the airy white body, not only on forest.
 */
const SHEEN_W = 96;
const SHEEN = [
  withAlpha(palette.white, 0),
  withAlpha(palette.mint, 0.1),
  withAlpha(palette.white, 0.55),
  withAlpha(palette.amber, 0.08),
  withAlpha(palette.white, 0),
] as const;
const SHEEN_STOPS = [0, 0.3, 0.5, 0.7, 1] as const;
const SHEEN_MS = 1200;
const DRAW_MS = 1400;
const WATERMARK = 96;

function geometry(w: number) {
  const h = w / ASPECT;
  const free = h - BAND_H - PAD - TOP_H - ABOVE_BAND;
  const gap = Math.max(space[2], free - PHOTO_H);
  const middle = Math.max(56, free - gap);
  const photoH = Math.min(PHOTO_H, middle);
  const photoW = Math.round((photoH * PHOTO_W) / PHOTO_H);
  return { w, h, pad: PAD, gap, middle, photoH, photoW };
}
type Geometry = ReturnType<typeof geometry>;

function clamp(v: number, lo: number, hi: number) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/* ------------------------------------------------------------------ */
/* Tilt from the phone's gravity vector                                 */
/* ------------------------------------------------------------------ */

/**
 * Mounted only while the screen is focused and motion is allowed, so the sensor is registered
 * only then. A fast low-pass smooths jitter; a slow one tracks how the phone is being held, so
 * the pass rests flat at any holding angle and only answers to movement.
 */
function TiltSensor({ x, y, onAvailability }: { x: SharedValue<number>; y: SharedValue<number>; onAvailability: (ok: boolean) => void }) {
  const { sensor, isAvailable } = useAnimatedSensor(SensorType.GRAVITY, { interval: 'auto' });
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const ready = useSharedValue(0);

  useEffect(() => {
    onAvailability(isAvailable);
  }, [isAvailable, onAvailability]);

  useEffect(
    () => () => {
      x.set(withSpring(0, spring.gentle));
      y.set(withSpring(0, spring.gentle));
    },
    [x, y],
  );

  useAnimatedReaction(
    () => sensor.get(),
    (g) => {
      // The first events can be all zeros; wait for a real reading before settling the baseline.
      if (Math.abs(g.x) + Math.abs(g.y) + Math.abs(g.z) < 1) return;
      if (ready.get() === 0) {
        fx.set(g.x);
        fy.set(g.y);
        bx.set(g.x);
        by.set(g.y);
        ready.set(1);
        return;
      }
      const nfx = fx.get() + (g.x - fx.get()) * 0.12;
      const nfy = fy.get() + (g.y - fy.get()) * 0.12;
      const nbx = bx.get() + (g.x - bx.get()) * 0.005;
      const nby = by.get() + (g.y - by.get()) * 0.005;
      fx.set(nfx);
      fy.set(nfy);
      bx.set(nbx);
      by.set(nby);
      // Only write a visible change: every write re-renders the pass (a Reanimated commit of the
      // whole screen), and sensor noise on a still phone would otherwise do that every frame.
      const ny = clamp(-(nfx - nbx) * SENSOR_GAIN, -SENSOR_MAX, SENSOR_MAX);
      const nx = clamp((nfy - nby) * SENSOR_GAIN, -SENSOR_MAX, SENSOR_MAX);
      if (Math.abs(ny - y.get()) > TILT_STEP) y.set(ny);
      if (Math.abs(nx - x.get()) > TILT_STEP) x.set(nx);
    },
  );

  return null;
}

/* ------------------------------------------------------------------ */
/* Small parts                                                          */
/* ------------------------------------------------------------------ */

function sealPaths() {
  const c = SEAL / 2;
  const b = Skia.PathBuilder.Make();
  // Twelve soft lobes: a notary seal edge, embossed rather than flat.
  for (let s = 0; s <= 96; s++) {
    const t = (s / 96) * Math.PI * 2;
    const r = c - 1 - 0.9 * (1 + Math.cos(12 * t)) * 0.5;
    const x = c + r * Math.cos(t);
    const y = c + r * Math.sin(t);
    if (s === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  b.close();
  const check = Skia.PathBuilder.Make()
    .moveTo(c - 3.6, c + 0.2)
    .lineTo(c - 1, c + 2.8)
    .lineTo(c + 4, c - 2.6)
    .build();
  const ring = Skia.PathBuilder.Make().addCircle(c, c, c - 1.2).build();
  return { edge: b.build(), check, ring };
}

/** The pass's only verified mark: a brand-green seal with a mint-to-amber foil hairline. */
function Seal({ verified, reduced }: { verified: boolean; reduced: boolean }) {
  const art = useMemo(sealPaths, []);
  const stamp = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    stamp.set(withDelay(900, withSpring(1, spring.gentle)));
  }, [reduced, stamp]);
  const style = useAnimatedStyle(() => ({
    opacity: stamp.get(),
    transform: [{ scale: 1.25 - 0.25 * stamp.get() }],
  }));
  return (
    <Animated.View style={[styles.seal, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={StyleSheet.absoluteFill}>
        {verified ? (
          <>
            <Path path={art.edge} color={colors.accent} />
            <Path path={art.edge} style="stroke" strokeWidth={0.9}>
              <LinearGradient start={vec(0, 0)} end={vec(SEAL, SEAL)} colors={[palette.mint, palette.amber, palette.mint]} />
            </Path>
            <Path path={art.check} style="stroke" strokeWidth={1.8} strokeCap="round" strokeJoin="round" color={palette.white} />
          </>
        ) : (
          <Path path={art.ring} style="stroke" strokeWidth={1.2} color={colors.inkTertiary}>
            <DashPathEffect intervals={[2.5, 2.5]} />
          </Path>
        )}
      </Canvas>
    </Animated.View>
  );
}

function Portrait({ profile, uri, uploading, g }: { profile: Profile; uri: string | null; uploading: boolean; g: Geometry }) {
  const tones = ROLE_RING[profile.role];
  // The role colour, softened: full tone at the lit corner, fading to a wash, so it frames rather than shouts.
  const frame = [withAlpha(tones[0], 0.85), withAlpha(tones[tones.length - 1], 0.35)] as const;
  const [failed, setFailed] = useState<string | null>(null);
  const photo = uri && failed !== uri ? uri : null;
  return (
    <Gradient colors={frame} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.frame, { width: g.photoW, height: g.photoH }]}>
      <View style={styles.mat}>
      <View style={styles.photo}>
        <Text variant="heading" style={styles.initials}>
          {initialsOf(profile.display_name)}
        </Text>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={{ duration: 320, effect: 'cross-dissolve', timing: 'ease-out' }}
            cachePolicy="memory-disk"
            onError={() => setFailed(photo)}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {uploading ? (
          <View style={[StyleSheet.absoluteFill, styles.uploading]}>
            <ActivityIndicator color={palette.white} />
          </View>
        ) : null}
      </View>
      </View>
    </Gradient>
  );
}

/** Deterministic 32-bit stream from the anonymous ID, so every pass back is its own. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

const GRID = 9;

/** A pattern grown from the anonymous ID: unique to it, not a scannable code. The mark sits in its centre. */
function IdPattern({ serial, size }: { serial: string; size: number }) {
  const cells = useMemo(() => {
    const next = seeded(serial);
    const out: { x: number; y: number; strong: boolean }[] = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (x >= 3 && x <= 5 && y >= 3 && y <= 5) continue;
        const v = next();
        if (v < 0.42) out.push({ x, y, strong: true });
        else if (v < 0.62) out.push({ x, y, strong: false });
      }
    return out;
  }, [serial]);
  const cell = size / GRID;
  const inset = cell * 0.12;
  return (
    <View style={[styles.patternTile, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Gradient colors={BAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg width={size} height={size}>
        {cells.map((c) => (
          <SvgRect
            key={`${c.x}-${c.y}`}
            x={c.x * cell + inset}
            y={c.y * cell + inset}
            width={cell - inset * 2}
            height={cell - inset * 2}
            rx={cell * 0.28}
            fill={palette.mint}
            fillOpacity={c.strong ? 0.85 : 0.28}
          />
        ))}
      </Svg>
      <View style={[styles.patternMark, { left: cell * 3, top: cell * 3, width: cell * 3, height: cell * 3 }]}>
        <LogoMark size={cell * 3 - space[2]} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Faces                                                                */
/* ------------------------------------------------------------------ */

type Motion = {
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
  /** 0 → 1 carries the sheen once across the card. */
  sheen: SharedValue<number>;
  draw: SharedValue<number>;
};

/** Parallax: layers nearer the glass travel further with the tilt. */
function useDepth(m: Motion, depth: number) {
  return useAnimatedStyle(() => ({
    transform: [{ translateX: m.tiltY.get() * depth }, { translateY: -m.tiltX.get() * depth }],
  }));
}

/**
 * One sheen band above everything. It sweeps across once (on mount and on each flip), then rests
 * just off the right edge, where tilting the pass brings it back in like light catching a card.
 */
function Sheen({ g, m }: { g: Geometry; m: Motion }) {
  const style = useAnimatedStyle(() => {
    const tilt = clamp(m.tiltY.get() / PRESS_MAX, -1, 1);
    const from = -SHEEN_W * 2;
    const to = g.w + SHEEN_W;
    return { transform: [{ translateX: from + (to - from) * m.sheen.get() + tilt * g.w * 0.6 }, { rotate: '20deg' }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.sheen, { top: -g.h * 0.4, height: g.h * 1.8 }, style]}>
      <Gradient colors={SHEEN} locations={SHEEN_STOPS} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** Pass material: white into pale mint, one soft mint glow behind the lockup corner. No texture, no lines. */
function Material({ g }: { g: Geometry }) {
  return (
    <>
      <Gradient colors={MATERIAL} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={g.w} height={g.h}>
          <RadialGradient
            c={vec(g.w * 0.86, g.h * 0.12)}
            r={Math.max(g.w, g.h) * 0.62}
            colors={[withAlpha(palette.mint, 0.22), withAlpha(palette.mint, 0)]}
          />
        </Rect>
      </Canvas>
    </>
  );
}

/** Forest band along the foot of the front: the pass's one block of brand colour. */
function Band({ g, m, children }: { g: Geometry; m: Motion; children: ReactNode }) {
  // The foil slides a little with the tilt, so its colours shift the way a real security strip does.
  const foil = useAnimatedStyle(() => ({
    transform: [{ translateX: -g.w * (0.5 + clamp(m.tiltY.get() / PRESS_MAX, -1, 1) * 0.35) }],
  }));
  const mark = useDepth(m, -0.5);
  return (
    <View style={styles.band}>
      <Gradient colors={BAND} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.bandGlow} />
      {/* The LandConnect mark, pressed faintly into the band like a watermark. */}
      <Animated.View pointerEvents="none" style={[styles.watermark, mark]}>
        <LogoMark size={WATERMARK} tile={false} />
      </Animated.View>
      <View pointerEvents="none" style={styles.foilClip}>
        <Animated.View style={[styles.foil, { width: g.w * 2 }, foil]}>
          <Gradient colors={FOIL} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
      <View style={styles.fields}>{children}</View>
    </View>
  );
}

type FaceProps = {
  profile: Profile;
  g: Geometry;
  m: Motion;
  engraving: PassEngravingData;
  uri: string | null;
  uploading: boolean;
  reduced: boolean;
};

function Field({ label, value, mint, end, width, loading }: { label: string; value: string; mint?: boolean; end?: boolean; width: `${number}%`; loading?: boolean }) {
  return (
    <View style={[styles.field, { width }, end && styles.fieldEnd]}>
      <Text variant="label" style={[styles.fieldLabel, styles.onBand]} numberOfLines={1}>
        {label}
      </Text>
      {loading ? (
        <View style={styles.fieldBone} />
      ) : (
        <Text style={[styles.fieldValue, mint && styles.mint]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {value}
        </Text>
      )}
    </View>
  );
}

const Front = memo(function Front({ profile, g, m, engraving, uri, uploading, reduced }: FaceProps) {
  const role = ROLE_COPY[profile.role].label;
  const place = profile.city ? `${role} · ${profile.city}` : role;
  const serial = serialOf(profile.handle);
  const since = String(new Date(profile.created_at).getFullYear());

  const ink = useDepth(m, 0.4);
  const foil = useDepth(m, 0.9);
  const photo = useDepth(m, 0.2);

  return (
    <>
      <View style={[styles.content, { paddingHorizontal: g.pad, paddingTop: g.pad }]}>
        <View style={[styles.top, { marginBottom: g.gap }]}>
          <Animated.View style={foil}>
            <LogoLockup scale={0.75} />
          </Animated.View>
          <View style={styles.kind}>
            <Text variant="label" style={styles.kindText}>
              Member pass
            </Text>
          </View>
        </View>

        <View style={[styles.middle, { height: g.middle }]}>
          <Animated.View style={photo}>
            <Portrait profile={profile} uri={uri} uploading={uploading} g={g} />
          </Animated.View>
          <Animated.View style={[styles.identity, ink]}>
            <View style={styles.nameRow}>
              <Text numberOfLines={2} style={[NAME, styles.shrink]}>
                {profile.display_name}
              </Text>
              <Animated.View style={[styles.sealSlot, foil]}>
                <Seal verified={profile.verified} reduced={reduced} />
              </Animated.View>
            </View>
            <View style={styles.placeRow}>
              <View style={[styles.roleDot, { backgroundColor: ROLE_RING[profile.role][0] }]} />
              <Text variant="body" tone="secondary" style={[styles.place, styles.shrink]} numberOfLines={1}>
                {place}
              </Text>
            </View>
          </Animated.View>
        </View>

      </View>
      <Band g={g} m={m}>
        <Field label="Anonymous ID" value={serial} mint width="30%" />
        <Field label={engraving.label} value={engraving.value} width="50%" loading={engraving.kind === 'loading'} />
        <Field label="Since" value={since} width="20%" end />
      </Band>

      <Sheen g={g} m={m} />
    </>
  );
});

const Back = memo(function Back({ profile, g, m, engraving }: Pick<FaceProps, 'profile' | 'g' | 'm' | 'engraving'>) {
  const serial = serialOf(profile.handle);
  const size = Math.min(g.h - g.pad * 2, Math.round((g.w - g.pad * 2) * 0.4));
  const ink = useDepth(m, 0.4);
  // The engraving fills the rest of the card beside the pattern, under the ID and above its caption.
  const art = { w: g.w - g.pad * 2 - size - space[4], h: g.h - g.pad * 2 - BACK_HEAD_H - BACK_CAPTION_H };
  const box = useMemo<Box>(() => ({ x: 0, y: 0, w: art.w, h: art.h }), [art.w, art.h]);
  return (
    <>
      <View style={[styles.back, { padding: g.pad }]}>
        <IdPattern serial={serial} size={size} />
        <Animated.View style={[styles.backCopy, ink]}>
          <View style={styles.backHead}>
            <Text variant="label" style={styles.fieldLabel}>
              Anonymous ID
            </Text>
            <Text style={styles.serialLarge} numberOfLines={1}>
              {serial}
            </Text>
          </View>
          <Canvas style={{ width: art.w, height: art.h }} pointerEvents="none">
            <Engraving data={engraving} box={box} draw={m.draw} tint={palette.green} />
          </Canvas>
          <Text variant="caption" style={styles.backCaption} numberOfLines={1}>
            {engraving.caption}
          </Text>
        </Animated.View>
      </View>
      <Sheen g={g} m={m} />
    </>
  );
});

/* ------------------------------------------------------------------ */
/* Pass                                                                 */
/* ------------------------------------------------------------------ */

export type MemberPassProps = {
  profile: Profile;
  /** Local preview while a new photo uploads. Falls back to `profile.avatar_url`. */
  photoUri?: string | null;
  uploading?: boolean;
  onChangePhoto?: () => void;
};

/**
 * The LandConnect member pass as a physical card: ISO ID-1 proportions in the brand's forest,
 * the official lockup on top, the name as the one primary field, and an engraving drawn from the
 * member's own land (or shortlist, or city). The pass follows the phone's tilt with a glare and
 * parallax; tap turns it over to the anonymous ID; hold, or the chip below, changes the photo.
 */
export function MemberPass({ profile, photoUri, uploading = false, onChangePhoto }: MemberPassProps) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const engraving = usePassEngraving(profile);
  const [width, setWidth] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sensorOk, setSensorOk] = useState(false);

  const sensorX = useSharedValue(0);
  const sensorY = useSharedValue(0);
  const pressX = useSharedValue(0);
  const pressY = useSharedValue(0);
  const pressed = useSharedValue(0);
  const enter = useSharedValue(reduced ? 1 : 0);
  const draw = useSharedValue(reduced ? 1 : 0);
  const sheen = useSharedValue(reduced ? 1 : 0);
  const flip = useSharedValue(0);
  const drawn = useRef(reduced);

  const tiltX = useDerivedValue(() => clamp(sensorX.get() + pressX.get(), -PRESS_MAX, PRESS_MAX));
  const tiltY = useDerivedValue(() => clamp(sensorY.get() + pressY.get(), -PRESS_MAX, PRESS_MAX));
  const motion = useMemo<Motion>(() => ({ tiltX, tiltY, sheen, draw }), [tiltX, tiltY, sheen, draw]);

  useEffect(() => {
    if (reduced) {
      draw.set(1);
      sheen.set(1);
      return;
    }
    enter.set(withDelay(80, withSpring(1, spring.gentle)));
    sheen.set(withDelay(320, withTiming(1, { duration: SHEEN_MS, easing: Easing.inOut(Easing.cubic) })));
  }, [reduced, enter, draw, sheen]);

  useEffect(() => {
    flip.set(reduced ? withTiming(flipped ? 1 : 0, { duration: 0 }) : withSpring(flipped ? 1 : 0, spring.gentle));
  }, [flipped, reduced, flip]);

  const g = useMemo(() => geometry(width), [width]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.get(),
    transform: [
      { translateY: (1 - enter.get()) * space[6] },
      { perspective: 1000 },
      { rotateX: `${tiltX.get()}deg` },
      { rotateY: `${tiltY.get()}deg` },
      { scale: 1 - 0.015 * pressed.get() },
    ],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    opacity: flip.get() < 0.5 ? 1 : 0,
    transform: [{ perspective: 1000 }, { rotateY: `${flip.get() * 180}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: flip.get() >= 0.5 ? 1 : 0,
    transform: [{ perspective: 1000 }, { rotateY: `${(flip.get() - 1) * 180}deg` }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (Math.abs(w - width) > 0.5) setWidth(w);
  };

  // Finger tilt: the fallback when there is no sensor, and a small press response otherwise.
  const follow = (e: GestureResponderEvent, gain: number) => {
    if (reduced || width === 0) return;
    const { locationX, locationY } = e.nativeEvent;
    pressY.set(withSpring(clamp((locationX / width - 0.5) * 2, -1, 1) * gain, spring.gentle));
    pressX.set(withSpring(clamp((0.5 - locationY / g.h) * 2, -1, 1) * gain, spring.gentle));
  };
  const gain = sensorOk ? 2 : PRESS_MAX;

  const onPressIn = (e: GestureResponderEvent) => {
    pressed.set(withSpring(1, spring.snappy));
    follow(e, gain);
  };
  const onPressOut = () => {
    pressed.set(withSpring(0, spring.snappy));
    pressX.set(withSpring(0, spring.gentle));
    pressY.set(withSpring(0, spring.gentle));
  };
  const onFlip = () => {
    Haptics.selectionAsync();
    setFlipped((f) => !f);
    if (reduced) return;
    sheen.set(withSequence(withTiming(0, { duration: 0 }), withDelay(180, withTiming(1, { duration: SHEEN_MS, easing: Easing.inOut(Easing.cubic) }))));
    // The back's engraving traces itself in the first time the pass is turned over.
    if (!drawn.current) {
      drawn.current = true;
      draw.set(withDelay(260, withTiming(1, { duration: DRAW_MS, easing: Easing.bezier(0.65, 0, 0.35, 1) })));
    }
  };
  const onLongPress = () => {
    if (!onChangePhoto || uploading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onChangePhoto();
  };

  const serial = serialOf(profile.handle);
  const role = ROLE_COPY[profile.role].label;
  const place = profile.city ? `${role}, ${profile.city}` : role;
  const uri = photoUri ?? profile.avatar_url;

  return (
    <View>
      {focused && !reduced ? <TiltSensor x={sensorX} y={sensorY} onAvailability={setSensorOk} /> : null}
      <Animated.View onLayout={onLayout} style={[styles.card, cardStyle]}>
        <Pressable
          onPress={onFlip}
          onLongPress={onChangePhoto ? onLongPress : undefined}
          delayLongPress={380}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onTouchMove={(e) => follow(e, gain)}
          accessibilityRole="button"
          accessibilityHint={flipped ? 'Turns the pass back to the front.' : 'Turns the pass over to show your anonymous ID.'}
          accessibilityLabel={
            flipped
              ? `Back of your member pass. Your anonymous ID is ${serial}. Show this ID instead of your phone number. ${engraving.caption}.`
              : `LandConnect member pass. ${profile.display_name}, ${place}. ${profile.verified ? 'Verified.' : 'Verification in review.'} Anonymous ID ${serial}. ${engraving.label}: ${engraving.value}. Member since ${new Date(profile.created_at).getFullYear()}.`
          }
          style={StyleSheet.absoluteFill}>
          {width > 0 ? (
            <>
              <Animated.View style={[styles.face, backStyle]}>
                <View style={styles.clip}>
                  <Material g={g} />
                  <Back profile={profile} g={g} m={motion} engraving={engraving} />
                </View>
              </Animated.View>
              <Animated.View style={[styles.face, frontStyle]}>
                <View style={styles.clip}>
                  <Material g={g} />
                  <Front profile={profile} g={g} m={motion} engraving={engraving} uri={uri} uploading={uploading} reduced={reduced} />
                </View>
              </Animated.View>
            </>
          ) : null}
        </Pressable>
      </Animated.View>

      <View style={styles.under}>
        <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.shrink}>
          {flipped ? 'Show this ID instead of your number' : 'Tap the pass to turn it over'}
        </Text>
        {onChangePhoto ? (
          <PressableScale
            to={0.95}
            haptic="selection"
            disabled={uploading}
            onPress={onChangePhoto}
            accessibilityLabel={uri ? 'Change profile photo' : 'Add a profile photo'}
            style={styles.chip}>
            {uploading ? <ActivityIndicator size="small" color={colors.inkSecondary} /> : <Camera size={14} color={colors.ink} strokeWidth={2.2} />}
            <Text variant="captionStrong">{uploading ? 'Uploading' : uri ? 'Edit photo' : 'Add photo'}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

/** Placeholder with the pass's own proportions, so nothing jumps when the profile arrives. */
export function MemberPassSkeleton() {
  return (
    <View>
      <View style={[styles.card, styles.skeleton]} />
      <View style={styles.under}>
        <View style={[styles.bone, { width: 160, height: 12 }]} />
        <View style={[styles.bone, styles.chipBone]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { aspectRatio: ASPECT, borderRadius: CARD_R, borderCurve: 'continuous' },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_R,
    borderCurve: 'continuous',
    boxShadow: CARD_SHADOW,
    backfaceVisibility: 'hidden',
  },
  clip: {
    flex: 1,
    borderRadius: CARD_R,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  content: { flex: 1 },
  top: { height: TOP_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  kind: {
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(palette.white, 0.7),
    borderWidth: 1,
    borderColor: withAlpha(palette.green, 0.14),
  },
  kindText: { fontSize: 9.5, lineHeight: 12, letterSpacing: 1, color: palette.green },
  mint: { color: palette.mint },
  onBand: { color: FAINT_ON_BAND },
  band: { height: BAND_H, paddingHorizontal: PAD, justifyContent: 'center', overflow: 'hidden' },
  watermark: { position: 'absolute', right: -14, top: (BAND_H - WATERMARK) / 2 + 6, opacity: 0.09 },
  foilClip: { position: 'absolute', top: 0, left: 0, right: 0, height: FOIL_H, overflow: 'hidden', opacity: 0.75 },
  foil: { height: FOIL_H },
  bandGlow: {
    position: 'absolute',
    right: -BAND_H,
    top: -BAND_H,
    width: BAND_H * 3,
    height: BAND_H * 3,
    borderRadius: BAND_H * 1.5,
    backgroundColor: withAlpha(palette.mint, 0.1),
  },
  patternTile: { borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: palette.forest },
  middle: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  identity: { flex: 1, gap: space[1] },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  // Centres the 20pt seal on the name's first 30pt line.
  sealSlot: { marginTop: (NAME.lineHeight - SEAL) / 2 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleDot: { width: 6, height: 6, borderRadius: 3 },
  place: { fontSize: 13.5, lineHeight: 18 },
  sheen: { position: 'absolute', left: 0, width: SHEEN_W },
  seal: { width: SEAL, height: SEAL },
  shrink: { flexShrink: 1 },
  frame: {
    padding: FRAME,
    borderRadius: PHOTO_R + FRAME + MAT,
    borderCurve: 'continuous',
    boxShadow: '0 6px 16px rgba(16,32,28,0.10)',
  },
  mat: { flex: 1, padding: MAT, borderRadius: PHOTO_R + MAT, borderCurve: 'continuous', backgroundColor: palette.white },
  photo: {
    flex: 1,
    borderRadius: PHOTO_R,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: palette.mintWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: palette.green, includeFontPadding: false },
  uploading: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.scrim },
  fields: { height: FIELD_H, flexDirection: 'row', alignItems: 'flex-end' },
  field: { gap: 2, paddingRight: space[2] },
  fieldEnd: { alignItems: 'flex-end', paddingRight: 0 },
  fieldLabel: { fontSize: 9.5, lineHeight: LABEL_H, letterSpacing: 1, color: FAINT },
  fieldValue: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: VALUE_H,
    letterSpacing: -0.2,
    color: colors.inkOnDark,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  fieldBone: { width: 96, height: 12, marginVertical: 4, borderRadius: radius.xs, backgroundColor: withAlpha(palette.white, 0.14) },
  serialLarge: {
    fontFamily: font.semibold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
    color: palette.green,
    includeFontPadding: false,
  },
  back: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[4] },
  backCopy: { flex: 1, alignSelf: 'stretch' },
  backHead: { height: BACK_HEAD_H, gap: 2 },
  backCaption: { height: BACK_CAPTION_H, lineHeight: BACK_CAPTION_H, fontSize: 11, color: FAINT },
  patternMark: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  under: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginTop: space[3], minHeight: space[8], paddingLeft: space[1] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: space[8],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.hair,
  },
  skeleton: { backgroundColor: colors.surfaceSunken },
  bone: { borderRadius: radius.xs, backgroundColor: colors.surfaceSunken },
  chipBone: { width: 96, height: space[8], borderRadius: radius.pill },
});
