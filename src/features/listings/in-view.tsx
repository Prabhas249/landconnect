import { createContext, useCallback, useContext, useEffect } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
  type TextStyle,
  type StyleProp,
} from "react-native";
import Animated, {
  Easing,
  measure,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedRef,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { groupIndian } from "@/lib/format";

/** The detail screen's scroll offset, so sections can start their animations when they scroll into view. */
const ScrollYContext = createContext<SharedValue<number> | null>(null);
export const ScrollYProvider = ScrollYContext.Provider;

/**
 * `seen` flips to 1 (once, on the UI thread) when the attached view's top crosses ~85% of the
 * screen height. Attach `ref` and `onLayout` to an `Animated.View`. Without a provider it fires at once.
 */
export function useInView(threshold = 0.85) {
  const scrollY = useContext(ScrollYContext);
  const ref = useAnimatedRef<Animated.View>();
  const seen = useSharedValue(0);
  const tick = useSharedValue(0);
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();

  useAnimatedReaction(
    () => (scrollY ? scrollY.get() : 0) + tick.get() * 1e-6,
    () => {
      if (seen.get() === 1) return;
      if (!scrollY || reduced) {
        seen.set(1);
        return;
      }
      if (tick.get() === 0) return;
      const m = measure(ref);
      if (!m) return;
      if (m.pageY < height * threshold && m.pageY + m.height > 0) seen.set(1);
    },
  );

  const onLayout = useCallback(() => tick.set(tick.get() + 1), [tick]);
  return { ref, seen, onLayout, reduced };
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export type CountUpProps = {
  value: number;
  decimals?: number;
  /** Starts counting when this becomes 1. */
  seen: SharedValue<number>;
  delay?: number;
  style: StyleProp<TextStyle>;
  align?: "left" | "right";
};

/**
 * Figure that counts up from zero on the UI thread (native text updates, no React renders).
 * An invisible copy of the final string sizes the box, so the unit next to it never shifts.
 */
export function CountUp({
  value,
  decimals = 0,
  seen,
  delay = 0,
  style,
  align = "left",
}: CountUpProps) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(reduced ? value : 0);
  const final = groupIndian(value, decimals);

  useAnimatedReaction(
    () => seen.get(),
    (now, prev) => {
      if (now === 1 && prev !== 1) {
        shown.set(
          reduced
            ? value
            : withDelay(
                delay,
                withTiming(value, {
                  duration: 1100,
                  easing: Easing.out(Easing.cubic),
                }),
              ),
        );
      }
    },
    [value, delay, reduced],
  );

  // A changed value after the count-up has played just settles on the new figure.
  useEffect(() => {
    if (seen.get() === 1) shown.set(value);
  }, [value, seen, shown]);

  const animatedProps = useAnimatedProps(
    () =>
      ({
        text: groupIndian(shown.get(), decimals),
        defaultValue: groupIndian(shown.get(), decimals),
      }) as unknown as TextInputProps,
  );

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={final}>
      <Animated.Text
        style={[style, styles.hidden]}
        numberOfLines={1}
        importantForAccessibility="no-hide-descendants"
      >
        {final}
      </Animated.Text>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        defaultValue={reduced ? final : groupIndian(0, decimals)}
        animatedProps={animatedProps}
        importantForAccessibility="no-hide-descendants"
        style={[style, styles.input, { textAlign: align }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  input: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 0,
    margin: 0,
  },
});
