import * as Haptics from 'expo-haptics';
import { useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { curve, hitSlop as defaultHitSlop, duration, spring } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Press-down is a short ease-out, so the response lands under the finger at once; the release
// springs back, so it can be interrupted by the next tap without a jump.
// RN's native driver rather than Reanimated: every list card is one of these and nearly every
// swipe starts on one, and a Reanimated press animation commits the whole shadow tree each frame
// on Android, which stuttered the start of every scroll. Native-driven, it never leaves the UI thread.
const PRESS_IN_EASING = Easing.bezier(...curve.out);

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale when pressed. */
  to?: number;
  /**
   * Opacity while pressed, the iOS highlight dim. `true` uses the default; `false` keeps full opacity
   * (for surfaces that carry imagery, where a dim reads as a flicker).
   */
  dim?: boolean | number;
  /** Fire a light haptic on press. */
  haptic?: boolean | 'selection' | 'medium';
};

const DEFAULT_DIM = 0.9;
const DISABLED_OPACITY = 0.45;

/**
 * Base for everything tappable: eases to `to` and dims while pressed, springs back on release,
 * and fires a light haptic. Stores press *state* (0..1) and derives the visual from it.
 */
export function PressableScale({
  children,
  style,
  to = 0.97,
  dim = true,
  haptic = true,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  hitSlop,
  ...rest
}: PressableScaleProps) {
  const pressed = useRef(new Animated.Value(0)).current;
  const dimTo = dim === false ? 1 : dim === true ? DEFAULT_DIM : dim;
  // The animated opacity replaces any static one, so fold the caller's opacity into it.
  const own = StyleSheet.flatten(style)?.opacity;
  const rest0 = (typeof own === 'number' ? own : 1) * (disabled ? DISABLED_OPACITY : 1);

  const animatedStyle = {
    opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [rest0, rest0 * dimTo] }),
    transform: [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, to] }) }],
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={hitSlop ?? defaultHitSlop}
      onPressIn={(e) => {
        Animated.timing(pressed, { toValue: 1, duration: duration.press, easing: PRESS_IN_EASING, useNativeDriver: true }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(pressed, { toValue: 0, ...spring.ui, useNativeDriver: true }).start();
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic === 'selection') Haptics.selectionAsync();
        else if (haptic === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        else if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[style, animatedStyle]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}
