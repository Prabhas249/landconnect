import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Bookmark, CloudOff, Compass, Eye, MessageCircle, Pause, PenLine, Play, Plus, Rotate3d, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  LinearTransition,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { qk } from '@/data/keys';
import { fetchMyListings, fetchSavedListings } from '@/data/listings';
import { formatArea, formatNumber, formatPrice, priceParts } from '@/lib/format';
import { ROLE_COPY, type Listing, type ListingStatus, type ListingWithOwner } from '@/lib/types';
import { canManageListings, useSession } from '@/stores/session';
import { colors, duration, font, gutter, maxStagger, palette, radius, space, stagger } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { useClampedScroll } from '@/ui/clamped-scroll';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { ContourArt } from './graphics/contour-art';
import { ListingCard, ListingCardSkeleton } from './listing-card';
import { Photo } from './media/photo';
import { STATUS_META, withAlpha } from './meta';
import { OptionSheet } from './option-sheet';
import { LIGHT_STATUS, PortfolioEmpty, PortfolioHero, PortfolioHeroSkeleton, SETTLE, useEnquiryStats } from './portfolio-summary';
import { INK } from './snapshot/pulse-map';
import { CHIP_BLUE } from './snapshot/pulse-states';
import { SkeletonBlock } from './skeleton';
import { StateView } from './state-view';
import { STATUS_CHOICES, useListingMutations } from './use-listing-mutations';
import { useSaved } from './use-saved';

const openListing = (id: string) => router.push({ pathname: '/listing/[id]', params: { id } });
const newListing = () => router.push('/listing/edit');
const openChats = () => router.navigate('/chats');

const MyLandList = Animated.createAnimatedComponent(FlashList<Listing>);
const SavedList = Animated.createAnimatedComponent(FlashList<ListingWithOwner>);

/** Bar row height under the status bar, and how far the canvas keeps dissolving below it. */
const BAR_H = 52;
const TAIL = space[6];
/** Scroll offset where the page title has handed over to the compact bar. */
const COLLAPSE = space[12];

const CANVAS_CLEAR = withAlpha(colors.canvas, 0);

// ── motion

/** Every entrance on this tab: the shared critically damped spring, 50 ms apart, capped. */
function Rise({ index, children, style }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, maxStagger) * stagger)
        .springify()
        .damping(SETTLE.damping)
        .stiffness(SETTLE.stiffness)
        .mass(SETTLE.mass)
        .overshootClamping(1)}
      style={style}>
      {children}
    </Animated.View>
  );
}

/** Scroll offset on the UI thread, plus a JS flag that flips only when the bar takes over. */
function useCollapse() {
  const scrollY = useSharedValue(0);
  const [compact, setCompact] = useState(false);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });
  useAnimatedReaction(
    () => scrollY.get() > COLLAPSE * 0.7,
    (now, before) => {
      if (now !== before) scheduleOnRN(setCompact, now);
    },
  );
  return { scrollY, onScroll, compact };
}

// ── chrome

/**
 * Canvas fade plus compact title. Invisible at rest; once content moves nothing sits under the
 * status bar. The optional action is the page's "List land" button reappearing as an icon.
 */
function TopChrome({
  scrollY,
  compact,
  title,
  action,
}: {
  scrollY: SharedValue<number>;
  compact: boolean;
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  const insets = useScreenInsets();
  const solid = insets.raw.top + BAR_H;
  const height = solid + TAIL;

  const y = useClampedScroll(scrollY, 0, COLLAPSE);
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(y.get(), [0, space[4]], [0, 1], 'clamp') }));
  const titleIn = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [COLLAPSE * 0.45, COLLAPSE], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateY: (1 - p) * space[1] }] };
  });
  const actionIn = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [COLLAPSE * 0.3, COLLAPSE * 0.85], [0, 1], 'clamp');
    return { opacity: p, transform: [{ scale: 0.6 + p * 0.4 }] };
  });

  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.fade, { height }, fade]}>
        <LinearGradient
          colors={[colors.canvas, colors.canvas, CANVAS_CLEAR]}
          locations={[0, solid / height, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View pointerEvents="box-none" style={[styles.bar, { top: insets.raw.top, height: BAR_H }]}>
        <Animated.View pointerEvents="none" style={[styles.barTitle, titleIn]}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
        </Animated.View>
        {action ? (
          <Animated.View pointerEvents={compact ? 'auto' : 'none'} style={[styles.barAction, actionIn]}>
            <IconButton label={action.label} size={40} variant="accent" haptic="medium" onPress={action.onPress}>
              <Plus size={18} color={colors.inkOnDark} strokeWidth={2.4} />
            </IconButton>
          </Animated.View>
        ) : null}
      </View>
    </>
  );
}

/** Large page title; it steps back, and its action shrinks away, as the compact bar takes over. */
function PageTitle({
  scrollY,
  title,
  subtitle,
  action,
  compact = false,
}: {
  scrollY: SharedValue<number>;
  title: string;
  subtitle: string;
  action?: ReactNode;
  /** Once the bar has taken over, the faded-out action must stop taking touches. */
  compact?: boolean;
}) {
  const y = useClampedScroll(scrollY, 0, COLLAPSE);
  const recede = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, COLLAPSE * 0.7], [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(y.get(), [0, COLLAPSE], [0, -space[2]], 'clamp') }],
  }));
  const actionOut = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [0, COLLAPSE * 0.6], [0, 1], 'clamp');
    return { opacity: 1 - p, transform: [{ scale: 1 - p * 0.2 }] };
  });
  return (
    <View style={styles.pageTitle}>
      <Animated.View style={[styles.flex, recede]}>
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="body" tone="secondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </Animated.View>
      {action ? (
        <Animated.View pointerEvents={compact ? 'none' : 'auto'} style={actionOut}>
          {action}
        </Animated.View>
      ) : null}
    </View>
  );
}

// ── rows (sellers and brokers)

/** Rows share Market pulse's language: white card, soft lift, icon-in-circle stats. */
const ROW_PAD = 10;
const ROW_RADIUS = 24;
const THUMB = 76;
const THUMB_RADIUS = ROW_RADIUS - ROW_PAD;
const VIEW_BAR_W = 28;
const STAT_D = 20;
const ACTION_D = 36;

const pillLayout = LinearTransition.springify().damping(SETTLE.damping).stiffness(SETTLE.stiffness).mass(SETTLE.mass);

/** Status chip: the new colour and label fade in and the chip re-sizes with the shared spring. */
function StatusPill({ status, onPress }: { status: ListingStatus; onPress: () => void }) {
  const look = LIGHT_STATUS[status];
  return (
    <Animated.View layout={pillLayout}>
      <PressableScale
        haptic="selection"
        onPress={onPress}
        accessibilityLabel={`Status: ${STATUS_META[status].label}. Change status`}
        style={styles.pill}>
        <Animated.View key={status} entering={FadeIn.duration(duration.base)} style={[StyleSheet.absoluteFill, styles.pillFill, { backgroundColor: look.wash }]} />
        <Animated.View key={`${status}:label`} entering={FadeIn.duration(duration.base)} style={styles.pillContent}>
          <View style={[styles.dot, { backgroundColor: look.color }]} />
          <Text style={[styles.pillText, { color: look.ink }]} numberOfLines={1}>
            {look.label}
          </Text>
        </Animated.View>
      </PressableScale>
    </Animated.View>
  );
}

/** Views relative to the owner's most viewed listing; the "Most viewed" chart, folded into each row. */
function ViewsBar({ share }: { share: number }) {
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.set(withDelay(240, withSpring(share, SETTLE)));
  }, [grow, share]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, grow.get()) }] }));
  return (
    <View style={styles.viewsTrack}>
      <Animated.View style={[styles.viewsFill, fill]} />
    </View>
  );
}

/** Icon-in-circle stat, row size. */
function RowStat({ icon: Icon, color, value, a11y, children }: { icon: LucideIcon; color: string; value: number; a11y: string; children?: ReactNode }) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={a11y}>
      <View style={[styles.statDisc, { backgroundColor: color }]}>
        <Icon size={11} color={palette.white} strokeWidth={2.6} />
      </View>
      <Text style={styles.statValue}>{formatNumber(value)}</Text>
      {children}
    </View>
  );
}

function PortfolioRow({
  listing,
  enquiries,
  maxViews,
  onStatus,
  onTogglePause,
}: {
  listing: Listing;
  enquiries: number | null;
  maxViews: number;
  onStatus: () => void;
  onTogglePause: () => void;
}) {
  const cover = listing.images[0];
  const live = listing.status === 'active' || listing.status === 'under_offer';
  const canToggle = live || listing.status === 'draft';
  const { amount, unit } = priceParts(listing.price_total);

  return (
    <View style={styles.row}>
      <PressableScale onPress={() => openListing(listing.id)} to={0.985} style={styles.rowMain} accessibilityLabel={listing.title}>
        <View style={styles.thumb}>
          {cover ? (
            <Photo uri={cover} size="thumb" recyclingKey={`${listing.id}:cover`} />
          ) : (
            <ContourArt seed={listing.id} landType={listing.land_type} style={StyleSheet.absoluteFill} />
          )}
          {listing.panorama_url ? (
            <View style={styles.pano} pointerEvents="none" accessibilityLabel="Has a 360° photo">
              <Rotate3d size={11} color={colors.inkOnDark} strokeWidth={2.2} />
            </View>
          ) : null}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {listing.title}
          </Text>
          <Text style={styles.rowPlace} numberOfLines={1}>
            {[listing.locality, listing.district].filter(Boolean).join(' · ')}
          </Text>
          <Text style={styles.rowPrice} numberOfLines={1} accessibilityLabel={`${formatPrice(listing.price_total)}, ${formatArea(listing.area_value, listing.area_unit)}`}>
            {`₹${amount}`}
            {unit ? <Text style={styles.rowUnit}>{` ${unit}`}</Text> : null}
            <Text style={styles.rowArea}>{`  ·  ${formatArea(listing.area_value, listing.area_unit)}`}</Text>
          </Text>
        </View>
      </PressableScale>

      <View style={styles.rowFooter}>
        <StatusPill status={listing.status} onPress={onStatus} />
        <RowStat icon={Eye} color={palette.green} value={listing.views} a11y={`${listing.views} views`}>
          {maxViews > 0 ? <ViewsBar share={listing.views / maxViews} /> : null}
        </RowStat>
        {enquiries != null && enquiries > 0 ? (
          <RowStat
            icon={MessageCircle}
            color={CHIP_BLUE}
            value={enquiries}
            a11y={`${enquiries} ${enquiries === 1 ? 'enquiry' : 'enquiries'}`}
          />
        ) : null}
        <View style={styles.rowActions}>
          {canToggle ? (
            <IconButton
              label={live ? 'Pause listing' : 'Publish listing'}
              size={ACTION_D}
              variant="plain"
              haptic="medium"
              onPress={onTogglePause}
              style={live ? styles.action : styles.actionGo}>
              {live ? (
                <Pause size={15} color={colors.inkSecondary} strokeWidth={2.2} />
              ) : (
                <Play size={15} color={palette.green} strokeWidth={2.2} />
              )}
            </IconButton>
          ) : null}
          <IconButton
            label="Edit listing"
            size={ACTION_D}
            variant="plain"
            style={styles.action}
            onPress={() => router.push({ pathname: '/listing/edit', params: { id: listing.id } })}>
            <PenLine size={15} color={colors.inkSecondary} strokeWidth={2.2} />
          </IconButton>
        </View>
      </View>
    </View>
  );
}

function RowSkeleton() {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <SkeletonBlock width={THUMB} height={THUMB} r={THUMB_RADIUS} />
        <View style={[styles.rowBody, styles.skeletonBody]}>
          <SkeletonBlock width="72%" height={15} />
          <SkeletonBlock width="48%" height={12} />
          <SkeletonBlock width="40%" height={17} />
        </View>
      </View>
      <View style={styles.rowFooter}>
        <SkeletonBlock width={96} height={26} r={radius.pill} />
        <SkeletonBlock width={64} height={14} />
      </View>
    </View>
  );
}

function MyLand() {
  const insets = useScreenInsets({ tabBar: true });
  const role = useSession((s) => s.profile?.role);
  const { setStatus } = useListingMutations();
  const [statusFor, setStatusFor] = useState<Listing | null>(null);
  const [pulling, setPulling] = useState(false);
  const { scrollY, onScroll, compact } = useCollapse();

  const { data, isPending, isError, refetch } = useQuery({ queryKey: qk.myListings, queryFn: fetchMyListings });
  const listings = data ?? [];
  const enquiries = useEnquiryStats(listings);
  const maxViews = listings.reduce((m, l) => Math.max(m, l.views), 0);

  // Pausing hides the listing from Explore (draft) without losing anything; publishing brings it back.
  const togglePause = (l: Listing) => setStatus(l.id, l.status === 'draft' ? 'active' : 'draft');

  const renderItem = ({ item, index }: ListRenderItemInfo<Listing>) => {
    // Keyed by listing so a recycled cell never animates one listing's pill into another's.
    const row = (
      <PortfolioRow
        key={item.id}
        listing={item}
        enquiries={enquiries.stats ? (enquiries.stats.byListing[item.id] ?? 0) : null}
        maxViews={maxViews}
        onStatus={() => setStatusFor(item)}
        onTogglePause={() => togglePause(item)}
      />
    );
    return <View style={styles.cell}>{index < 6 ? <Rise index={index + 2}>{row}</Rise> : row}</View>;
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Rise index={0}>
        <PageTitle
          scrollY={scrollY}
          title="My land"
          subtitle={role ? `${ROLE_COPY[role].label} portfolio` : 'Portfolio'}
          compact={compact}
          action={
            <Button
              label="List land"
              variant="accent"
              size="sm"
              block={false}
              haptic="medium"
              leading={<Plus size={16} color={colors.inkOnDark} strokeWidth={2.4} />}
              onPress={newListing}
            />
          }
        />
      </Rise>
      {isPending ? (
        <Rise index={1} style={styles.inset}>
          <PortfolioHeroSkeleton />
        </Rise>
      ) : listings.length > 0 ? (
        <>
          <Rise index={1} style={styles.inset}>
            <PortfolioHero
              listings={listings}
              enquiries={enquiries.stats}
              enquiriesPending={enquiries.pending}
              onOpenListing={openListing}
              onOpenChats={openChats}
            />
          </Rise>
          <View style={[styles.inset, styles.listHead]}>
            <Text variant="bodyStrong">Your listings</Text>
            <Text variant="captionStrong" tone="tertiary" style={styles.tabular}>
              {String(listings.length)}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );

  const empty = isPending ? (
    <View style={styles.skeletons}>
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </View>
  ) : isError ? (
    <StateView
      icon={CloudOff}
      tone="alert"
      title="Your listings could not load"
      body="Check your connection. Your listings are safe."
      actionLabel="Try again"
      onAction={() => refetch()}
    />
  ) : (
    <Rise index={1} style={styles.inset}>
      <PortfolioEmpty onList={newListing} />
    </Rise>
  );

  return (
    <>
      <MyLandList
        data={listings}
        keyExtractor={(l) => l.id}
        renderItem={renderItem}
        extraData={[enquiries.stats, maxViews]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        showsVerticalScrollIndicator={false}
        refreshing={pulling}
        onRefresh={async () => {
          setPulling(true);
          await refetch();
          setPulling(false);
        }}
        progressViewOffset={insets.top}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
      />
      <TopChrome scrollY={scrollY} compact={compact} title="My land" action={{ label: 'List land', onPress: newListing }} />
      <OptionSheet<ListingStatus>
        visible={!!statusFor}
        title="Listing status"
        options={STATUS_CHOICES.map((c) => ({ ...c, dot: STATUS_META[c.value].color }))}
        value={statusFor?.status ?? null}
        onSelect={(s) => {
          if (statusFor && s !== statusFor.status) setStatus(statusFor.id, s);
          setStatusFor(null);
        }}
        onClose={() => setStatusFor(null)}
      />
    </>
  );
}

// ── Buyers

function SavedLand() {
  const insets = useScreenInsets({ tabBar: true });
  const signedIn = useSession((s) => s.status === 'signedIn');
  const { isSaved, toggle, savedIds } = useSaved();
  const [pulling, setPulling] = useState(false);
  const { scrollY, onScroll, compact } = useCollapse();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: qk.savedListings,
    queryFn: fetchSavedListings,
    enabled: signedIn,
  });
  const listings = data ?? [];

  const renderItem = ({ item, index }: ListRenderItemInfo<ListingWithOwner>) => {
    const card = (
      <ListingCard
        listing={item}
        variant="compact"
        onPress={() => openListing(item.id)}
        saved={isSaved(item.id)}
        onToggleSave={() => toggle(item.id)}
      />
    );
    return <View style={styles.cell}>{index < 6 ? <Rise index={index + 1}>{card}</Rise> : card}</View>;
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Rise index={0}>
        <PageTitle
          scrollY={scrollY}
          title="Saved"
          subtitle={isPending ? 'Your shortlist' : `Your shortlist · ${listings.length}`}
        />
      </Rise>
      {listings.length > 0 ? (
        <Rise index={1} style={styles.inset}>
          <Text variant="caption" tone="secondary">
            Only you can see this list. Owners are not notified when you save their land.
          </Text>
        </Rise>
      ) : null}
    </View>
  );

  const empty = isPending ? (
    <View style={styles.skeletons}>
      <ListingCardSkeleton variant="compact" />
      <ListingCardSkeleton variant="compact" />
      <ListingCardSkeleton variant="compact" />
    </View>
  ) : isError ? (
    <StateView
      icon={CloudOff}
      tone="alert"
      title="Your shortlist could not load"
      body="Check your connection and try again."
      actionLabel="Try again"
      onAction={() => refetch()}
    />
  ) : (
    <StateView
      icon={Bookmark}
      title="Nothing saved yet"
      body="Tap the bookmark on any land opportunity in Explore to keep it here while you compare."
      actionLabel="Explore land"
      actionIcon={<Compass size={17} color={colors.ink} strokeWidth={2.2} />}
      onAction={() => router.navigate('/')}
    />
  );

  return (
    <>
      <SavedList
        data={listings}
        keyExtractor={(l) => l.id}
        renderItem={renderItem}
        extraData={savedIds}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        showsVerticalScrollIndicator={false}
        refreshing={pulling}
        onRefresh={async () => {
          setPulling(true);
          await refetch();
          setPulling(false);
        }}
        progressViewOffset={insets.top}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
      />
      <TopChrome scrollY={scrollY} compact={compact} title="Saved" />
    </>
  );
}

/** Role-based fourth tab: sellers and brokers manage land, buyers keep a shortlist. */
export default function LandScreen() {
  const role = useSession((s) => s.profile?.role);
  return <Screen>{canManageListings(role) ? <MyLand /> : <SavedLand />}</Screen>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  header: { gap: space[5], paddingBottom: space[4] },
  inset: { paddingHorizontal: gutter },
  cell: { paddingHorizontal: gutter, paddingBottom: space[3] },
  skeletons: { paddingHorizontal: gutter, gap: space[3] },
  listHead: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: space[1], marginBottom: -space[2] },

  fade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: { position: 'absolute', left: 0, right: 0, justifyContent: 'center', paddingHorizontal: gutter },
  barTitle: { alignItems: 'center', paddingHorizontal: space[12] },
  barAction: { position: 'absolute', right: gutter },
  pageTitle: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: gutter, minHeight: 56 },

  row: {
    padding: ROW_PAD,
    gap: 6,
    borderRadius: ROW_RADIUS,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: withAlpha(INK, 0.05),
    backgroundColor: colors.surface,
    boxShadow: '0 8px 24px rgba(16,32,28,0.06)',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  pano: {
    position: 'absolute',
    left: space[1],
    bottom: space[1],
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.ink, 0.56),
  },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: INK },
  rowPlace: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: withAlpha(INK, 0.55) },
  rowPrice: { marginTop: 2, fontFamily: font.bold, fontSize: 19, lineHeight: 24, letterSpacing: -0.4, color: INK, fontVariant: ['tabular-nums'] },
  rowUnit: { fontFamily: font.semibold, fontSize: 13, letterSpacing: 0, color: withAlpha(INK, 0.45) },
  rowArea: { fontFamily: font.medium, fontSize: 13, letterSpacing: 0, color: withAlpha(INK, 0.45) },
  skeletonBody: { gap: space[2] },
  rowFooter: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingLeft: 2, minHeight: 44 },
  pill: { height: 26, borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 10 },
  pillFill: { borderRadius: radius.pill },
  pillContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillText: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statDisc: { width: STAT_D, height: STAT_D, borderRadius: STAT_D / 2, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18, color: INK, fontVariant: ['tabular-nums'] },
  viewsTrack: {
    width: VIEW_BAR_W,
    height: 4,
    marginLeft: 2,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: withAlpha(INK, 0.06),
  },
  viewsFill: { flex: 1, borderRadius: 2, backgroundColor: palette.mint, transformOrigin: 'left' },
  rowActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  action: { backgroundColor: withAlpha(INK, 0.05) },
  actionGo: { backgroundColor: withAlpha(palette.green, 0.1) },
});
