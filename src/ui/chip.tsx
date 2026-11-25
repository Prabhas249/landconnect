import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { colors, curve, duration, radius, space } from '@/theme/tokens';

import { PressableScale } from './pressable-scale';
import { Text, type TextTone } from './text';

type Tone = 'neutral' | 'accent' | 'highlight' | 'danger' | 'dark' | 'surface';

const bg: Record<Tone, string> = {
  neutral: colors.surfaceSunken,
  accent: colors.accentSoft,
  highlight: colors.highlightSoft,
  danger: colors.dangerSoft,
  dark: colors.ink,
  surface: colors.surface,
};

const fg: Record<Tone, TextTone> = {
  neutral: 'secondary',
  accent: 'accent',
  highlight: 'highlight',
  danger: 'danger',
  dark: 'onDark',
  surface: 'ink',
};

export type ChipProps = {
  label: string;
  tone?: Tone;
  leading?: ReactNode;
  /** Mono uppercase style for status tags. */
  mono?: boolean;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

const FILL = { duration: duration.fast, easing: Easing.bezier(...curve.out) };

/** The selected fill fades in under the label rather than the chip swapping colour in one frame. */
function SelectedFill({ on }: { on: boolean }) {
  const p = useDerivedValue(() => withTiming(on ? 1 : 0, FILL));
  const style = useAnimatedStyle(() => ({ opacity: p.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fill, style]} />;
}

/** Small pill: status tags (`mono`) or selectable filters (`onPress`). */
export function Chip({ label, tone = 'neutral', leading, mono, selected, onPress, style }: ChipProps) {
  const t: Tone = selected ? 'dark' : tone;
  const content = (
    <>
      {onPress ? <SelectedFill on={!!selected} /> : null}
      {leading}
      <Text variant={mono ? 'label' : 'captionStrong'} tone={fg[t]} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const base = [styles.base, mono ? styles.mono : null, { backgroundColor: bg[t] }, style];

  if (onPress) {
    return (
      <PressableScale
        haptic="selection"
        onPress={onPress}
        style={[styles.base, mono ? styles.mono : null, { backgroundColor: bg[tone] }, style]}
        accessibilityState={{ selected }}>
        {content}
      </PressableScale>
    );
  }
  return <View style={base}>{content}</View>;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 2,
    height: 34,
    paddingHorizontal: space[3] + 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  mono: { height: 24, paddingHorizontal: space[2] + 2 },
  fill: { borderRadius: radius.pill, backgroundColor: bg.dark },
});
