import type { ReactNode, Ref } from 'react';
import { useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';
import { colors, duration, radius, shadow, space } from '@/theme/tokens';

import { formatDistance, metresPerPoint, withAlpha } from './map-style';

const SCALE_MAX = 88;
const glass = withAlpha(colors.surface, 0.9);

/** 1, 2, 5 × 10ⁿ metres — the steps a surveyor's scale uses. */
function niceDistance(maxM: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(maxM, 1)));
  const n = maxM / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

function measure(zoom: number, lat: number) {
  const mpp = metresPerPoint(zoom, lat);
  const nice = niceDistance(mpp * SCALE_MAX);
  return { ratio: Math.min(1, nice / mpp / SCALE_MAX), label: formatDistance(nice) };
}

export type ScaleBarHandle = { update: (zoom: number, lat: number) => void };

/**
 * Scale bar driven straight from camera events: the bar length is a shared value (no render per
 * frame); the label re-renders only when it crosses to the next 1-2-5 step.
 */
export function ScaleBar({ ref, initial }: { ref?: Ref<ScaleBarHandle>; initial: { zoom: number; lat: number } }) {
  const [label, setLabel] = useState(() => measure(initial.zoom, initial.lat).label);
  const labelRef = useRef(label);
  const ratio = useSharedValue(measure(initial.zoom, initial.lat).ratio);

  useImperativeHandle(ref, () => ({
    update(zoom, lat) {
      const next = measure(zoom, lat);
      ratio.set(next.ratio);
      if (next.label !== labelRef.current) {
        labelRef.current = next.label;
        setLabel(next.label);
      }
    },
  }));

  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: ratio.get() }] }));
  const endTick = useAnimatedStyle(() => ({ transform: [{ translateX: ratio.get() * SCALE_MAX }] }));

  return (
    <View style={styles.scale} pointerEvents="none">
      <Label tone="secondary" style={styles.tabular}>
        {label}
      </Label>
      <View style={styles.scaleTrack}>
        <Animated.View style={[styles.scaleBar, bar]}>
          <View style={styles.scaleDark} />
          <View style={styles.scaleLight} />
        </Animated.View>
        <View style={styles.tick} />
        <Animated.View style={[styles.tick, endTick]} />
      </View>
    </View>
  );
}

/**
 * Compass rose that turns with the camera bearing and leans back with its pitch.
 * Tapping it squares the map up to north and flat.
 */
export function Compass({
  bearing,
  pitch,
  onPress,
}: {
  bearing: SharedValue<number>;
  pitch: SharedValue<number>;
  onPress: () => void;
}) {
  const tilted = useDerivedValue(() => (Math.abs(bearing.get()) > 0.5 || pitch.get() > 1 ? 1 : 0));
  const rose = useAnimatedStyle(() => ({
    transform: [{ perspective: 220 }, { rotateX: `${pitch.get() * 0.7}deg` }, { rotate: `${-bearing.get()}deg` }],
  }));
  const ring = useAnimatedStyle(() => ({ opacity: withTiming(tilted.get() ? 1 : 0, { duration: duration.base }) }));

  return (
    <PressableScale
      to={0.92}
      haptic="selection"
      onPress={onPress}
      accessibilityLabel="Reset map to north"
      style={styles.compass}>
      <Animated.View style={[styles.compassRing, ring]} />
      <Animated.View style={rose}>
        <Svg width={26} height={26} viewBox="0 0 26 26">
          <Path d="M13 2.5 L17 13 L9 13 Z" fill={colors.accent} />
          <Path d="M13 23.5 L9 13 L17 13 Z" fill={colors.inkTertiary} />
          <Circle cx={13} cy={13} r={2.2} fill={colors.surface} stroke={colors.ink} strokeWidth={1.4} />
        </Svg>
      </Animated.View>
    </PressableScale>
  );
}

/** Floating pill used for "Search this area" and the active-area chip. */
export function FloatingPill({
  icon,
  label,
  onPress,
  tone = 'light',
  accessibilityLabel,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  tone?: 'light' | 'dark';
  accessibilityLabel?: string;
}) {
  const dark = tone === 'dark';
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(24).stiffness(260)}
      exiting={FadeOutUp.duration(160)}
      style={styles.pillWrap}>
      <PressableScale
        haptic="selection"
        onPress={onPress}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[styles.pill, { backgroundColor: dark ? colors.ink : colors.surface }]}>
        {icon}
        <Text variant="captionStrong" tone={dark ? 'onDark' : 'ink'} numberOfLines={1}>
          {label}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  scale: {
    gap: 3,
    paddingHorizontal: space[2],
    paddingVertical: space[1] + 2,
    borderRadius: radius.xs,
    borderCurve: 'continuous',
    backgroundColor: glass,
  },
  scaleTrack: { width: SCALE_MAX, height: 8, justifyContent: 'flex-end' },
  scaleBar: {
    flexDirection: 'row',
    width: SCALE_MAX,
    height: 4,
    transformOrigin: 'left',
    borderWidth: 1,
    borderColor: colors.ink,
  },
  scaleDark: { flex: 1, backgroundColor: colors.ink },
  scaleLight: { flex: 1, backgroundColor: colors.surface },
  tick: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 1.5,
    height: 8,
    marginLeft: -0.5,
    backgroundColor: colors.ink,
  },
  compass: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassRing: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.accentBright,
  },
  pillWrap: { alignSelf: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 40,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    boxShadow: shadow.float,
  },
});
