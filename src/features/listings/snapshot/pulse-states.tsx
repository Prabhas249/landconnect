import type { LucideIcon } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import type { LandType } from '@/lib/types';
import { font, palette, radius, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { withAlpha } from '../meta';
import { INK, MapPanelShell, MapPill, useRise } from './pulse-map';
import { CALM, CARD_RADIUS, PAD, PAD_BOTTOM, PANEL_INSET } from './pulse-model';
import { Rolling, type RollPart } from './rolling';

/* Text block under the panel: fixed line boxes so the skeleton matches the card exactly. */
export const KICKER_H = 18;
export const FIGURE_H = 50;
export const CAPTION_H = 18;
export const CHIPS_GAP = 16;
export const CHIP_H = 22;

/** White card with the soft lift, a 5% ink border and the panel inset 8pt from its outer edge. */
export function PulseCard({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Chip hues: green for proof, blue for place and interest, amber for money. */
export const CHIP_BLUE = '#3B6FD8';

/**
 * Icon-in-circle stat: a solid coloured disc with a white glyph, the value in ink and an optional
 * soft label. Rises in after the figure, staggered by `index`. Pressable when given `onPress`.
 */
export function StatChip({
  icon: Icon,
  color,
  value,
  label,
  index,
  reduced,
  onPress,
  a11y,
  badge,
}: {
  icon: LucideIcon;
  color: string;
  value: string;
  label?: string;
  index: number;
  reduced: boolean;
  onPress?: () => void;
  a11y?: string;
  /** A small amber dot after the value (unread). */
  badge?: boolean;
}) {
  const rise = useRise(reduced, 520 + index * 60);
  const body = (
    <>
      <View style={[styles.chipIcon, { backgroundColor: color }]}>
        <Icon size={12} color={palette.white} strokeWidth={2.6} />
      </View>
      <Text style={styles.chipValue} numberOfLines={1}>
        {value}
        {label ? <Text style={styles.chipLabel}>{` ${label}`}</Text> : null}
      </Text>
      {badge ? <View style={styles.chipBadge} /> : null}
    </>
  );
  const name = a11y ?? (label ? `${value} ${label}` : value);
  return (
    <Animated.View style={rise}>
      {onPress ? (
        <PressableScale haptic="selection" to={0.95} onPress={onPress} accessibilityLabel={name} hitSlop={8} style={styles.chipRow}>
          {body}
        </PressableScale>
      ) : (
        <View style={styles.chipRow} accessible accessibilityLabel={name}>
          {body}
        </View>
      )}
    </Animated.View>
  );
}

/** Chips slide over (CALM) when a neighbour changes width. */
const CHIP_SHIFT = LinearTransition.springify().stiffness(CALM.stiffness).damping(CALM.damping).mass(CALM.mass);
const ROLL_CHIP_H = 20;

/**
 * StatChip for a live figure: the same icon disc, a touch tighter (20pt disc, 14pt value) so
 * three fit one row on phones, with the number rolling and the words crossfading when the data
 * changes. `delay` staggers it behind the figure.
 */
export function RollingStatChip({
  icon: Icon,
  color,
  parts,
  label,
  a11y,
  index,
  dir,
  reduced,
}: {
  icon: LucideIcon;
  color: string;
  /** The value as rolling parts ("11", or "₹", "70", "L", "–", "30.5", "Cr"). */
  parts: RollPart[];
  label?: string;
  a11y: string;
  index: number;
  dir: number;
  reduced: boolean;
}) {
  const rise = useRise(reduced, 520 + index * 60);
  const all: RollPart[] = label ? [...parts, { kind: 'text', text: label, style: styles.rollLabel, drop: 1 }] : parts;
  return (
    <Animated.View layout={reduced ? undefined : CHIP_SHIFT}>
      <Animated.View style={[styles.rollChip, rise]} accessible accessibilityLabel={a11y}>
        <View style={[styles.rollIcon, { backgroundColor: color }]}>
          <Icon size={11} color={palette.white} strokeWidth={2.6} />
        </View>
        <Rolling parts={all} style={styles.rollValue} lineHeight={ROLL_CHIP_H} dir={dir} reduced={reduced} delay={40 + index * 40} />
      </Animated.View>
    </Animated.View>
  );
}

/** Panel width for a card of `cardWidth` (the inset includes the 1pt border). */
export const panelWidthOf = (cardWidth: number) => cardWidth - PANEL_INSET * 2;

function Block({ width, height, r = 5 }: { width: number; height: number; r?: number }) {
  return <View style={{ width, height, borderRadius: r, borderCurve: 'continuous', backgroundColor: BLOCK }} />;
}

/**
 * Same geometry as the loaded card: the bare map ground, then pale blocks where the kicker,
 * figure, caption and chips sit. Fades in once; no shimmer loop.
 */
export function PulseSkeleton({ width, extraRow = false, label = 'Loading market pulse' }: { width: number; extraRow?: boolean; label?: string }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    o.set(reduced ? 1 : withTiming(1, { duration: 240 }));
  }, [o, reduced]);
  const fade = useAnimatedStyle(() => ({ opacity: o.get() }));
  const narrow = width - PAD * 2 < 300;
  return (
    <PulseCard>
      <Animated.View style={fade} accessibilityLabel={label}>
        <View style={styles.dim}>
          <MapPanelShell width={panelWidthOf(width)} />
        </View>
        <View style={styles.body}>
          <View style={styles.kicker}>
            <Block width={124} height={10} />
          </View>
          <View style={styles.figure}>
            <Block width={narrow ? 150 : 176} height={34} r={8} />
          </View>
          <View style={styles.caption}>
            <Block width={narrow ? 160 : 190} height={10} />
          </View>
          {extraRow ? (
            <View style={styles.extraRow}>
              <Block width={72} height={CHIP_H} r={CHIP_H / 2} />
              <Block width={96} height={CHIP_H} r={CHIP_H / 2} />
            </View>
          ) : null}
          <View style={styles.chips}>
            {[56, 64, 84].map((w, i) => (
              <View key={i} style={styles.chip}>
                <Block width={CHIP_H} height={CHIP_H} r={CHIP_H / 2} />
                <Block width={w} height={10} />
              </View>
            ))}
          </View>
        </View>
      </Animated.View>
    </PulseCard>
  );
}

/** Nothing to measure: say why, and offer the one action that brings figures back. */
export function PulseEmpty({
  width,
  activeType,
  onSelectType,
}: {
  width: number;
  activeType?: LandType | 'all';
  onSelectType?: (t: LandType) => void;
}) {
  const typed = activeType && activeType !== 'all' ? activeType : null;
  return (
    <PulseCard>
      <MapPanelShell width={panelWidthOf(width)}>
        <MapPill />
      </MapPanelShell>
      <View style={[styles.body, styles.emptyBody]}>
        <Text style={styles.emptyTitle}>{typed ? 'No parcels match this filter' : 'No parcels in this view'}</Text>
        <Text style={styles.emptyText} numberOfLines={2}>
          {typed ? 'Clear it to see asking rates across the region.' : 'Clear the search to see asking rates across the region.'}
        </Text>
        {typed && onSelectType ? (
          <PressableScale haptic="selection" onPress={() => onSelectType(typed)} accessibilityLabel="Clear land type filter" style={styles.clear}>
            <Text style={styles.clearText}>Clear filter</Text>
          </PressableScale>
        ) : null}
      </View>
    </PulseCard>
  );
}

const BLOCK = withAlpha(INK, 0.06);

const styles = StyleSheet.create({
  card: {
    padding: PANEL_INSET - 1,
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: withAlpha(INK, 0.05),
    backgroundColor: palette.white,
    boxShadow: '0 12px 32px rgba(16,32,28,0.08)',
  },
  dim: { opacity: 0.7 },
  body: { paddingTop: PAD, paddingHorizontal: PAD - PANEL_INSET, paddingBottom: PAD_BOTTOM - PANEL_INSET },
  kicker: { height: KICKER_H, justifyContent: 'center' },
  figure: { height: FIGURE_H, justifyContent: 'center' },
  caption: { height: CAPTION_H, justifyContent: 'center' },
  chips: { marginTop: CHIPS_GAP, flexDirection: 'row', gap: space[4] },
  chip: { height: CHIP_H, flexDirection: 'row', alignItems: 'center', gap: 6 },
  extraRow: { marginTop: 12, flexDirection: 'row', gap: 6 },
  chipRow: { height: CHIP_H, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipIcon: { width: CHIP_H, height: CHIP_H, borderRadius: CHIP_H / 2, alignItems: 'center', justifyContent: 'center' },
  chipValue: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: INK, fontVariant: ['tabular-nums'] },
  chipLabel: { fontFamily: font.medium, fontSize: 13, color: withAlpha(INK, 0.5) },
  rollChip: { height: CHIP_H, flexDirection: 'row', alignItems: 'center', gap: 5 },
  rollIcon: { width: ROLL_CHIP_H, height: ROLL_CHIP_H, borderRadius: ROLL_CHIP_H / 2, alignItems: 'center', justifyContent: 'center' },
  rollValue: { fontFamily: font.semibold, fontSize: 14, lineHeight: ROLL_CHIP_H, letterSpacing: -0.2, color: INK, fontVariant: ['tabular-nums'] },
  rollLabel: { marginLeft: 3, fontFamily: font.medium, fontSize: 12.5, letterSpacing: 0, color: withAlpha(INK, 0.5) },
  chipBadge: { width: 6, height: 6, borderRadius: 3, marginLeft: -2, backgroundColor: palette.amber },
  emptyBody: { gap: space[1] },
  emptyTitle: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: INK },
  emptyText: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: withAlpha(INK, 0.55) },
  clear: {
    alignSelf: 'flex-start',
    height: 32,
    marginTop: space[2],
    paddingHorizontal: space[3] + 2,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: palette.green,
  },
  clearText: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18, color: palette.white },
});
