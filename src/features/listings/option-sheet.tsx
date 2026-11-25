import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, duration, radius, shadow, space, spring } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

export type SheetOption<T extends string> = { value: T; label: string; hint?: string; dot?: string };

export type OptionSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  options: readonly SheetOption<T>[];
  value: T | null;
  onSelect: (value: T) => void;
  onClose: () => void;
};

const SHEET_PAD = space[3];
const SHEET_RADIUS = radius.xxl;
const ROW_RADIUS = SHEET_RADIUS - SHEET_PAD;

/**
 * Small floating bottom sheet for picking one option (sort order, listing status).
 * Stays mounted until the close animation finishes so it never snaps away.
 */
export function OptionSheet<T extends string>({ visible, title, options, value, onSelect, onClose }: OptionSheetProps<T>) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.set(withSpring(1, spring.gentle));
    } else {
      progress.set(
        withTiming(0, { duration: duration.base }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [visible, progress]);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheet = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.4], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(progress.get(), [0, 1], [320, 0]) }],
  }));

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { bottom: Math.max(insets.bottom, space[3]) + space[2] }, sheet]}>
        <View style={styles.head}>
          <Label>{title}</Label>
        </View>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <PressableScale
              key={o.value}
              haptic="selection"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(o.value)}
              style={[styles.row, active ? styles.rowActive : null]}>
              {o.dot ? <View style={[styles.dot, { backgroundColor: o.dot }]} /> : null}
              <View style={styles.rowText}>
                <Text variant={active ? 'bodyStrong' : 'body'}>{o.label}</Text>
                {o.hint ? (
                  <Text variant="caption" tone="secondary">
                    {o.hint}
                  </Text>
                ) : null}
              </View>
              {active ? <Check size={20} color={colors.accent} strokeWidth={2.3} /> : null}
            </PressableScale>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    padding: SHEET_PAD,
    borderRadius: SHEET_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
    gap: space[1],
  },
  head: { paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[3],
    borderRadius: ROW_RADIUS,
    borderCurve: 'continuous',
  },
  rowActive: { backgroundColor: colors.surfaceMuted },
  rowText: { flex: 1, gap: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
