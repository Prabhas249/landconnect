import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';

import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { colors, radius, shadow, space, spring } from '@/theme/tokens';

const TRACK_W = 52;
const TRACK_H = 32;
const PAD = 3;
const THUMB = TRACK_H - PAD * 2;

export type ToggleProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Optional text shown to the left of the switch; the whole row is tappable. */
  label?: string;
  disabled?: boolean;
};

/** Switch with a spring thumb. Only transform and opacity animate. */
export function Toggle({ value, onChange, label, disabled }: ToggleProps) {
  const progress = useDerivedValue(() => withSpring(value ? 1 : 0, spring.snappy));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * (TRACK_W - THUMB - PAD * 2) }],
  }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  const sw = (
    <View style={styles.track}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fillStyle]} />
      <Animated.View style={[styles.thumb, thumbStyle]} />
    </View>
  );

  return (
    <PressableScale
      to={0.98}
      haptic="selection"
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      onPress={() => onChange(!value)}
      style={label ? styles.row : styles.solo}>
      {label ? (
        <Text variant="bodyStrong" style={styles.label}>
          {label}
        </Text>
      ) : null}
      {sw}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 44 },
  solo: { alignSelf: 'flex-start' },
  label: { flex: 1 },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    padding: PAD,
    overflow: 'hidden',
  },
  fill: { backgroundColor: colors.accent },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.hair,
  },
});
