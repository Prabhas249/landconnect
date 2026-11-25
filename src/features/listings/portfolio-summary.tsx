import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Eye, IndianRupee, LandPlot, MessageCircle, Plus, type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { fetchConversations } from '@/data/chat';
import { qk } from '@/data/keys';
import { formatNumber, formatPrice, toAcres } from '@/lib/format';
import type { Listing, ListingStatus } from '@/lib/types';
import { colors, font, gutter, palette, radius } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { withAlpha } from './meta';
import { PulseFigure } from './snapshot/pulse-figure';
import { INK, MapPanelShell, PulseMap, useRise, type CalloutText } from './snapshot/pulse-map';
import { NARROW_BELOW, PAD, PAD_BOTTOM, PANEL_INSET, pulseOf } from './snapshot/pulse-model';
import {
  CAPTION_H,
  CHIPS_GAP,
  CHIP_BLUE,
  FIGURE_H,
  KICKER_H,
  PulseCard,
  PulseSkeleton,
  StatChip,
  panelWidthOf,
} from './snapshot/pulse-states';

/**
 * One motion for the whole portfolio: critically damped (ζ ≈ 1), settles in about 400 ms on a
 * phone and never overshoots, in the manner of iOS system springs.
 */
export const SETTLE = { damping: 32, stiffness: 260, mass: 1, overshootClamping: true } as const;

const ORDER: ListingStatus[] = ['active', 'under_offer', 'draft', 'sold'];
const COUNT_MS = 720;
const RECOUNT_MS = 380;
const SOFT = withAlpha(INK, 0.55);
const AMBER_INK = '#A8640C';

/** Status chips on white: a soft wash of the status hue, its dot, label and count. */
export const LIGHT_STATUS: Record<ListingStatus, { label: string; color: string; wash: string; ink: string }> = {
  active: { label: 'Active', color: palette.green, wash: withAlpha(palette.green, 0.08), ink: palette.green },
  under_offer: { label: 'Under offer', color: palette.amber, wash: withAlpha(palette.amber, 0.12), ink: AMBER_INK },
  draft: { label: 'Draft', color: colors.inkTertiary, wash: withAlpha(INK, 0.05), ink: colors.inkSecondary },
  sold: { label: 'Sold', color: INK, wash: withAlpha(INK, 0.07), ink: INK },
};

// ── enquiries

export type EnquiryStats = {
  /** People in a direct conversation with you about one of your listings, with at least one message. */
  total: number;
  /** Of those, conversations with messages you have not read. */
  unread: number;
  byListing: Record<string, number>;
};

/**
 * Enquiries are derived from the inbox the tab bar already keeps warm (same query key), so no
 * extra request. A direct chat is one per pair of people and carries the listing it was last
 * opened about, so each enquirer is counted once, against that listing. Rooms are excluded:
 * the owner usually creates them, so they are not inbound interest.
 */
export function useEnquiryStats(listings: Listing[]): { stats: EnquiryStats | null; pending: boolean } {
  const { data, isPending, isError } = useQuery({ queryKey: qk.conversations, queryFn: fetchConversations });
  if (isPending) return { stats: null, pending: true };
  if (isError || !data) return { stats: null, pending: false };

  const mine = new Set(listings.map((l) => l.id));
  const byListing: Record<string, number> = {};
  let total = 0;
  let unread = 0;
  for (const c of data) {
    if (c.kind !== 'direct' || !c.listing_id || !mine.has(c.listing_id) || !c.peer || !c.last_message_sender) continue;
    total += 1;
    if (c.unread > 0) unread += 1;
    byListing[c.listing_id] = (byListing[c.listing_id] ?? 0) + 1;
  }
  return { stats: { total, unread, byListing }, pending: false };
}

// ── count-up, once per session

/** Figures that have already counted up this session; later visits show them settled. */
const counted = new Set<string>();

function useCountUp(key: string, value: number, reduced: boolean) {
  const fresh = useRef(!counted.has(key) && !reduced);
  const [shown, setShown] = useState(fresh.current ? 0 : value);
  const current = useRef(fresh.current ? 0 : value);

  useEffect(() => {
    counted.add(key);
    const from = current.current;
    if (reduced || from === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const ms = fresh.current ? COUNT_MS : RECOUNT_MS;
    fresh.current = false;
    const start = Date.now();
    let raf = 0;
    let last = 0;
    const step = () => {
      const now = Date.now();
      const t = Math.min(1, (now - start) / ms);
      const next = from + (value - from) * (1 - Math.pow(1 - t, 3));
      current.current = next;
      // Shown rounded, so commit whole numbers at ~30 fps: equal values bail out in React.
      if (t >= 1) setShown(value);
      else if (now - last >= 32) {
        last = now;
        setShown(Math.round(next));
      }
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, value, reduced]);

  return shown;
}

// ── pieces

/** Card width, measured; starts from the window so the first frame is already right. */
function useCardWidth() {
  const { width: windowW } = useWindowDimensions();
  const [width, setWidth] = useState(Math.round(windowW - gutter * 2));
  const onLayout = (w: number) => {
    const next = Math.round(w);
    if (next > 0 && next !== width) setWidth(next);
  };
  return { width, onLayout };
}

/** A stat chip whose number counts up once per session. */
function CountChip({
  id,
  value,
  icon,
  color,
  label,
  index,
  reduced,
  onPress,
  a11y,
  badge,
}: {
  id: string;
  value: number;
  icon: LucideIcon;
  color: string;
  label: string;
  index: number;
  reduced: boolean;
  onPress?: () => void;
  a11y: string;
  badge?: boolean;
}) {
  const shown = useCountUp(id, value, reduced);
  return (
    <StatChip
      icon={icon}
      color={color}
      value={formatNumber(Math.round(shown))}
      label={label}
      index={index}
      reduced={reduced}
      onPress={onPress}
      a11y={a11y}
      badge={badge}
    />
  );
}

function StatusChip({ status, count, index, reduced }: { status: ListingStatus; count: number; index: number; reduced: boolean }) {
  const look = LIGHT_STATUS[status];
  const rise = useRise(reduced, 440 + index * 50);
  return (
    <Animated.View style={[styles.status, { backgroundColor: look.wash }, rise]} accessible accessibilityLabel={`${count} ${look.label.toLowerCase()}`}>
      <View style={[styles.statusDot, { backgroundColor: look.color }]} />
      <Text style={[styles.statusText, { color: look.ink }]} numberOfLines={1}>
        {look.label}
        <Text style={styles.statusCount}>{`  ${count}`}</Text>
      </Text>
    </Animated.View>
  );
}

/** The one actionable cue: unread enquiries, in amber, straight to Chats. */
function AwaitingPill({ count, onPress, reduced }: { count: number; onPress?: () => void; reduced: boolean }) {
  const label = `${count} ${count === 1 ? 'enquiry' : 'enquiries'} awaiting reply`;
  const rise = useRise(reduced, 700);
  return (
    <Animated.View style={[styles.awaitingWrap, rise]}>
      <PressableScale haptic="selection" onPress={onPress} accessibilityLabel={`${label}. Open chats`} style={styles.awaiting}>
        <View style={styles.awaitingDot} />
        <Text style={styles.awaitingText} numberOfLines={1}>
          {label}
        </Text>
        <ChevronRight size={14} color={AMBER_INK} strokeWidth={2.4} />
      </PressableScale>
    </Animated.View>
  );
}

/** Seller callouts carry each parcel's asking total, not its rate. */
const askingTotal: CalloutText = (r) => {
  const price = formatPrice(r.rate * r.acres);
  return { value: price, a11y: `asking ${price}` };
};

// ── hero

export type PortfolioHeroProps = {
  listings: Listing[];
  enquiries?: EnquiryStats | null;
  enquiriesPending?: boolean;
  /** Opens the most-viewed listing from the Views stat. */
  onOpenListing?: (id: string) => void;
  /** Opens Chats from the Enquiries stat. */
  onOpenChats?: () => void;
};

/**
 * The owner's portfolio at a glance, a sibling of Explore's Market pulse: the same white card,
 * the owner's own parcels on the soft illustrated map as photo callouts with their asking
 * totals, the total asking value as one big figure, a caption of listings and acres, status
 * chips, and three icon stats for attention (views), interest (enquiries) and pricing (average
 * per acre). Every figure is computed from rows the owner can read.
 */
export function PortfolioHero({ listings, enquiries, enquiriesPending = false, onOpenListing, onOpenChats }: PortfolioHeroProps) {
  const reduced = useReducedMotion();
  const { width, onLayout } = useCardWidth();
  const pulse = useMemo(() => pulseOf(listings), [listings]);

  const acres = listings.reduce((s, l) => s + toAcres(l.area_value, l.area_unit), 0);
  const value = listings.reduce((s, l) => s + l.price_total, 0);
  const views = listings.reduce((s, l) => s + l.views, 0);
  const rate = acres > 0 ? value / acres : 0;
  const counts = ORDER.map((status) => ({ status, count: listings.filter((l) => l.status === status).length })).filter(
    (c) => c.count > 0,
  );
  let top: Listing | null = null;
  for (const l of listings) if (l.views > 0 && (!top || l.views > top.views)) top = l;

  const narrow = width - PAD * 2 < NARROW_BELOW;
  const n = listings.length;
  const shownAcres = formatNumber(Math.round(acres * 10) / 10);
  const caption = `${n} ${n === 1 ? 'listing' : 'listings'}${acres > 0 ? ` · ${shownAcres} ${acres === 1 ? 'acre' : 'acres'}` : ''}`;

  return (
    <View onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
      <PulseCard>
        <PulseMap width={panelWidthOf(width)} pulse={pulse} reduced={reduced} calloutText={askingTotal} route={false} pill={false} />
        <View style={styles.body}>
          <Text style={styles.kicker} numberOfLines={1}>
            Asking value
          </Text>
          <View style={styles.figure}>
            {value > 0 ? (
              <PulseFigure value={value} reduced={reduced} compact={narrow} perAcre={false} countKey="portfolio:value" />
            ) : (
              <Text style={styles.dash}>—</Text>
            )}
          </View>
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
          {counts.length ? (
            <View style={styles.statuses}>
              {counts.map((c, i) => (
                <StatusChip key={c.status} status={c.status} count={c.count} index={i} reduced={reduced} />
              ))}
            </View>
          ) : null}
          <View style={styles.chips}>
            <CountChip
              id="portfolio:views"
              value={views}
              icon={Eye}
              color={palette.green}
              label={views === 1 ? 'view' : 'views'}
              index={0}
              reduced={reduced}
              a11y={top ? `${views} views. Open your most viewed listing` : `${views} views`}
              onPress={top && onOpenListing ? () => onOpenListing(top.id) : undefined}
            />
            {enquiries ? (
              <CountChip
                id="portfolio:enquiries"
                value={enquiries.total}
                icon={MessageCircle}
                color={CHIP_BLUE}
                label={enquiries.total === 1 ? 'enquiry' : 'enquiries'}
                index={1}
                reduced={reduced}
                badge={enquiries.unread > 0}
                a11y={`${enquiries.total} ${enquiries.total === 1 ? 'enquiry' : 'enquiries'}${enquiries.unread > 0 ? `, ${enquiries.unread} unread` : ''}. Open chats`}
                onPress={onOpenChats}
              />
            ) : (
              <StatChip
                icon={MessageCircle}
                color={CHIP_BLUE}
                value={enquiriesPending ? '·' : '–'}
                label="enquiries"
                index={1}
                reduced={reduced}
                a11y="Enquiries. Open chats"
                onPress={onOpenChats}
              />
            )}
            {rate > 0 ? (
              <StatChip
                icon={IndianRupee}
                color={palette.amber}
                value={formatPrice(rate)}
                label="/acre"
                index={2}
                reduced={reduced}
                a11y={`Average asking rate ${formatPrice(rate)} per acre`}
              />
            ) : null}
          </View>
          {enquiries && enquiries.unread > 0 ? <AwaitingPill count={enquiries.unread} onPress={onOpenChats} reduced={reduced} /> : null}
        </View>
      </PulseCard>
    </View>
  );
}

/** Same frame and rhythm as the loaded hero, so nothing shifts when figures arrive. */
export function PortfolioHeroSkeleton() {
  const { width, onLayout } = useCardWidth();
  return (
    <View onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
      <PulseSkeleton width={width} extraRow label="Loading your portfolio" />
    </View>
  );
}

/** No listings yet: the bare map waiting for a first pin, and one clear action. */
export function PortfolioEmpty({ onList }: { onList: () => void }) {
  const { width, onLayout } = useCardWidth();
  return (
    <View onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
      <PulseCard>
        <MapPanelShell width={panelWidthOf(width)}>
          <View style={styles.emptyPin} pointerEvents="none">
            <View style={styles.emptyDisc}>
              <LandPlot size={22} color={palette.green} strokeWidth={2} />
            </View>
          </View>
        </MapPanelShell>
        <View style={[styles.body, styles.emptyBody]}>
          <Text style={styles.emptyTitle}>List your first land opportunity</Text>
          <Text style={styles.emptyText}>Add photos, a price and a pin. Buyers see an approximate area until you choose to share more.</Text>
          <Button
            label="List land"
            variant="accent"
            haptic="medium"
            leading={<Plus size={18} color={colors.inkOnDark} strokeWidth={2.4} />}
            onPress={onList}
            style={styles.emptyButton}
          />
        </View>
      </PulseCard>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: PAD, paddingHorizontal: PAD - PANEL_INSET, paddingBottom: PAD_BOTTOM - PANEL_INSET },
  kicker: { fontFamily: font.medium, fontSize: 13, lineHeight: KICKER_H, color: SOFT },
  figure: { height: FIGURE_H, justifyContent: 'center' },
  dash: { fontFamily: font.bold, fontSize: 44, lineHeight: FIGURE_H, color: withAlpha(INK, 0.3) },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: CAPTION_H, color: SOFT },
  statuses: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  status: { height: 22, paddingLeft: 8, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16 },
  statusCount: { fontVariant: ['tabular-nums'] },
  chips: { marginTop: CHIPS_GAP, flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 10 },
  awaitingWrap: { marginTop: 14, alignSelf: 'flex-start' },
  awaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: withAlpha(palette.amber, 0.12),
  },
  awaitingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.amber },
  awaitingText: { flexShrink: 1, fontFamily: font.semibold, fontSize: 13, lineHeight: 18, color: AMBER_INK },
  emptyPin: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  emptyDisc: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.white,
    boxShadow: '0 1px 2px rgba(16,32,28,0.06), 0 6px 16px rgba(16,32,28,0.12)',
  },
  emptyBody: { gap: 6 },
  emptyTitle: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, color: INK },
  emptyText: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: SOFT },
  emptyButton: { marginTop: 10 },
});
