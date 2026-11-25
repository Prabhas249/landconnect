import { useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * The scroll offset clamped to the range a scroll-linked style actually uses, written only when it
 * changes. Styles read this instead of the raw offset, so they stop re-running once the offset is
 * past their range. That matters: a Reanimated style that returns a `transform` array is always
 * "changed" (new array each run) and costs a full shadow-tree commit per frame on Android, even
 * when every value in it is clamped and identical.
 */
export function useClampedScroll(scrollY: SharedValue<number>, min: number, max: number): SharedValue<number> {
  const out = useSharedValue(Math.min(max, Math.max(min, 0)));
  useAnimatedReaction(
    () => Math.min(max, Math.max(min, scrollY.get())),
    (now, before) => {
      if (now !== before) out.set(now);
    },
    [min, max],
  );
  return out;
}
