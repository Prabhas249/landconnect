import { BadgeCheck, IndianRupee, MapPin } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatPrice, priceParts } from '@/lib/format';
import type { LandType, Listing } from '@/lib/types';
import { font, gutter, palette } from '@/theme/tokens';
import { Text } from '@/ui/text';

import { landTypeLabel, withAlpha } from './meta';
import { RollingFigure } from './snapshot/pulse-figure';
import { INK, PulseMap, useRise } from './snapshot/pulse-map';
import { CALM, NARROW_BELOW, PAD, PAD_BOTTOM, PANEL_INSET, pulseOf, type Pulse } from './snapshot/pulse-model';
import {
  CAPTION_H,
  CHIPS_GAP,
  CHIP_BLUE,
  FIGURE_H,
  KICKER_H,
  PulseCard,
  PulseEmpty,
  PulseSkeleton,
  RollingStatChip,
  panelWidthOf,
} from './snapshot/pulse-states';
import { enterSlide, exitSlide, useMounted, type RollPart } from './snapshot/rolling';

export type MarketSnapshotProps = {
  /** The list the feed is showing. */
  listings: Listing[];
  loading?: boolean;
  /** Clears the land-type filter from the empty state. */
  onSelectType?: (t: LandType) => void;
  activeType?: LandType | 'all';
  /** Host list's scroll offset; the map's idle ring pauses once the card scrolls away. */
  scrollY?: SharedValue<number>;
};

/**
 * "Live": the figures are today's asking rates, straight from the feed. A still dot that gives
 * one tiny pulse (dot swell + a fading ring) whenever the data under it changes.
 */
function LiveTag({ reduced, beat }: { reduced: boolean; beat: number }) {
  const rise = useRise(reduced, 440);
  const dot = useSharedValue(1);
  const ring = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) return;
    dot.set(withSequence(withTiming(1.7, { duration: 140 }), withSpring(1, CALM)));
    ring.set(0);
    ring.set(withTiming(1, { duration: 620 }));
  }, [beat, reduced, dot, ring]);
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dot.get() }] }));
  const ringStyle = useAnimatedStyle(() => {
    const p = ring.get();
    return { opacity: p < 1 ? 0.5 * (1 - p) : 0, transform: [{ scale: 1 + 1.8 * p }] };
  });
  return (
    <Animated.View style={[styles.live, rise]} accessible accessibilityLabel="Live asking rates">
      <View style={styles.liveDotBox}>
        <Animated.View style={[styles.liveRing, ringStyle]} />
        <Animated.View style={[styles.liveDot, dotStyle]} />
      </View>
      <Text style={styles.liveText}>Live</Text>
    </Animated.View>
  );
}

/** "₹70L–30.5Cr" as rolling parts: compact units, no spaces, so the chip stays on one row. */
function rangeParts(pulse: Pulse): { parts: RollPart[]; label?: string; a11y: string } | null {
  const priced = pulse.rated.length;
  if (!priced) return null;
  const lo = priceParts(pulse.minRate);
  if (priced > 1 && pulse.maxRate > pulse.minRate) {
    const hi = priceParts(pulse.maxRate);
    return {
      parts: [
        { kind: 'text', text: '₹' },
        { kind: 'num', text: lo.amount },
        { kind: 'text', text: lo.unit },
        { kind: 'text', text: '–', style: styles.dashSep },
        { kind: 'num', text: hi.amount },
        { kind: 'text', text: hi.unit },
      ],
      a11y: `Asking rates from ${formatPrice(pulse.minRate)} to ${formatPrice(pulse.maxRate)} per acre`,
    };
  }
  return {
    parts: [
      { kind: 'text', text: '₹' },
      { kind: 'num', text: lo.amount },
      { kind: 'text', text: lo.unit, style: styles.unitGap },
    ],
    label: 'per acre',
    a11y: `${formatPrice(pulse.minRate)} per acre`,
  };
}

/**
 * Market pulse: the one hero on Explore. "Land on the map, and what an acre costs" — every parcel
 * on a soft illustrated map with the cheapest, median and dearest raised as photo callouts, then
 * the median asking rate as one big figure and three icon stats. Switching the land-type filter
 * plays one choreographed change: dots leave, glide and pop in while the map re-fits, callouts
 * swap, the route redraws, the figure rolls digit by digit, and the caption and chips follow
 * 40 ms apart. Reduced motion lands everything at once.
 */
export function MarketSnapshot({ listings, loading, onSelectType, activeType, scrollY }: MarketSnapshotProps) {
  const reduced = useReducedMotion();
  const { width: windowW } = useWindowDimensions();
  const [width, setWidth] = useState(Math.round(windowW - gutter * 2));
  const mounted = useMounted();

  const onLayout = (w: number) => {
    const next = Math.round(w);
    if (next > 0 && next !== width) setWidth(next);
  };

  const pulse = useMemo(() => pulseOf(listings), [listings]);
  // Which way the median moved, and a beat for the Live tag: derived when the data changes.
  const sig = `${activeType ?? 'all'}|${pulse.total}|${pulse.medianRate}|${pulse.rated.length}|${pulse.verified}|${pulse.districts}`;
  const [track, setTrack] = useState({ sig, median: pulse.medianRate, dir: 0, beat: 0 });
  if (track.sig !== sig && !loading) {
    setTrack({ sig, median: pulse.medianRate, dir: Math.sign(pulse.medianRate - track.median), beat: track.beat + 1 });
  }
  const dir = track.dir;

  let body;
  if (loading) body = <PulseSkeleton width={width} />;
  else if (pulse.total === 0) body = <PulseEmpty width={width} activeType={activeType} onSelectType={onSelectType} />;
  else {
    const narrow = width - PAD * 2 < NARROW_BELOW;
    const priced = pulse.rated.length;
    const typed = activeType && activeType !== 'all' ? landTypeLabel(activeType).toLowerCase() + ' ' : '';
    const noun = priced === 1 ? 'parcel' : 'parcels';
    const caption = priced
      ? `${priced} ${typed}${noun} across ${pulse.region}`
      : `No asking rates yet · ${pulse.total} ${pulse.total === 1 ? 'parcel' : 'parcels'}`;
    const range = rangeParts(pulse);
    const swapDy = dir < 0 ? -6 : 6;
    const districtWord = pulse.districts === 1 ? 'district' : 'districts';

    body = (
      <PulseCard>
        <PulseMap width={panelWidthOf(width)} pulse={pulse} reduced={reduced} breathe scrollY={scrollY} refined />
        <View style={styles.body}>
          <View style={styles.kickerRow}>
            <Text style={[styles.kicker, styles.shrink]} numberOfLines={1}>
              Median asking rate
            </Text>
            {priced ? <LiveTag reduced={reduced} beat={track.beat} /> : null}
          </View>
          <View style={styles.figure}>
            {priced ? <RollingFigure value={pulse.medianRate} reduced={reduced} compact={narrow} dir={dir} /> : <Text style={styles.dash}>—</Text>}
          </View>
          <View style={styles.captionBox}>
            <Animated.View
              key={caption}
              entering={!reduced && mounted.current ? enterSlide(40, swapDy) : undefined}
              exiting={reduced ? undefined : exitSlide(swapDy)}
              style={styles.captionSlot}>
              <Text style={styles.caption} numberOfLines={1}>
                {caption}
              </Text>
            </Animated.View>
          </View>
          <View style={styles.chips}>
            <RollingStatChip
              icon={BadgeCheck}
              color={palette.green}
              parts={[{ kind: 'num', text: String(pulse.verified) }]}
              label="verified"
              a11y={`${pulse.verified} verified`}
              index={1}
              dir={dir}
              reduced={reduced}
            />
            <RollingStatChip
              icon={MapPin}
              color={CHIP_BLUE}
              parts={[{ kind: 'num', text: String(pulse.districts) }]}
              label={districtWord}
              a11y={`${pulse.districts} ${districtWord}`}
              index={2}
              dir={dir}
              reduced={reduced}
            />
            {range ? (
              <RollingStatChip
                icon={IndianRupee}
                color={palette.amber}
                parts={range.parts}
                label={range.label}
                a11y={range.a11y}
                index={3}
                dir={dir}
                reduced={reduced}
              />
            ) : null}
          </View>
        </View>
      </PulseCard>
    );
  }

  return <View onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>{body}</View>;
}

/** Kept for callers that render the loading card on its own. */
export function MarketSnapshotSkeleton() {
  const { width } = useWindowDimensions();
  return <PulseSkeleton width={Math.round(width - gutter * 2)} />;
}

const SOFT = withAlpha(INK, 0.55);

const styles = StyleSheet.create({
  body: { paddingTop: PAD, paddingHorizontal: PAD - PANEL_INSET, paddingBottom: PAD_BOTTOM - PANEL_INSET },
  kickerRow: { height: KICKER_H, flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  live: {
    height: 18,
    paddingLeft: 6,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 9,
    backgroundColor: withAlpha(palette.green, 0.08),
  },
  liveDotBox: { width: 5, height: 5 },
  liveDot: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5, backgroundColor: palette.green },
  liveRing: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5, borderWidth: 1, borderColor: palette.green },
  liveText: { fontFamily: font.semibold, fontSize: 10, lineHeight: 12, letterSpacing: 0.3, color: palette.green },
  kicker: { fontFamily: font.medium, fontSize: 13, lineHeight: KICKER_H, color: SOFT },
  figure: { height: FIGURE_H, justifyContent: 'center' },
  dash: { fontFamily: font.bold, fontSize: 44, lineHeight: FIGURE_H, color: withAlpha(INK, 0.3) },
  captionBox: { height: CAPTION_H },
  captionSlot: { position: 'absolute', left: 0, right: 0, top: 0 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: CAPTION_H, color: SOFT },
  chips: { marginTop: CHIPS_GAP, flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 10 },
  dashSep: { marginHorizontal: 1, color: withAlpha(INK, 0.45) },
  unitGap: { marginLeft: 3 },
});
