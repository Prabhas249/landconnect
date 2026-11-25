import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, radius, shadow, space, spring } from '@/theme/tokens';
import { Text } from '@/ui/text';

const W = 52;
const H = 32;
const PAD = 3;
const THUMB = H - PAD * 2;
const TRAVEL = W - THUMB - PAD * 2;
// While held, the thumb stretches toward its destination, the way a finger drags a real switch.
const STRETCH = 0.22;

export type ToggleProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
};

/**
 * Switch with a spring thumb. The on-colour is a layer fading in and the thumb stretches
 * while held, so only opacity and transform ever animate.
 */
export function Toggle({ value, onValueChange, disabled, label }: ToggleProps) {
  const progress = useDerivedValue(() => withSpring(value ? 1 : 0, spring.snappy));
  const held = useSharedValue(0);

  const thumb = useAnimatedStyle(() => {
    const p = progress.get();
    const grow = held.get() * STRETCH + 0.1 * Math.sin(p * Math.PI);
    // Stretch from the side the thumb is leaving, so it reads as being pulled.
    const shift = (grow * THUMB) / 2;
    return {
      transform: [{ translateX: p * TRAVEL + (value ? -shift : shift) }, { scaleX: 1 + grow }],
    };
  });
  const onLayer = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const glyph = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: 0.4 + 0.6 * progress.get() }, { scaleX: 1 / (1 + held.get() * STRETCH) }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={space[3]}
      onPressIn={() => held.set(withSpring(1, spring.snappy))}
      onPressOut={() => held.set(withSpring(0, spring.snappy))}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onValueChange(!value);
      }}
      style={[styles.track, disabled ? { opacity: 0.45 } : null]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.on, onLayer]} />
      <Animated.View style={[styles.thumb, thumb]}>
        <Animated.View style={glyph}>
          <Check size={13} color={colors.accent} strokeWidth={3} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export type SettingRowProps = {
  title: string;
  description?: string;
  /** Trailing control, usually a `Toggle`. */
  trailing: ReactNode;
  leading?: ReactNode;
};

/** Title and explanation on the left, control on the right. */
export function SettingRow({ title, description, trailing, leading }: SettingRowProps) {
  return (
    <View style={styles.row}>
      {leading}
      <View style={styles.copy}>
        <Text variant="bodyStrong">{title}</Text>
        {description ? (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: W,
    height: H,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    justifyContent: 'center',
    paddingHorizontal: PAD,
    overflow: 'hidden',
  },
  on: { backgroundColor: colors.accent, borderRadius: radius.pill },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.surface,
    boxShadow: shadow.hair,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 56, paddingVertical: space[2] },
  copy: { flex: 1, gap: 2 },
});
