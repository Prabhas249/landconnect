import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors, duration, radius, shadow, space } from '@/theme/tokens';

import { PressableScale, type PressableScaleProps } from './pressable-scale';
import { Text } from './text';

type Variant = 'primary' | 'accent' | 'soft' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm';

export type ButtonProps = Omit<PressableScaleProps, 'children' | 'style'> & {
  label: string;
  variant?: Variant;
  size?: Size;
  /** Icon element rendered before the label. */
  leading?: ReactNode;
  /** Icon element rendered after the label. */
  trailing?: ReactNode;
  loading?: boolean;
  /** Stretch to the parent's width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
};

const bg: Record<Variant, string> = {
  primary: colors.ink,
  accent: colors.accent,
  soft: colors.surfaceSunken,
  ghost: 'transparent',
  danger: colors.danger,
};

const fg: Record<Variant, 'onDark' | 'ink' | 'secondary'> = {
  primary: 'onDark',
  accent: 'onDark',
  soft: 'ink',
  ghost: 'secondary',
  danger: 'onDark',
};

const LABEL_IN = FadeIn.duration(duration.fast);

const heights: Record<Size, number> = { lg: 56, md: 48, sm: 38 };

export function Button({
  label,
  variant = 'primary',
  size = 'lg',
  leading,
  trailing,
  loading,
  block = true,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  // The label only fades in when it returns from a loading state, never on first mount.
  const [hasLoaded, setHasLoaded] = useState(!!loading);
  if (loading && !hasLoaded) setHasLoaded(true);
  return (
    <PressableScale
      disabled={disabled || loading}
      accessibilityLabel={label}
      style={[
        styles.base,
        {
          height: heights[size],
          backgroundColor: bg[variant],
          paddingHorizontal: size === 'sm' ? space[4] : space[6],
          alignSelf: block ? 'stretch' : 'flex-start',
          boxShadow: variant === 'accent' ? shadow.accent : variant === 'primary' ? shadow.card : undefined,
        },
        style,
      ]}
      {...rest}>
      {/* Label and spinner fade into each other instead of swapping in one frame. */}
      {loading ? (
        <Animated.View key="loading" entering={LABEL_IN}>
          <ActivityIndicator color={variant === 'soft' || variant === 'ghost' ? colors.ink : colors.inkOnDark} />
        </Animated.View>
      ) : (
        <Animated.View key="label" entering={hasLoaded ? LABEL_IN : undefined} style={styles.row}>
          {leading}
          <Text variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'} tone={fg[variant]} numberOfLines={1}>
            {label}
          </Text>
          {trailing}
        </Animated.View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
