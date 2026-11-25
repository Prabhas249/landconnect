import { useNavigation } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolate, makeMutable, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { colors, curve, radius } from '@/theme/tokens';

/**
 * The iOS page-sheet depth effect for Android: while a sheet screen (List land, new room) is on
 * top, the app underneath recedes, scaling down a touch, rounding its corners and dimming, then
 * comes back as the sheet slides away. iOS draws this natively for `presentation: 'modal'`, so the
 * effect is Android-only.
 *
 * One shared value (0 = at rest, 1 = behind a sheet) drives it on the UI thread. Opening follows
 * the native slide-up; closing starts on the pop's `transitionStart`, so it tracks the slide down.
 * Reduced motion: Reanimated's system default snaps the timing, so the dim simply appears.
 */
const depth = makeMutable(0);

const ENABLED = Platform.OS === 'android';
const OPEN = { duration: 380, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
const CLOSE = { duration: 300, easing: Easing.bezier(...curve.out) };

type StackEvents = {
  addListener: (type: 'transitionStart', cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
};

/** Call in a screen presented as a sheet: pushes the app behind it back while it is open. */
export function useSheetDepth() {
  const navigation = useNavigation<StackEvents>();
  useEffect(() => {
    if (!ENABLED) return;
    depth.set(withTiming(1, OPEN));
    const off = navigation.addListener('transitionStart', (e) => {
      if (e.data?.closing) depth.set(withTiming(0, CLOSE));
    });
    return () => {
      off();
      depth.set(withTiming(0, CLOSE));
    };
  }, [navigation]);
}

/** Wrap the content that should recede behind sheets (the tab navigator). */
export function SheetDepthView({ children }: { children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const d = depth.get();
    return {
      borderRadius: interpolate(d, [0, 1], [0, radius.lg]),
      transform: [{ scale: interpolate(d, [0, 1], [1, 0.93]) }, { translateY: interpolate(d, [0, 1], [0, 10]) }],
    };
  });
  const dim = useAnimatedStyle(() => ({ opacity: interpolate(depth.get(), [0, 1], [0, 0.28]) }));

  if (!ENABLED) return <>{children}</>;
  return (
    <View style={styles.backdrop}>
      <Animated.View style={[styles.fill, style]}>
        {children}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dim]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.night },
  fill: { flex: 1, overflow: 'hidden', backgroundColor: colors.canvas },
  dim: { backgroundColor: '#000' },
});
