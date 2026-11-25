import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { Text } from '@/ui/text';

import { CALM } from './pulse-model';

/* ------------------------------------------------------------------ */
/* Swap: crossfade + short slide for keyed text                         */
/* ------------------------------------------------------------------ */

/** Fades in while sliding `dy` pt into place (CALM, no overshoot), after `delay` ms. */
export function enterSlide(delay: number, dy = 6): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: dy }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 220 })),
        transform: [{ translateY: withDelay(delay, withSpring(0, CALM)) }],
      },
    };
  };
}

/** Fades out while drifting `dy` pt the other way. Quick, so it overlaps the entry by ~180 ms. */
export function exitSlide(dy = 6): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: {
        opacity: withTiming(0, { duration: 160 }),
        transform: [{ translateY: withTiming(-dy, { duration: 200 }) }],
      },
    };
  };
}

/** True after the first commit: entrances on later changes only (the first paint has its own rise). */
export function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return mounted;
}

/* ------------------------------------------------------------------ */
/* Rolling digits                                                       */
/* ------------------------------------------------------------------ */

/** Two bands of 0–9: rolling up lands in the upper band, rolling down in the lower, so every roll keeps its direction. */
const STRIP = Array.from({ length: 20 }, (_, i) => String(i % 10)).join('\n');
const STAGGER = 30;

type Target = { d: number; dir: number; delay: number; reduced: boolean; first: boolean; fromZero: boolean };

/**
 * One odometer column: a 0–9 strip (twice) behind a one-line window. Springs (CALM) to the new
 * digit in the direction of the change; a fresh target mid-roll carries on from where it is.
 * All the arithmetic runs on the UI thread.
 */
function DigitColumn({
  digit,
  dir,
  delay,
  reduced,
  fromZero,
  style,
  lineHeight,
}: {
  digit: number;
  dir: number;
  delay: number;
  reduced: boolean;
  fromZero: boolean;
  style: StyleProp<TextStyle>;
  lineHeight: number;
}) {
  const pos = useSharedValue(fromZero && !reduced ? 0 : digit);
  const target = useSharedValue<Target | null>(null);
  const first = useRef(true);

  useEffect(() => {
    target.set({ d: digit, dir, delay, reduced, first: first.current, fromZero });
    first.current = false;
  }, [digit, dir, delay, reduced, fromZero, target]);

  useAnimatedReaction(
    () => target.get(),
    (t, prev) => {
      if (!t) return;
      // Same digit and direction (only the stagger shifted): let a running roll finish.
      if (prev && !t.first && prev.d === t.d && prev.dir === t.dir && prev.reduced === t.reduced) return;
      if (t.reduced || (t.first && !t.fromZero)) {
        cancelAnimation(pos);
        pos.set(t.d);
        return;
      }
      const now = pos.get();
      const base = ((now % 10) + 10) % 10;
      const up = t.dir >= 0;
      // Move into the band that leaves room to roll the chosen way: [0,10) rolling up, [10,20) down.
      const from = up ? base : base + 10;
      let goal = up ? t.d : t.d + 10;
      if (up && goal < from - 0.5) goal += 10;
      if (!up && goal > from + 0.5) goal -= 10;
      if (Math.abs(from - now) > 0.001) pos.set(from);
      if (Math.abs(goal - from) < 0.001) return;
      pos.set(withDelay(t.delay, withSpring(goal, CALM)));
    },
  );

  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: -pos.get() * lineHeight }] }));

  return (
    <View style={[styles.column, { height: lineHeight }]}>
      {/* Sizes the column: tabular digits share one width. */}
      <Text style={[style, styles.ghost]} numberOfLines={1}>
        0
      </Text>
      <Animated.View style={[styles.strip, strip]}>
        <Text style={[style, styles.stripText, { lineHeight }]}>{STRIP}</Text>
      </Animated.View>
    </View>
  );
}

export type RollPart =
  /** Digits (with an optional decimal point) that roll column by column. */
  | { kind: 'num'; text: string; style?: StyleProp<TextStyle> }
  /** Static text that crossfades when it changes ("Cr" → "L", "district" → "districts"). */
  | { kind: 'text'; text: string; style?: StyleProp<TextStyle>; /** Baseline nudge for a smaller size. */ drop?: number };

type Cell =
  | { key: string; type: 'digit'; digit: number; style?: StyleProp<TextStyle> }
  | { key: string; type: 'text'; text: string; style?: StyleProp<TextStyle>; drop?: number; swap: boolean };

/**
 * Splits parts into keyed cells. Digits key by their place relative to the decimal point, so
 * "1.8" → "30.5" rolls 1→0 and 8→5 and grows a tens column, the way an odometer reads.
 */
function cellsOf(parts: RollPart[]): Cell[] {
  const cells: Cell[] = [];
  parts.forEach((p, pi) => {
    if (p.kind === 'text') {
      cells.push({ key: `p${pi}:${p.text}`, type: 'text', text: p.text, style: p.style, drop: p.drop, swap: true });
      return;
    }
    const [int, frac = ''] = p.text.split('.');
    const intChars = int.split('');
    intChars.forEach((ch, i) => {
      const place = intChars.length - 1 - i;
      if (ch >= '0' && ch <= '9') cells.push({ key: `p${pi}i${place}`, type: 'digit', digit: Number(ch), style: p.style });
      else cells.push({ key: `p${pi}i${place}:${ch}`, type: 'text', text: ch, style: p.style, swap: false });
    });
    if (p.text.includes('.')) cells.push({ key: `p${pi}dot`, type: 'text', text: '.', style: p.style, swap: false });
    frac.split('').forEach((ch, i) => {
      if (ch >= '0' && ch <= '9') cells.push({ key: `p${pi}f${i}`, type: 'digit', digit: Number(ch), style: p.style });
      else cells.push({ key: `p${pi}f${i}:${ch}`, type: 'text', text: ch, style: p.style, swap: false });
    });
  });
  return cells;
}

/**
 * A row of rolling digits and crossfading text on one line box. `dir` (+1 rising, −1 falling)
 * sets which way every column rolls; columns start right → left, 30 ms apart, after `delay`.
 * Under reduced motion everything lands instantly.
 */
export function Rolling({
  parts,
  style,
  lineHeight,
  dir,
  reduced,
  delay = 0,
  fromZero = false,
}: {
  parts: RollPart[];
  style: StyleProp<TextStyle>;
  lineHeight: number;
  dir: number;
  reduced: boolean;
  delay?: number;
  /** Roll in from 0 on mount (the figure's first appearance). */
  fromZero?: boolean;
}) {
  const mounted = useMounted();
  const cells = cellsOf(parts);
  const dy = dir < 0 ? -4 : 4;
  return (
    <View style={[styles.row, { height: lineHeight }]}>
      {cells.map((c, i) => {
        const wait = delay + (cells.length - 1 - i) * STAGGER;
        if (c.type === 'digit') {
          return (
            <DigitColumn
              key={c.key}
              digit={c.digit}
              dir={dir}
              delay={wait}
              reduced={reduced}
              fromZero={fromZero || mounted.current}
              style={[style, c.style]}
              lineHeight={lineHeight}
            />
          );
        }
        const animate = !reduced && (c.swap || mounted.current);
        return (
          <Animated.View
            key={c.key}
            entering={animate && mounted.current ? enterSlide(wait, dy) : undefined}
            exiting={animate ? exitSlide(dy) : undefined}
            style={c.drop ? { top: c.drop } : undefined}>
            <Text style={[style, c.style, { lineHeight }, styles.flat]} numberOfLines={1}>
              {c.text}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', flexShrink: 0 },
  column: { overflow: 'hidden' },
  ghost: { opacity: 0 },
  strip: { position: 'absolute', top: 0, left: 0, right: 0 },
  stripText: { textAlign: 'center', ...Platform.select({ android: { includeFontPadding: false }, default: {} }) },
  flat: Platform.select({ android: { includeFontPadding: false }, default: {} }) ?? {},
});
