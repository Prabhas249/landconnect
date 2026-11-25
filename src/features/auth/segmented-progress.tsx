import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';

/** Minimum touch target. */
const TOUCH = 44;

export type SegmentedProgressProps = {
  total: number;
  /** Filled segments, fractional (1.5 = first full, second half). Drive it from a gesture or a spring. */
  value: SharedValue<number>;
  /** Optional 0..1 lead-in drawn faintly in the next segment — e.g. time until an auto-advance. */
  pending?: SharedValue<number>;
  height?: number;
  color?: string;
  /**
   * Makes each segment a jump target. The row then becomes a real 44pt-tall touch area with the
   * track centred in it — not a 4pt strip widened by hitSlop, which Android ignores whenever the
   * strip's parent is only 4pt tall.
   */
  onSelect?: (index: number) => void;
  segmentLabel?: (index: number) => string;
};

/**
 * Segmented progress whose fill tracks a shared value frame by frame. Same look as `ProgressSegments`,
 * but the fill is a transform, so it can follow a finger without re-rendering.
 */
export function SegmentedProgress({
  total,
  value,
  pending,
  height = space[1],
  color = colors.accent,
  onSelect,
  segmentLabel,
}: SegmentedProgressProps) {
  return (
    <View style={[styles.row, onSelect ? styles.touchRow : null]}>
      {Array.from({ length: total }, (_, i) => (
        <Segment
          key={i}
          index={i}
          value={value}
          pending={pending}
          height={height}
          color={color}
          onSelect={onSelect}
          label={segmentLabel?.(i)}
        />
      ))}
    </View>
  );
}

function Segment({
  index,
  value,
  pending,
  height,
  color,
  onSelect,
  label,
}: {
  index: number;
  value: SharedValue<number>;
  pending?: SharedValue<number>;
  height: number;
  color: string;
  onSelect?: (index: number) => void;
  label?: string;
}) {
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.min(1, Math.max(0, value.get() - index)) }],
  }));
  const pendingStyle = useAnimatedStyle(() => {
    // Only the segment right after the last full one shows the lead-in.
    const isNext = pending ? Math.round(value.get()) === index : false;
    return { transform: [{ scaleX: isNext && pending ? pending.get() : 0 }] };
  });

  const track = (
    <View style={[styles.track, { height, borderRadius: height / 2.6 }]}>
      {pending ? <Animated.View style={[styles.fill, { backgroundColor: color, opacity: 0.28 }, pendingStyle]} /> : null}
      <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
    </View>
  );

  if (!onSelect) return <View style={styles.flex}>{track}</View>;

  return (
    <PressableScale
      haptic="selection"
      to={1}
      onPress={() => onSelect(index)}
      hitSlop={{ top: 0, bottom: 0, left: space[1], right: space[1] }}
      accessibilityLabel={label}
      style={styles.touchSegment}>
      {track}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[1] },
  touchRow: { height: TOUCH },
  flex: { flex: 1 },
  touchSegment: { flex: 1, height: TOUCH, justifyContent: 'center' },
  track: { overflow: 'hidden', backgroundColor: colors.surfaceSunken, borderCurve: 'continuous' },
  fill: { ...StyleSheet.absoluteFill, transformOrigin: 'left' },
});
