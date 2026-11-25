import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, space, spring } from '@/theme/tokens';

import { withAlpha } from '../meta';
import { photoUrl } from './image-variants';
import { Photo } from './photo';
import { prefetchLater } from './photo-cache';

/** A leaving page grows by this much at full offset; the drift below stays inside that slack. */
const SWIPE_SCALE = 0.12;
const DRIFT = SWIPE_SCALE / 2;
/** Fraction of a page, or a fling, that commits to the next photo. */
const COMMIT = 0.18;
const FLING = 450;

function Page({
  listingId,
  uri,
  index,
  pos,
  width,
  mounted,
  tint,
  motion,
}: {
  listingId: string;
  uri: string;
  index: number;
  pos: SharedValue<number>;
  width: SharedValue<number>;
  mounted: boolean;
  tint: string;
  motion: boolean;
}) {
  // Depth while swiping: the photo eases out slower than its frame and swells slightly.
  const drift = useAnimatedStyle(() => {
    if (!motion) return { transform: [{ translateX: 0 }, { scale: 1 }] };
    const d = pos.get() - index;
    const a = Math.min(1, Math.abs(d));
    return { transform: [{ translateX: Math.max(-1, Math.min(1, d)) * width.get() * DRIFT }, { scale: 1 + SWIPE_SCALE * a }] };
  });
  return (
    <View style={[styles.page, { backgroundColor: tint }]}>
      {mounted ? (
        <Animated.View style={[StyleSheet.absoluteFill, drift]}>
          <Photo
            uri={uri}
            size="card"
            tint={tint}
            priority={index === 0 ? 'high' : 'low'}
            recyclingKey={`${listingId}:${index}`}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function Dot({ index, pos }: { index: number; pos: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const on = 1 - Math.min(1, Math.abs(pos.get() - index));
    return { opacity: 0.5 + on * 0.5, transform: [{ scale: 1 + on * 0.34 }] };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

export type CardPagerProps = {
  listingId: string;
  images: string[];
  tint: string;
  onIndexChange?: (index: number) => void;
};

/**
 * Feed-card photo pager. A gesture-handler pan that only claims clearly horizontal drags
 * (active past 10pt sideways, fails past 10pt vertically), so the feed keeps its vertical scroll
 * and a tap still falls through to the card; activating cancels the card's press. Pages snap
 * with a critically damped spring, tick a selection haptic, and only the visible photo and its
 * neighbours mount. Key it by listing so a recycled cell never inherits another's position.
 */
export function CardPager({ listingId, images, tint, onIndexChange }: CardPagerProps) {
  const count = images.length;
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  const width = useSharedValue(0);
  const pos = useSharedValue(0);
  const start = useSharedValue(0);

  const settled = (i: number) => {
    Haptics.selectionAsync();
    setIndex(i);
    onIndexChange?.(i);
    prefetchLater(
      [images[i + 1], images[i + 2]].filter((u): u is string => !!u).map((u) => photoUrl(u, 'card')),
      true,
    );
  };

  const pan = usePanGesture({
    enabled: count > 1,
    activeOffsetX: [-10, 10],
    failOffsetY: [-10, 10],
    onActivate: () => {
      'worklet';
      cancelAnimation(pos);
      start.set(pos.get());
    },
    onUpdate: (e) => {
      'worklet';
      const w = width.get();
      if (w <= 0) return;
      let p = start.get() - e.translationX / w;
      // Rubber-band past the first and last photo.
      if (p < 0) p *= 0.3;
      else if (p > count - 1) p = count - 1 + (p - (count - 1)) * 0.3;
      pos.set(p);
    },
    onDeactivate: (e) => {
      'worklet';
      const w = width.get();
      const from = Math.round(start.get());
      const moved = pos.get() - from;
      let target = from;
      if (moved > COMMIT || e.velocityX < -FLING) target = from + 1;
      else if (moved < -COMMIT || e.velocityX > FLING) target = from - 1;
      target = Math.max(0, Math.min(count - 1, target));
      pos.set(
        reduceMotion
          ? withTiming(target, { duration: 160 })
          : withSpring(target, { ...spring.snappy, velocity: w > 0 ? -e.velocityX / w : 0 }),
      );
      if (target !== from) scheduleOnRN(settled, target);
    },
  });

  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -pos.get() * width.get() }] }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e: LayoutChangeEvent) => width.set(e.nativeEvent.layout.width)}
      accessibilityLabel={`Photo ${index + 1} of ${count}. Swipe sideways for more.`}>
      <GestureDetector gesture={pan}>
        <Animated.View style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.track, { width: `${count * 100}%` }, track]}>
            {images.map((uri, i) => (
              <Page
                key={`${i}:${uri}`}
                listingId={listingId}
                uri={uri}
                index={i}
                pos={pos}
                width={width}
                mounted={Math.abs(i - index) <= 1}
                tint={tint}
                motion={!reduceMotion}
              />
            ))}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      <LinearGradient
        colors={[withAlpha(colors.ink, 0), colors.scrim]}
        locations={[0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.dots} pointerEvents="none">
        {images.map((uri, i) => (
          <Dot key={`${i}:${uri}`} index={i} pos={pos} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', top: 0, bottom: 0, left: 0, flexDirection: 'row' },
  page: { flex: 1, overflow: 'hidden' },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space[3] + 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space[1] + 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.inkOnDark },
});
