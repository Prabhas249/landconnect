import { BlurMask, Canvas, Circle, Group, Path, Skia, vec, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { supabase } from '@/lib/supabase';
import { colors, palette, space } from '@/theme/tokens';
import { Label, Text } from '@/ui/text';

import { mix, polygon, type Pt } from './scene';

export type AccountMomentState = 'hidden' | 'working' | 'done';

/**
 * Calls `cb` the moment a session exists — a little before the profile load finishes and the app
 * takes over — so the success beat can start without ever delaying sign-in. Returns an unsubscribe.
 */
export function onSessionStarted(cb: () => void) {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') cb();
  });
  return () => data.subscription.unsubscribe();
}

const W = 220;
const H = 156;
const C = { x: W / 2, y: 74 };
const HALF_W = 80;
const HALF_H = HALF_W * 0.58;
const DEPTH = 10;
const SEAL_R = 22;

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

function buildPlot() {
  const corners: Pt[] = [
    { x: C.x, y: C.y - HALF_H },
    { x: C.x + HALF_W, y: C.y },
    { x: C.x, y: C.y + HALF_H },
    { x: C.x - HALF_W, y: C.y },
  ];
  const [, right, bottom, left] = corners;
  const down = (p: Pt) => ({ x: p.x, y: p.y + DEPTH });
  const rows = Skia.PathBuilder.Make();
  for (let k = 1; k < 5; k++) {
    const t = k / 5;
    const a = { x: corners[0].x + (left.x - corners[0].x) * t, y: corners[0].y + (left.y - corners[0].y) * t };
    rows.moveTo(a.x + 6, a.y + 3.5).lineTo(a.x + HALF_W - 6, a.y + HALF_H - 3.5);
  }
  const b = Skia.PathBuilder.Make().moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((c) => b.lineTo(c.x, c.y));
  b.close();

  const seal = Skia.PathBuilder.Make();
  const steps = 120;
  for (let j = 0; j <= steps; j++) {
    const th = (j / steps) * Math.PI * 2;
    const rr = SEAL_R * (0.955 + 0.045 * Math.cos(16 * th));
    const x = C.x + rr * Math.cos(th);
    const y = C.y - 4 + rr * Math.sin(th);
    if (j === 0) seal.moveTo(x, y);
    else seal.lineTo(x, y);
  }
  seal.close();

  return {
    corners,
    top: polygon(corners),
    left: polygon([left, bottom, down(bottom), down(left)]),
    right: polygon([bottom, right, down(right), down(bottom)]),
    rows: rows.build(),
    boundary: b.build(),
    seal: seal.build(),
    check: Skia.PathBuilder.Make()
      .moveTo(C.x - SEAL_R * 0.36, C.y - 4 + SEAL_R * 0.02)
      .lineTo(C.x - SEAL_R * 0.08, C.y - 4 + SEAL_R * 0.3)
      .lineTo(C.x + SEAL_R * 0.4, C.y - 4 - SEAL_R * 0.26)
      .build(),
  };
}

const SIDE_LEFT = mix(palette.mintSoft, palette.forest, 0.16);
const SIDE_RIGHT = mix(palette.mintSoft, palette.forest, 0.3);

/**
 * The brief moment between "Create account" and the app: the new owner's plot is surveyed
 * corner by corner while the request runs, and a verified seal lands once the session exists.
 * It never waits on itself — the app replaces it the instant sign-in completes, and a failure
 * simply fades it away to reveal the error.
 */
export function AccountMoment({ state }: { state: AccountMomentState }) {
  const reduced = useReducedMotion();
  const plot = useMemo(buildPlot, []);

  const shown = useSharedValue(0);
  const outline = useSharedValue(0);
  const wait = useSharedValue(0);
  const seal = useSharedValue(0);
  const check = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    if (state === 'hidden') {
      shown.set(withTiming(0, { duration: 180 }));
      [outline, wait, seal, check, ring].forEach((v) => cancelAnimation(v));
      return;
    }
    if (reduced) {
      shown.set(1);
      outline.set(1);
      if (state === 'done') {
        seal.set(1);
        check.set(1);
      }
      return;
    }
    if (state === 'working') {
      outline.set(0);
      seal.set(0);
      check.set(0);
      ring.set(0);
      // A short hold before appearing, so a fast failure never flashes the overlay.
      shown.set(withDelay(160, withTiming(1, { duration: 240 })));
      outline.set(withDelay(260, withTiming(1, { duration: 1150, easing: Easing.bezier(0.45, 0, 0.25, 1) })));
      wait.set(0);
      wait.set(withDelay(1450, withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false)));
      return;
    }
    // Done: close any open edge quickly, then land the seal.
    shown.set(withTiming(1, { duration: 160 }));
    outline.set(withTiming(1, { duration: 220 }));
    seal.set(withDelay(120, withSpring(1, { damping: 13, stiffness: 210, mass: 0.85 })));
    check.set(withDelay(260, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) })));
    ring.set(withDelay(160, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) })));
  }, [state, reduced, shown, outline, wait, seal, check, ring]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.get()) * space[3] }] }));
  const workingCopy = useAnimatedStyle(() => ({ opacity: 1 - seal.get() }));
  const doneCopy = useAnimatedStyle(() => ({ opacity: clamp01(seal.get()), transform: [{ translateY: (1 - clamp01(seal.get())) * 6 }] }));

  return (
    <Animated.View
      pointerEvents={state === 'hidden' ? 'none' : 'auto'}
      style={[styles.overlay, overlayStyle]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={state === 'done' ? 'Account created' : 'Creating your account'}>
      <Animated.View style={[styles.content, contentStyle]}>
        <Canvas style={styles.canvas}>
          <PlotDrawing plot={plot} outline={outline} wait={wait} seal={seal} check={check} ring={ring} />
        </Canvas>
        <View style={styles.copy}>
          <Animated.View style={[styles.copyLine, workingCopy]}>
            <Label tone="secondary">Creating your account</Label>
            <Text variant="caption" tone="tertiary" center>
              Setting up your private workspace
            </Text>
          </Animated.View>
          <Animated.View style={[styles.copyLine, styles.stacked, doneCopy]}>
            <Label tone="accent">Account created</Label>
            <Text variant="caption" tone="tertiary" center>
              Taking you to LandConnect
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function PlotDrawing({
  plot,
  outline,
  wait,
  seal,
  check,
  ring,
}: {
  plot: ReturnType<typeof buildPlot>;
  outline: SharedValue<number>;
  wait: SharedValue<number>;
  seal: SharedValue<number>;
  check: SharedValue<number>;
  ring: SharedValue<number>;
}) {
  const slab = useDerivedValue(() => clamp01(outline.get() * 1.4));
  const fill = useDerivedValue(() => clamp01((outline.get() - 0.7) / 0.3) * 0.9);
  const sealOrigin = vec(C.x, C.y - 4);
  const sealTransform = useDerivedValue<Transforms3d>(() => [{ scale: 1.6 - 0.6 * seal.get() }]);
  const sealOpacity = useDerivedValue(() => clamp01(seal.get() * 2.2));
  const ringTransform = useDerivedValue<Transforms3d>(() => [{ scale: 1 + ring.get() * 1.2 }]);
  const ringOpacity = useDerivedValue(() => (ring.get() > 0 ? (1 - ring.get()) * 0.6 : 0));

  return (
    <Group>
      <Group opacity={slab}>
        <Path path={plot.left} color={SIDE_LEFT} />
        <Path path={plot.right} color={SIDE_RIGHT} />
        <Path path={plot.top} color={palette.mintSoft} />
        <Path path={plot.rows} style="stroke" strokeWidth={1} strokeCap="round" color={palette.green} opacity={0.16} />
      </Group>
      <Path path={plot.top} color={palette.amberWash} opacity={fill} />
      <Path
        path={plot.boundary}
        style="stroke"
        strokeWidth={2.2}
        strokeJoin="round"
        strokeCap="round"
        color={palette.amber}
        start={0}
        end={outline}
      />
      {plot.corners.map((c, i) => (
        <CornerStake key={`c${i}`} at={c} index={i} outline={outline} wait={wait} seal={seal} />
      ))}

      <Group transform={ringTransform} origin={sealOrigin} opacity={ringOpacity}>
        <Circle cx={C.x} cy={C.y - 4} r={SEAL_R} color={palette.green} style="stroke" strokeWidth={1.5} />
      </Group>
      <Group transform={sealTransform} origin={sealOrigin} opacity={sealOpacity}>
        <Circle cx={C.x} cy={C.y} r={SEAL_R * 0.9} color={palette.forest} opacity={0.22}>
          <BlurMask blur={6} style="normal" />
        </Circle>
        <Path path={plot.seal} color={palette.green} />
        <Circle cx={C.x} cy={C.y - 4} r={SEAL_R * 0.74} color={palette.mint} style="stroke" strokeWidth={1} opacity={0.6} />
        <Path path={plot.check} style="stroke" strokeWidth={2.8} strokeCap="round" strokeJoin="round" color={palette.white} start={0} end={check} />
      </Group>
    </Group>
  );
}

function CornerStake({
  at,
  index,
  outline,
  wait,
  seal,
}: {
  at: Pt;
  index: number;
  outline: SharedValue<number>;
  wait: SharedValue<number>;
  seal: SharedValue<number>;
}) {
  // Equal edges, so each corner is reached at a quarter of the trim.
  const reached = useDerivedValue(() => clamp01((outline.get() - index * 0.25 + 0.02) / 0.06));
  const transform = useDerivedValue<Transforms3d>(() => [{ scale: 0.3 + reached.get() * 0.7 }]);
  // While the request runs, the stakes take turns glowing — alive, but not a spinner.
  const glow = useDerivedValue(() => {
    const d = Math.abs(((wait.get() * 4 - index + 4) % 4) - 0.5);
    return clamp01(1 - d * 1.4) * (1 - seal.get()) * reached.get();
  });
  const glowTransform = useDerivedValue<Transforms3d>(() => [{ scale: 1 + glow.get() * 0.9 }]);
  const origin = vec(at.x, at.y);
  return (
    <Group>
      <Group transform={glowTransform} origin={origin} opacity={glow}>
        <Circle cx={at.x} cy={at.y} r={5} color={palette.amber} opacity={0.3} />
      </Group>
      <Group transform={transform} origin={origin} opacity={reached}>
        <Circle cx={at.x} cy={at.y} r={4.5} color={palette.amber} />
        <Circle cx={at.x} cy={at.y} r={1.7} color={palette.white} />
      </Group>
    </Group>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { alignItems: 'center', gap: space[5] },
  canvas: { width: W, height: H },
  copy: { alignItems: 'center' },
  copyLine: { alignItems: 'center', gap: space[1] },
  stacked: { ...StyleSheet.absoluteFill },
});
