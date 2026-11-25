import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, gutter, space } from '@/theme/tokens';
import { useClampedScroll } from '@/ui/clamped-scroll';
import { Header, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { withAlpha } from './parts';

/** Height of the bar row under the status bar; matches the shared `Header`'s minimum height. */
export const BAR_H = 52;
/** How far the canvas keeps dissolving below the bar. */
const TAIL = space[6];

const CANVAS_CLEAR = withAlpha(colors.canvas, 0);

/** Scroll offset as a shared value, plus the UI-thread handler that feeds it. */
export function useScrollY() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });
  return { scrollY, onScroll };
}

/**
 * Solid canvas from the top of the screen to the bottom of the bar, then a soft fade.
 * It only appears once content moves, so at rest nothing is drawn over the first card,
 * and once scrolled nothing ever sits under the status bar.
 */
function TopFade({ scrollY, to = space[3] }: { scrollY: SharedValue<number>; to?: number }) {
  const { top } = useScreenInsets();
  const solid = top + BAR_H;
  const height = solid + TAIL;
  const style = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.get(), [0, to], [0, 1], 'clamp') }));
  return (
    <Animated.View pointerEvents="none" style={[styles.fade, { height }, style]}>
      <LinearGradient
        colors={[colors.canvas, colors.canvas, CANVAS_CLEAR]}
        locations={[0, solid / height, 1]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** Where scroll content should start under a floating stack header. */
export function useStackContentTop() {
  const { top } = useScreenInsets();
  return top + BAR_H + space[3];
}

/**
 * Stack header that floats over its scroll view. Content passes under it into the canvas
 * fade instead of being cut at a hard edge. Render it after the scroll view.
 */
export function StackTopBar({
  scrollY,
  title,
  subtitle,
  trailing,
}: {
  scrollY: SharedValue<number>;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  const { top } = useScreenInsets();
  return (
    <>
      <TopFade scrollY={scrollY} />
      <View pointerEvents="box-none" style={[styles.bar, { paddingTop: top }]}>
        <Header title={title} subtitle={subtitle} trailing={trailing} />
      </View>
    </>
  );
}

/**
 * Tab-root top bar: invisible at rest, then the canvas fade and a compact title
 * (with an optional leading avatar) arrive as the page's own title scrolls away.
 */
export function CollapsingTopBar({
  scrollY,
  title,
  leading,
  threshold = space[10],
}: {
  scrollY: SharedValue<number>;
  title: string;
  leading?: ReactNode;
  /** Scroll offset at which the compact title is fully in. */
  threshold?: number;
}) {
  const { top } = useScreenInsets();
  const y = useClampedScroll(scrollY, 0, threshold);
  const content = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [threshold * 0.4, threshold], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateY: (1 - p) * space[1] }] };
  });
  return (
    <>
      <TopFade scrollY={scrollY} to={threshold * 0.6} />
      <Animated.View pointerEvents="none" style={[styles.bar, styles.compact, { top, height: BAR_H }, content]}>
        {leading}
        <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
          {title}
        </Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: { position: 'absolute', top: 0, left: 0, right: 0 },
  compact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], paddingHorizontal: gutter },
  shrink: { flexShrink: 1 },
});
