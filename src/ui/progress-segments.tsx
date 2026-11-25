import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, curve, space } from '@/theme/tokens';

export type ProgressSegmentsProps = {
  total: number;
  /** Number of filled segments. */
  value: number;
  color?: string;
  height?: number;
};

function Segment({
  index,
  progress,
  color,
  height,
}: {
  index: number;
  progress: SharedValue<number>;
  color: string;
  height: number;
}) {
  const style = useAnimatedStyle(() => {
    const fill = Math.min(1, Math.max(0, progress.get() - index));
    return { backgroundColor: interpolateColor(fill, [0, 1], [colors.surfaceSunken, color]) };
  });
  return <Animated.View style={[styles.segment, { height, borderRadius: height / 2.6 }, style]} />;
}

/** Segmented progress — fills left to right when the value changes. */
export function ProgressSegments({ total, value, color = colors.accent, height = 22 }: ProgressSegmentsProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withDelay(120, withTiming(value, { duration: 90 * Math.max(1, value), easing: Easing.bezier(...curve.out) })));
  }, [progress, value]);

  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <Segment key={i} index={i} progress={progress} color={color} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[1] },
  segment: { flex: 1, borderCurve: 'continuous' },
});
