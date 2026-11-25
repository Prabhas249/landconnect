import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ChevronDown, CloudOff, Plus, Search, SearchX, SlidersHorizontal, X } from 'lucide-react-native';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { qk } from '@/data/keys';
import { fetchListings, LISTINGS_LIMIT } from '@/data/listings';
import { LAND_TYPES, ROLE_COPY, type LandType, type ListingFilters, type ListingWithOwner, type Profile } from '@/lib/types';
import { canManageListings, useSession } from '@/stores/session';
import { colors, duration, font, gutter, radius, shadow, space, spring, TAB_BAR_HEIGHT, type } from '@/theme/tokens';
import { AVATAR_SIZE, Avatar } from '@/ui/avatar';
import { Chip } from '@/ui/chip';
import { useClampedScroll } from '@/ui/clamped-scroll';
import { Enter } from '@/ui/enter';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';

import { ListingCard, ListingCardSkeleton } from './listing-card';
import { MarketSnapshot } from './market-snapshot';
import { LAND_TINT, withAlpha } from './meta';
import { photoUrl } from './media/image-variants';
import { prefetchNow } from './media/photo-cache';
import { OptionSheet, type SheetOption } from './option-sheet';
import { pulseOf } from './snapshot/pulse-model';
import { StateView } from './state-view';
import { useDebounced } from './use-debounced';
import { useSaved } from './use-saved';

type Sort = NonNullable<ListingFilters['sort']>;
type TypeFilter = LandType | 'all';

const NO_LISTINGS: ListingWithOwner[] = [];

const TITLE = 'Land opportunities';

const SORTS: readonly SheetOption<Sort>[] = [
  { value: 'newest', label: 'Newest first', hint: 'Recently listed land at the top' },
  { value: 'price_low', label: 'Price: low to high', hint: 'Smallest asking price first' },
  { value: 'price_high', label: 'Price: high to low', hint: 'Largest asking price first' },
  { value: 'area', label: 'Largest area', hint: 'Converted to acres before comparing' },
];

/** Scroll offsets (dp) where the large header hands over to the compact bar. */
const FADE_OUT: [number, number] = [0, 72];
const COMPACT_IN: [number, number] = [64, 104];
const COMPACT_H = 56;
const FADE_H = space[5];

const AnimatedList = Animated.createAnimatedComponent(FlashList<ListingWithOwner>);

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

type SearchProps = {
  inputRef: RefObject<TextInputInstance | null>;
  value: string;
  onChange: (q: string) => void;
  sort: Sort;
  onOpenSort: () => void;
};

/** White search pill with the sort control folded into its trailing edge. */
function SearchField({ inputRef, value, onChange, sort, onOpenSort }: SearchProps) {
  const [focused, setFocused] = useState(false);
  const ring = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: duration.fast }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }));
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? 'Newest first';

  return (
    <View style={styles.search}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.searchRing, ringStyle]} />
      <Search size={18} color={focused ? colors.accent : colors.inkTertiary} strokeWidth={2.1} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder="Search by district, taluk or village"
        placeholderTextColor={colors.inkTertiary}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        allowFontScaling={false}
        returnKeyType="search"
        autoCorrect={false}
        numberOfLines={1}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.searchInput}
      />
      {value ? (
        <PressableScale haptic="selection" onPress={() => onChange('')} accessibilityLabel="Clear search" style={styles.clear}>
          <X size={12} color={colors.inkOnDark} strokeWidth={2.8} />
        </PressableScale>
      ) : null}
      <View style={styles.searchRule} />
      <PressableScale
        haptic="selection"
        to={0.9}
        onPress={onOpenSort}
        accessibilityLabel={`Sort: ${sortLabel}. Change sort order`}
        style={styles.sortButton}>
        <SlidersHorizontal size={18} color={colors.ink} strokeWidth={2.1} />
        {sort !== 'newest' ? <View style={styles.sortDot} /> : null}
      </PressableScale>
    </View>
  );
}

type HeaderProps = {
  profile: Profile | null;
  query: string;
  onQuery: (q: string) => void;
  landType: TypeFilter;
  /** The land type the shown listings belong to (lags `landType` while a server query loads). */
  shownType: TypeFilter;
  onLandType: (t: TypeFilter) => void;
  sort: Sort;
  onOpenSort: () => void;
  /** What the feed shows (the hero summarises the same list). */
  listings: ListingWithOwner[];
  /** What the feed shows. */
  shown: number;
  loading: boolean;
  topInset: number;
  scrollY: SharedValue<number>;
  inputRef: RefObject<TextInputInstance | null>;
};

/**
 * Module-level component so the search field keeps focus while the list re-renders around it.
 * Memoised: scroll-threshold and sheet state changes on the screen leave the header (and the
 * market pulse card inside it) alone.
 */
const ExploreHeader = memo(function ExploreHeader({
  profile,
  query,
  onQuery,
  landType,
  shownType,
  onLandType,
  sort,
  onOpenSort,
  listings,
  shown,
  loading,
  topInset,
  scrollY,
  inputRef,
}: HeaderProps) {
  const first = profile?.display_name.trim().split(/\s+/)[0] ?? '';
  const role = profile?.role;
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? 'Newest first';

  // The greeting and title fade as they scroll under the compact bar, so the two never overlap.
  const fadeY = useClampedScroll(scrollY, FADE_OUT[0], FADE_OUT[1]);
  const recede = useAnimatedStyle(() => ({
    opacity: interpolate(fadeY.get(), FADE_OUT, [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(fadeY.get(), FADE_OUT, [0, -space[2]], 'clamp') }],
  }));

  return (
    <View style={[styles.header, { paddingTop: topInset }]}>
      <Animated.View style={[styles.intro, recede]}>
        <Enter index={0} style={styles.greetRow}>
          <PressableScale
            haptic="selection"
            to={0.94}
            onPress={() => router.navigate('/profile')}
            accessibilityLabel="Open your profile"
            style={styles.greetPress}>
            <Avatar profile={profile} size={AVATAR_SIZE.md} verified={!!profile?.verified} onColor={colors.canvas} />
            <View style={styles.flex}>
              {first ? (
                <>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {greeting()}
                  </Text>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {first}
                  </Text>
                </>
              ) : (
                <Text variant="bodyStrong" numberOfLines={1}>
                  {greeting()}
                </Text>
              )}
            </View>
          </PressableScale>
          {role ? <Chip label={ROLE_COPY[role].label} tone={role === 'buyer' ? 'accent' : 'highlight'} mono /> : null}
        </Enter>

        <Enter index={1} style={styles.titleBlock}>
          <Text variant="title">{TITLE}</Text>
          <Text variant="body" tone="secondary">
            Across Bengaluru and Karnataka
          </Text>
        </Enter>
      </Animated.View>

      <Enter index={2}>
        <SearchField inputRef={inputRef} value={query} onChange={onQuery} sort={sort} onOpenSort={onOpenSort} />
      </Enter>

      <Enter index={3}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}>
          <Chip label="All land" tone="surface" selected={landType === 'all'} onPress={() => onLandType('all')} />
          {LAND_TYPES.map((t) => (
            <Chip
              key={t.value}
              label={t.label}
              selected={landType === t.value}
              tone="surface"
              onPress={() => onLandType(landType === t.value ? 'all' : t.value)}
              leading={<View style={[styles.dot, { backgroundColor: landType === t.value ? colors.inkOnDark : LAND_TINT[t.value].base }]} />}
            />
          ))}
        </ScrollView>
      </Enter>

      <Enter index={4}>
        <MarketSnapshot
          listings={listings}
          loading={loading}
          activeType={shownType}
          onSelectType={(t) => onLandType(landType === t ? 'all' : t)}
          scrollY={scrollY}
        />
      </Enter>

      <View style={styles.listHead}>
        <Label>{loading ? 'Loading land' : `${shown} ${shown === 1 ? 'opportunity' : 'opportunities'}`}</Label>
        <PressableScale haptic="selection" onPress={onOpenSort} style={styles.sortLink} accessibilityLabel="Change sort order">
          <Text variant="captionStrong" tone="secondary">
            {sortLabel}
          </Text>
          <ChevronDown size={14} color={colors.inkTertiary} strokeWidth={2.2} />
        </PressableScale>
      </View>
    </View>
  );
});

type FeedRowProps = {
  item: ListingWithOwner;
  index: number;
  saved: boolean;
  onOpen: (id: string) => void;
  onToggleSave?: (id: string) => void;
};

/** One feed cell. Memoised on stable props, so re-renders around the list skip unchanged rows. */
const FeedRow = memo(function FeedRow({ item, index, saved, onOpen, onToggleSave }: FeedRowProps) {
  const card = (
    <ListingCard
      listing={item}
      onPress={() => onOpen(item.id)}
      saved={saved}
      onToggleSave={onToggleSave ? () => onToggleSave(item.id) : undefined}
    />
  );
  // Only the first screenful staggers in, and only while the feed first opens. The wrapper is
  // always there, so a recycled cell crossing index 6 never remounts (and never replays the rise).
  return (
    <View style={styles.cell}>
      <Enter index={index + 2} disabled={index >= 6 || !feedOpening()}>
        {card}
      </Enter>
    </View>
  );
});

/** True during the feed's first moments, when the opening stagger may play. */
let feedOpenedAt = 0;
function feedOpening() {
  const now = Date.now();
  if (!feedOpenedAt) feedOpenedAt = now;
  return now - feedOpenedAt < 1500;
}

/**
 * The feed's data. Land type is filtered on the device whenever the unfiltered result for the
 * same search and sort is complete (under the query limit), so a type chip answers in the same
 * frame instead of after a network round trip. Larger sets fall back to a server query per type.
 */
function useExploreListings(query: string | undefined, landType: TypeFilter, sort: Sort) {
  const baseFilters: ListingFilters = { query, landType: 'all', sort };
  const base = useQuery({
    queryKey: qk.listings(baseFilters),
    queryFn: () => fetchListings(baseFilters),
    placeholderData: keepPreviousData,
  });
  const complete = !!base.data && base.data.length < LISTINGS_LIMIT;
  const local = landType === 'all' || complete;

  const typedFilters: ListingFilters = { query, landType, sort };
  const typed = useQuery({
    queryKey: qk.listings(typedFilters),
    queryFn: () => fetchListings(typedFilters),
    placeholderData: keepPreviousData,
    enabled: !local,
  });

  const listings = useMemo(() => {
    if (landType === 'all') return base.data ?? NO_LISTINGS;
    if (complete) return base.data!.filter((l) => l.land_type === landType);
    return typed.data ?? NO_LISTINGS;
  }, [landType, complete, base.data, typed.data]);

  // The land type the shown rows belong to: while a server-filtered query is still loading, the
  // previous rows (and their type) stay up, so the pulse card never pairs new copy with old figures.
  const settled = local || !typed.isPlaceholderData;
  const [shownType, setShownType] = useState(landType);
  if (settled && shownType !== landType) setShownType(landType);

  // Warm the photo callouts each type chip will raise, so a swap never waits on a download.
  const baseData = base.data;
  useEffect(() => {
    if (!complete || !baseData) return;
    const t = setTimeout(() => {
      const urls: string[] = [];
      for (const { value } of LAND_TYPES) {
        for (const r of pulseOf(baseData.filter((l) => l.land_type === value)).featured) {
          if (r.photo) urls.push(photoUrl(r.photo, 'thumb'));
        }
      }
      prefetchNow(urls);
    }, 1200);
    return () => clearTimeout(t);
  }, [complete, baseData]);

  const active = local ? base : typed;
  const refetch = () => Promise.all([base.refetch(), local ? null : typed.refetch()]);
  return { listings, shownType, isPending: active.isPending, isError: active.isError, refetch };
}

/**
 * The floating "List land" action. It presses in, then shrinks and fades as the editor slides up
 * over it, and settles back when Explore regains focus, so the hand-off reads as one motion.
 */
function ListLandButton({ bottom }: { bottom: number }) {
  const launch = useSharedValue(0);
  const launching = useRef(false);

  useFocusEffect(
    useCallback(() => {
      launching.current = false;
      launch.set(withSpring(0, spring.gentle));
    }, [launch]),
  );

  const style = useAnimatedStyle(() => ({
    opacity: 1 - launch.get(),
    transform: [{ scale: 1 - launch.get() * 0.12 }, { translateY: launch.get() * space[3] }],
  }));

  const open = () => {
    if (launching.current) return;
    launching.current = true;
    launch.set(withTiming(1, { duration: duration.base, easing: Easing.out(Easing.cubic) }));
    router.push('/listing/edit');
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(360).springify().damping(24).stiffness(200).mass(0.9)}
      style={[styles.fab, { bottom }]}>
      <Animated.View style={style}>
        <PressableScale to={0.94} haptic="medium" onPress={open} accessibilityLabel="List land" style={styles.fabButton}>
          <Plus size={18} color={colors.inkOnDark} strokeWidth={2.4} />
          <Text variant="bodyStrong" tone="onDark">
            List land
          </Text>
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

export default function ExploreScreen() {
  const insets = useScreenInsets({ tabBar: true });
  const profile = useSession((s) => s.profile);
  const manages = canManageListings(profile?.role);
  const isBuyer = profile?.role === 'buyer';
  const { isSaved, toggle, savedIds } = useSaved();

  const [query, setQuery] = useState('');
  const [landType, setLandType] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [compact, setCompact] = useState(false);
  const listRef = useRef<FlashListRef<ListingWithOwner>>(null);
  const inputRef = useRef<TextInputInstance>(null);

  const debounced = useDebounced(query.trim(), 320);
  const { listings, shownType, isPending, isError, refetch } = useExploreListings(debounced || undefined, landType, sort);
  // The pulse card answers a chip at once; the feed below follows in a deferred render, so its
  // cell mounts never hold up the frame that starts the card's transition.
  const feed = useDeferredValue(listings);
  const filtered = landType !== 'all' || !!debounced;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });
  // Only the threshold crossing reaches JS, to switch whether the invisible bar can take touches.
  useAnimatedReaction(
    () => scrollY.get() > COMPACT_IN[0] + (COMPACT_IN[1] - COMPACT_IN[0]) / 2,
    (now, before) => {
      if (now !== before) scheduleOnRN(setCompact, now);
    },
  );
  const barY = useClampedScroll(scrollY, COMPACT_IN[0], COMPACT_IN[1]);
  const compactBar = useAnimatedStyle(() => ({
    opacity: interpolate(barY.get(), COMPACT_IN, [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(barY.get(), COMPACT_IN, [-space[2], 0], 'clamp') }],
  }));

  // At rest the fade would wash over the avatar, so it only appears once content moves.
  const veilY = useClampedScroll(scrollY, 0, space[6]);
  const veilFade = useAnimatedStyle(() => ({ opacity: interpolate(veilY.get(), [0, space[6]], [0, 1], 'clamp') }));

  const clearFilters = () => {
    setQuery('');
    setLandType('all');
  };

  const focusSearch = () => {
    listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    setTimeout(() => inputRef.current?.focus(), duration.slow);
  };

  const openSort = useCallback(() => setSortOpen(true), []);

  // `useSaved` hands back fresh functions each render; rows read them through refs so their
  // callbacks stay stable and only a row whose saved state flips re-renders.
  const saved = useRef({ isSaved, toggle });
  saved.current = { isSaved, toggle };
  const toggleSaved = useCallback((id: string) => saved.current.toggle(id), []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ListingWithOwner>) =>
      // FlashList can briefly ask for an index past the end while the deferred feed swaps.
      item ? (
      <FeedRow
        item={item}
        index={index}
        saved={saved.current.isSaved(item.id)}
        onOpen={openListing}
        onToggleSave={isBuyer ? toggleSaved : undefined}
      />
      ) : null,
    [isBuyer, toggleSaved],
  );

  const empty = isPending ? (
    <View style={styles.skeletons}>
      <ListingCardSkeleton />
      <ListingCardSkeleton />
    </View>
  ) : isError ? (
    <StateView
      icon={CloudOff}
      tone="alert"
      title="Land opportunities could not load"
      body="Check your connection. Nothing you saved has been lost."
      actionLabel="Try again"
      onAction={() => refetch()}
    />
  ) : (
    <StateView
      icon={SearchX}
      title={filtered ? 'No land matches yet' : 'No land listed yet'}
      body={
        filtered
          ? 'Try a nearby taluk or a different land type. New land is added through the week.'
          : 'Verified sellers and brokers are preparing their listings. Check back shortly.'
      }
      actionLabel={filtered ? 'Clear filters' : undefined}
      onAction={filtered ? clearFilters : undefined}
    />
  );

  return (
    <Screen>
      <AnimatedList
        ref={listRef}
        data={feed}
        drawDistance={700}
        keyExtractor={(l, i) => l?.id ?? `gap-${i}`}
        renderItem={renderItem}
        extraData={isBuyer ? savedIds : null}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshing={pulling}
        onRefresh={async () => {
          setPulling(true);
          await refetch();
          setPulling(false);
        }}
        progressViewOffset={insets.top}
        ListHeaderComponent={
          <ExploreHeader
            profile={profile}
            query={query}
            onQuery={setQuery}
            landType={landType}
            shownType={shownType}
            onLandType={setLandType}
            sort={sort}
            onOpenSort={openSort}
            listings={listings}
            shown={listings.length}
            loading={isPending}
            topInset={insets.top}
            scrollY={scrollY}
            inputRef={inputRef}
          />
        }
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: insets.bottom + (manages ? space[16] : 0) }}
      />

      {/* Status-bar veil: content scrolling up dissolves into the canvas instead of running under the clock. */}
      <View pointerEvents="none" style={[styles.veil, { height: insets.raw.top }]}>
        <Animated.View style={[styles.fade, { top: insets.raw.top }, veilFade]}>
          <LinearGradient colors={[colors.canvas, withAlpha(colors.canvas, 0)]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>

      {/* Compact bar takes over once the large title scrolls away. */}
      <Animated.View
        pointerEvents={compact ? 'box-none' : 'none'}
        style={[styles.compactBar, { paddingTop: insets.raw.top, height: insets.raw.top + COMPACT_H }, compactBar]}>
        <View style={styles.compactRow}>
          <Text variant="heading" numberOfLines={1} style={styles.flex}>
            {TITLE}
          </Text>
          <IconButton label="Search land" size={40} onPress={focusSearch}>
            <Search size={18} color={colors.ink} strokeWidth={2.1} />
          </IconButton>
          <IconButton label="Change sort order" size={40} onPress={() => setSortOpen(true)}>
            <SlidersHorizontal size={18} color={colors.ink} strokeWidth={2.1} />
            {sort !== 'newest' ? <View style={styles.sortDotCompact} /> : null}
          </IconButton>
        </View>
        <LinearGradient
          pointerEvents="none"
          colors={[colors.canvas, withAlpha(colors.canvas, 0)]}
          style={[styles.fade, { top: insets.raw.top + COMPACT_H }]}
        />
      </Animated.View>

      {manages ? <ListLandButton bottom={Math.max(insets.raw.bottom, space[3]) + TAB_BAR_HEIGHT + space[4]} /> : null}

      <OptionSheet
        visible={sortOpen}
        title="Sort by"
        options={SORTS}
        value={sort}
        onSelect={(v) => {
          setSort(v);
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
      />
    </Screen>
  );
}

const SEARCH_H = 52;
const SORT_SIZE = 40;

const openListing = (id: string) => router.push({ pathname: '/listing/[id]', params: { id } });

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: gutter, gap: space[5], paddingBottom: space[4] },
  intro: { gap: space[5] },
  greetRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  greetPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  titleBlock: { gap: space[1] },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: SEARCH_H,
    paddingLeft: space[4],
    paddingRight: (SEARCH_H - SORT_SIZE) / 2,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  searchRing: { borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.accentBright },
  searchInput: {
    flex: 1,
    height: SEARCH_H,
    fontFamily: font.medium,
    fontSize: type.body.fontSize,
    letterSpacing: type.body.letterSpacing,
    color: colors.ink,
    paddingVertical: 0,
  },
  clear: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.inkTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRule: { width: StyleSheet.hairlineWidth * 2, height: space[6], backgroundColor: colors.hairlineStrong },
  sortButton: {
    width: SORT_SIZE,
    height: SORT_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  sortDot: {
    position: 'absolute',
    top: space[2],
    right: space[2],
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.surfaceMuted,
  },
  sortDotCompact: {
    position: 'absolute',
    top: space[2],
    right: space[2],
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  chipsScroll: { marginHorizontal: -gutter },
  chips: { paddingHorizontal: gutter, gap: space[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -space[1] },
  sortLink: { flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: 44, paddingLeft: space[3] },
  cell: { paddingHorizontal: gutter, paddingBottom: space[4] },
  skeletons: { paddingHorizontal: gutter, gap: space[4] },
  veil: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.canvas },
  fade: { position: 'absolute', left: 0, right: 0, height: FADE_H },
  compactBar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.canvas },
  compactRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: gutter },
  fab: { position: 'absolute', right: gutter },
  fabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 52,
    paddingLeft: space[5],
    paddingRight: space[6],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.accent,
    boxShadow: shadow.accent,
  },
});
