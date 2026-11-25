import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors, curve, duration, font, radius, space, spring } from '@/theme/tokens';

import { Label, Text } from './text';

export type FieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Unit or suffix shown inside the field, e.g. "acres". */
  suffix?: string;
  /** Show a live `used/max` counter under the field (needs `maxLength`). */
  counter?: boolean;
};

const FOCUS = { duration: duration.fast, easing: Easing.bezier(...curve.out) };
const SHAKE = { duration: 55, easing: Easing.inOut(Easing.quad) };

/** Readable placeholder on the sunken well (the tertiary ink is too faint there). */
const PLACEHOLDER = '#7F8D88';
/** Mint ring drawn while focused; transparent at rest so focusing never shifts layout. */
const RING_REST = 'rgba(15,110,86,0)';

/**
 * Labelled input on a sunken well. Focus tints the well mint, draws a green ring and lifts the
 * label to the accent; an error turns it red with a short shake. All motion runs on the UI thread,
 * and reduced motion drops the shake (Reanimated's system default).
 */
export function Field({
  label,
  hint,
  error,
  leading,
  trailing,
  suffix,
  counter,
  style,
  onFocus,
  onBlur,
  multiline,
  maxLength,
  value,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const focus = useDerivedValue(() => withTiming(focused ? 1 : 0, FOCUS));
  const invalid = useDerivedValue(() => withTiming(error ? 1 : 0, FOCUS));
  const shake = useSharedValue(0);

  // Shake when an error appears or changes, not on every re-render while it is shown.
  const lastError = useRef(error);
  useEffect(() => {
    if (error && error !== lastError.current) {
      shake.set(
        withSequence(
          withTiming(-6, SHAKE),
          withTiming(5, SHAKE),
          withTiming(-3, SHAKE),
          withSpring(0, spring.ui),
        ),
      );
    }
    lastError.current = error;
  }, [error, shake]);

  const wellStyle = useAnimatedStyle(() => {
    const bg = interpolateColor(focus.get(), [0, 1], [colors.surfaceSunken, colors.accentSoft]);
    const ring = interpolateColor(focus.get(), [0, 1], [RING_REST, colors.accent]);
    return {
      backgroundColor: interpolateColor(invalid.get(), [0, 1], [bg, colors.dangerSoft]),
      borderColor: interpolateColor(invalid.get(), [0, 1], [ring, colors.danger]),
      transform: [{ translateX: shake.get() }],
    };
  });

  const length = typeof value === 'string' ? value.length : 0;
  const showCounter = counter && maxLength != null && (focused || length > 0);
  const nearLimit = showCounter && length >= maxLength * 0.9;

  return (
    <View style={styles.wrap}>
      {label ? <Label tone={error ? 'danger' : focused ? 'accent' : 'tertiary'}>{label}</Label> : null}
      <Animated.View style={[styles.well, multiline ? styles.multiline : null, wellStyle]}>
        {leading}
        <TextInput
          placeholderTextColor={PLACEHOLDER}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          allowFontScaling={false}
          multiline={multiline}
          maxLength={maxLength}
          value={value}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline ? styles.inputMultiline : null, style]}
          {...rest}
        />
        {suffix ? <Label tone={focused ? 'accent' : 'secondary'}>{suffix}</Label> : null}
        {trailing}
      </Animated.View>
      {error || hint || showCounter ? (
        <View style={styles.helpRow}>
          <View style={styles.helpText}>
            {error ? (
              <Animated.View key="error" entering={FadeIn.duration(duration.fast)} exiting={FadeOut.duration(duration.press)}>
                <Text variant="captionStrong" tone="danger">
                  {error}
                </Text>
              </Animated.View>
            ) : hint ? (
              <Text variant="caption" tone="tertiary">
                {hint}
              </Text>
            ) : null}
          </View>
          {showCounter ? (
            <Text variant="caption" tone={nearLimit ? 'highlight' : 'tertiary'} style={styles.counter}>
              {`${length}/${maxLength}`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 54,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1.5,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: space[3] },
  input: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 16,
    letterSpacing: -0.15,
    color: colors.ink,
    paddingVertical: 0,
  },
  inputMultiline: { minHeight: 96, lineHeight: 23 },
  helpRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  helpText: { flex: 1 },
  counter: { fontVariant: ['tabular-nums'] },
});
