import type { CameraRef, CameraStop, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { Square } from 'lucide-react-native';
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react';
import { StyleSheet, View, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  FadeOutUp,
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';
import { colors, palette, radius, shadow, space } from '@/theme/tokens';

import { runCamera, withAlpha } from './map-style';

/**
 * 360° orbit driven by native camera animations.
 *
 * The v11 Camera ref offers `setStop` (resolves as soon as the stop is queued, not when it ends)
 * and no keyframe API, so the sweep is cut into ~1 s linear `easeCamera` segments issued on a
 * wall-clock schedule. Each segment is a little longer than its slot, so the next one always
 * takes over mid-flight and the camera never stops between them. Segment end bearings follow an
 * ease-in-out curve, giving a soft start and stop with no per-frame JS work. Bearing deltas stay
 * far below 180°, so MapLibre's shortest-path rotation always turns the same way.
 */

export type OrbitOptions = {
  /** Bearing the sweep starts from (usually the current camera bearing). */
  fromBearing: number;
  /** Degrees to turn; negative turns anticlockwise. Default 360. */
  sweep?: number;
  /** Duration of the sweep itself, excluding the intro move. Default 14 s. */
  durationMs?: number;
  /** Optional camera move that frames the subject first (pitch, bounds or centre). */
  intro?: CameraStop;
  introMs?: number;
};

const SEGMENT_MS = 1000;
/** Each segment overruns its slot so the next command interrupts it instead of letting it stop. */
const OVERLAP_MS = 90;
/** Camera events that arrive this soon after our own command are ours, not the user's. */
const OWN_EVENT_MS = 400;
/** A tap that cancels the orbit also reaches the orbit button; treat that press as "stop". */
const TOUCH_GUARD_MS = 700;

const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
const wrap360 = (b: number) => ((b % 360) + 360) % 360;

export function useOrbit(cameraRef: RefObject<CameraRef | null>) {
  const [running, setRunning] = useState(false);
  const progress = useSharedValue(0);
  const runningRef = useRef(false);
  const runId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issuedAt = useRef(0);
  const touchStopAt = useRef(0);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const issue = (stop: CameraStop) => {
    issuedAt.current = Date.now();
    runCamera(() => cameraRef.current?.setStop(stop));
  };

  const stop = ({ halt = true }: { halt?: boolean } = {}) => {
    runId.current++;
    clearTimer();
    if (!runningRef.current) return;
    runningRef.current = false;
    cancelAnimation(progress);
    // A zero-duration stop with no target re-applies the current camera: it freezes the turn.
    if (halt) issue({ duration: 0 });
    setRunning(false);
  };

  const start = ({ fromBearing, sweep = 360, durationMs = 14_000, intro, introMs = 1100 }: OrbitOptions) => {
    stop({ halt: false });
    const id = ++runId.current;
    runningRef.current = true;
    setRunning(true);
    cancelAnimation(progress);
    progress.set(0);

    if (intro) issue({ ...intro, duration: introMs, easing: 'ease' });
    const t0 = Date.now() + (intro ? introMs : 0);
    const n = Math.max(3, Math.round(durationMs / SEGMENT_MS));
    const slot = durationMs / n;

    const step = (i: number) => {
      if (id !== runId.current) return;
      if (i >= n) {
        runningRef.current = false;
        setRunning(false);
        return;
      }
      if (i === 0) progress.set(withTiming(1, { duration: durationMs, easing: Easing.inOut(Easing.sin) }));
      issue({
        bearing: wrap360(fromBearing + sweep * easeInOutSine((i + 1) / n)),
        duration: Math.round(i < n - 1 ? slot + OVERLAP_MS : slot),
        easing: 'linear',
      });
      timer.current = setTimeout(() => step(i + 1), Math.max(0, t0 + (i + 1) * slot - Date.now()));
    };
    timer.current = setTimeout(() => step(0), Math.max(0, t0 - Date.now()));
  };

  useEffect(
    () => () => {
      runId.current++;
      clearTimer();
    },
    [],
  );

  return {
    running,
    /** 0 → 1 across the sweep, eased like the camera. */
    progress,
    start,
    stop,
    /** Second press stops; a press that arrives right after a touch-cancel also counts as stop. */
    toggle: (options: OrbitOptions) => {
      if (runningRef.current) {
        stop();
        return;
      }
      if (Date.now() - touchStopAt.current < TOUCH_GUARD_MS) return;
      start(options);
    },
    /** Wire to `onTouchStart` of a view wrapping the map: any touch on the map cancels at once. */
    onMapTouch: () => {
      if (!runningRef.current) return;
      touchStopAt.current = Date.now();
      stop();
    },
    /** Wire to `onRegionWillChange`: a user gesture (pinch, rotate, fling) cancels too. */
    onRegionWillChange: (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      if (!runningRef.current || !e.nativeEvent.userInteraction) return;
      if (Date.now() - issuedAt.current < OWN_EVENT_MS) return;
      stop({ halt: false });
    },
  };
}

export type Orbit = ReturnType<typeof useOrbit>;

// ── progress ring

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Thin ring that fills with the orbit. */
export function OrbitRing({
  progress,
  size = 28,
  stroke = 2.5,
  track = withAlpha(palette.white, 0.18),
  color = colors.accentBright,
}: {
  progress: SharedValue<number>;
  size?: number;
  stroke?: number;
  track?: string;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - progress.get()) }));
  return (
    <Svg width={size} height={size} style={styles.ringSvg}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${c} ${c}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

// ── heads-up readout

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function heading(bearing: number) {
  const b = Math.round(wrap360(bearing)) % 360;
  return `${String(b).padStart(3, '0')}° ${CARDINALS[Math.round(b / 45) % 8]}`;
}

export type OrbitHudHandle = { update: (bearing: number) => void };

/**
 * Floating readout while orbiting: progress ring, live heading, tap to stop. Heading updates are
 * pushed through a ref from camera events and re-render only this pill, once per degree.
 */
export function OrbitHud({
  ref,
  progress,
  initialBearing,
  onStop,
}: {
  ref?: Ref<OrbitHudHandle>;
  progress: SharedValue<number>;
  initialBearing: number;
  onStop: () => void;
}) {
  const [label, setLabel] = useState(() => heading(initialBearing));
  const labelRef = useRef(label);

  useImperativeHandle(ref, () => ({
    update(bearing) {
      const next = heading(bearing);
      if (next === labelRef.current) return;
      labelRef.current = next;
      setLabel(next);
    },
  }));

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(24).stiffness(260)}
      exiting={FadeOutUp.duration(160)}
      style={styles.hudWrap}>
      <PressableScale haptic="selection" onPress={onStop} accessibilityLabel="Stop orbit" style={styles.hud}>
        <View style={styles.ring}>
          <OrbitRing progress={progress} />
          <Square size={10} color={colors.inkOnDark} fill={colors.inkOnDark} strokeWidth={2} />
        </View>
        <Label tone="onDarkSecondary">Orbit</Label>
        <Text variant="captionStrong" tone="onDark" style={styles.tabular}>
          {label}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ringSvg: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
  ring: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  hudWrap: { alignSelf: 'center' },
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 44,
    paddingLeft: space[2],
    paddingRight: space[4],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.ink,
    boxShadow: shadow.float,
  },
  tabular: { fontVariant: ['tabular-nums'], minWidth: 64 },
});
