import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { enterRise, maxStagger, spring, stagger } from '@/theme/tokens';

export type EnterProps = {
  children: ReactNode;
  /** Position in the stagger sequence. Capped so long lists do not crawl in. */
  index?: number;
  /** Extra delay before the sequence starts (ms). */
  delay?: number;
  style?: StyleProp<ViewStyle>;
  /** Renders the same wrapper without an entrance, so toggling it never remounts the children. */
  disabled?: boolean;
};

// One builder per delay, shared by every Enter with that delay instead of a new one per render.
const builders = new Map<number, FadeInDown>();

function entering(delay: number) {
  let b = builders.get(delay);
  if (!b) {
    b = FadeInDown.delay(delay)
      .springify()
      .damping(spring.layout.damping)
      .stiffness(spring.layout.stiffness)
      .mass(spring.layout.mass)
      .overshootClamping(1)
      // A short rise: content settles into place rather than flying in. Reduced motion skips it
      // (the builder's default ReduceMotion.System).
      .withInitialValues({ opacity: 0, transform: [{ translateY: enterRise }] });
    builders.set(delay, b);
  }
  return b;
}

/** Staggered rise-and-fade entrance for cards and list rows, on `spring.layout`. */
export function Enter({ children, index = 0, delay = 0, style, disabled = false }: EnterProps) {
  const step = Math.min(Math.max(0, index), maxStagger);
  return (
    <Animated.View entering={disabled ? undefined : entering(delay + step * stagger)} style={style}>
      {children}
    </Animated.View>
  );
}
