import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius } from '@/theme/tokens';

import { withAlpha } from './meta';

/** Sunken placeholder block that breathes while data loads. */
export function SkeletonBlock({
  width = '100%',
  height,
  r = radius.xs,
  style,
}: {
  width?: DimensionValue;
  height: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.get() * 0.45 }));

  return <Animated.View style={[styles.block, { width, height, borderRadius: r }, animated, style]} />;
}

const SWEEP_MS = 1300;
const BAND = 0.55;

/**
 * Soft light band sweeping across a tinted surface while a photo downloads. Sits underneath the
 * image, so the photo's cross-fade covers it; callers unmount it once the photo has loaded.
 */
export function Shimmer({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const reduceMotion = useReducedMotion();
  const width = useSharedValue(0);
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    t.set(withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(t);
  }, [t, reduceMotion]);

  const band = useAnimatedStyle(() => {
    const w = width.get();
    const bw = w * BAND;
    return { opacity: w > 0 ? 1 : 0, transform: [{ translateX: -bw + t.get() * (w + bw) }] };
  });

  const glow = tone === 'dark' ? withAlpha(colors.inkOnDark, 0.07) : withAlpha(colors.surface, 0.42);
  const clear = tone === 'dark' ? withAlpha(colors.inkOnDark, 0) : withAlpha(colors.surface, 0);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e: LayoutChangeEvent) => width.set(e.nativeEvent.layout.width)}>
      {reduceMotion ? null : (
        <Animated.View style={[styles.band, band]}>
          <LinearGradient
            colors={[clear, glow, clear]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surfaceSunken, borderCurve: 'continuous' },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0, width: `${BAND * 100}%` },
});
