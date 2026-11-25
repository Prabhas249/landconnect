import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';

import { colors, radius, shadow, space, spring } from '@/theme/tokens';

import { Text } from './text';

export type SegmentedProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  /** `dark` for use on night surfaces (call screens). */
  tone?: 'light' | 'dark';
};

const PAD = 4;

/** Pill segmented control. The white thumb slides with `spring.ui`; it never snaps. */
export function Segmented<T extends string>({ options, value, onChange, style, tone = 'light' }: SegmentedProps<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segment = width > 0 ? (width - PAD * 2) / options.length : 0;

  // Springs in index units and scales by the measured width in the style, so the first layout
  // (and any resize) places the thumb at once and only a real selection change slides it.
  const position = useDerivedValue(() => withSpring(index, spring.ui));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() * segment }] }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const dark = tone === 'dark';

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: dark ? 'rgba(255,255,255,0.10)' : colors.surfaceSunken }, style]}>
      {segment > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            { width: segment, backgroundColor: dark ? 'rgba(255,255,255,0.18)' : colors.surface },
            dark ? null : { boxShadow: shadow.hair },
            thumbStyle,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync();
              onChange(o.value);
            }}
            style={styles.item}>
            <Text
              variant={active ? 'captionStrong' : 'caption'}
              tone={dark ? (active ? 'onDark' : 'onDarkSecondary') : active ? 'ink' : 'secondary'}
              numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 44,
    padding: PAD,
    borderRadius: radius.pill,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: radius.pill,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[2] },
});
