import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { formatNumber, formatPrice, priceParts } from '@/lib/format';
import { font, palette } from '@/theme/tokens';
import { Text } from '@/ui/text';

import { withAlpha } from '../meta';
import { CALM, CALM_OMEGA } from './pulse-model';
import { Rolling, type RollPart } from './rolling';

const UNIT_DIVISOR = { Cr: 1e7, L: 1e5, K: 1e3 } as const;
/** Each figure's first count-up plays once per app session; later mounts open on the figure. */
const counted = new Set<string>();

/**
 * Counts toward the value along the same critically damped curve as the springs
 * (x = 1 − (1 + ωt)·e^(−ωt)), so the figure settles with the chart rather than ahead of it.
 */
function useCountTo(value: number, reduced: boolean, key: string) {
  const startAt = reduced || counted.has(key) ? value : 0;
  const [shown, setShown] = useState(startAt);
  const current = useRef(startAt);
  useEffect(() => {
    counted.add(key);
    if (reduced) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    if (from === value) return;
    const start = Date.now();
    let raf = 0;
    let last = 0;
    const step = () => {
      const now = Date.now();
      const t = (now - start) / 1000;
      const k = 1 - (1 + CALM_OMEGA * t) * Math.exp(-CALM_OMEGA * t);
      const done = k > 0.999;
      const next = done ? value : from + (value - from) * k;
      current.current = next;
      // ~30 fps is plenty for a ticking figure and halves the JS-thread renders.
      if (done || now - last >= 32) {
        last = now;
        setShown(next);
      }
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, key]);
  return shown;
}

/**
 * The hero figure in ink with its unit small and soft on the same baseline: "₹1.8 Cr /acre",
 * 44pt (40pt when narrow). One line that shrinks to fit rather than wrapping. Its own component,
 * so the count-up re-renders this row only.
 */
export function PulseFigure({
  value,
  reduced,
  compact = false,
  perAcre = true,
  countKey = 'pulse',
}: {
  value: number;
  reduced: boolean;
  compact?: boolean;
  /** "₹1.8 Cr /acre" (default), or a plain total with the unit small: "₹25.9 Cr". */
  perAcre?: boolean;
  /** Session key for the once-per-session count-up. */
  countKey?: string;
}) {
  const shown = useCountTo(value, reduced, countKey);
  // Count in the final unit ("0.4 Cr" → "1.8 Cr") so the unit never flickers through K and L.
  const { amount: finalAmount, unit } = priceParts(value);
  const decimals = finalAmount.includes('.') ? finalAmount.split('.')[1].length : 0;
  const amount = unit ? (shown / UNIT_DIVISOR[unit]).toFixed(decimals) : formatNumber(Math.round(shown));

  return (
    <Text
      style={[styles.figure, compact && styles.compact]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      accessibilityLabel={perAcre ? `${formatPrice(value)} per acre` : formatPrice(value)}>
      {perAcre ? `₹${amount}${unit ? ` ${unit}` : ''}` : `₹${amount}`}
      {perAcre ? <Text style={styles.unit}>{' /acre'}</Text> : unit ? <Text style={styles.unitLarge}>{` ${unit}`}</Text> : null}
    </Text>
  );
}

const FIG_H = 50;
/** Baseline nudge for a smaller run on the figure's 50pt line box (Geist: (ascender − descender) / 2 ≈ 0.34 em). */
const dropFor = (big: number, small: number) => Math.round(0.34 * (big - small) * 10) / 10;

/**
 * The market figure as an odometer: "₹1.8 Cr /acre" where each digit column rolls to the new
 * value (right → left, 30 ms apart, CALM, no overshoot), the unit crossfades when it changes and
 * the whole row drifts up 5pt when the rate rose (down when it fell). The first appearance per
 * session rolls up from zero. Shrinks to fit (scale, left-anchored) rather than wrapping.
 */
export function RollingFigure({
  value,
  reduced,
  compact = false,
  dir = 0,
  countKey = 'pulse',
}: {
  value: number;
  reduced: boolean;
  compact?: boolean;
  /** +1 when the value rose since the last data, −1 when it fell, 0 on first paint. */
  dir?: number;
  countKey?: string;
}) {
  const [fromZero] = useState(() => !reduced && !counted.has(countKey));
  useEffect(() => {
    counted.add(countKey);
  }, [countKey]);

  const big = compact ? 40 : 44;
  const { amount, unit } = priceParts(value);
  const parts: RollPart[] = [
    { kind: 'text', text: '₹' },
    { kind: 'num', text: amount },
    ...(unit ? [{ kind: 'text' as const, text: unit, style: styles.rollUnitBig }] : []),
    { kind: 'text', text: '/acre', style: styles.rollUnit, drop: dropFor(big, 17) },
  ];

  // Direction cue: the row starts a few points off and settles with the digits.
  const cue = useSharedValue(0);
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    if (reduced || !dir) return;
    cue.set(dir * 5);
    cue.set(withSpring(0, CALM));
  }, [value, dir, reduced, cue]);

  // Fit: scale the natural row down to the space it has.
  const [avail, setAvail] = useState(0);
  const [natural, setNatural] = useState(0);
  const fit = avail > 0 && natural > avail ? avail / natural : 1;
  const scale = useSharedValue(fit);
  useEffect(() => {
    scale.set(reduced ? fit : withSpring(fit, CALM));
  }, [fit, reduced, scale]);

  const move = useAnimatedStyle(() => ({ transform: [{ translateY: cue.get() }, { scale: scale.get() }] }));

  return (
    <View
      style={styles.rollBox}
      onLayout={(e) => setAvail(Math.round(e.nativeEvent.layout.width))}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${formatPrice(value)} per acre`}>
      <Animated.View style={[styles.rollRow, move]} onLayout={(e) => setNatural(Math.round(e.nativeEvent.layout.width))}>
        <Rolling
          parts={parts}
          style={[styles.figure, compact && styles.compact, styles.rollText]}
          lineHeight={FIG_H}
          dir={dir}
          reduced={reduced}
          fromZero={fromZero}
          delay={fromZero ? 120 : 0}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rollBox: { alignSelf: 'stretch', flexDirection: 'row', height: FIG_H },
  rollRow: { flexShrink: 0, transformOrigin: 'left center' },
  rollText: { lineHeight: FIG_H },
  rollUnitBig: { marginLeft: 7 },
  rollUnit: { marginLeft: 6, fontFamily: font.medium, fontSize: 17, letterSpacing: 0, color: withAlpha(palette.forest, 0.45) },
  figure: {
    fontFamily: font.bold,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1.4,
    color: palette.forest,
    fontVariant: ['tabular-nums'],
  },
  /** Narrow cards: content under 300pt. */
  compact: { fontSize: 40, letterSpacing: -1.2 },
  /** A total's own unit ("Cr"), a step larger than "/acre" since it carries magnitude. */
  unitLarge: { fontFamily: font.semibold, fontSize: 20, letterSpacing: 0, color: withAlpha(palette.forest, 0.45) },
  unit: { fontFamily: font.medium, fontSize: 17, letterSpacing: 0, color: withAlpha(palette.forest, 0.45) },
});
