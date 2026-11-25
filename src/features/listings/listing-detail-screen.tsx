import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  MapPin,
  MapPinOff,
  MessageCircle,
  PenLine,
  Phone,
  Share2,
  Video,
} from "lucide-react-native";
import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Alert,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { openDirectConversation } from "@/data/chat";
import { qk } from "@/data/keys";
import { fetchListing, recordListingView } from "@/data/listings";
import { placeCall } from "@/features/calls/actions";
import { formatAgo, formatPrice, formatRate } from "@/lib/format";
import { errorMessage } from "@/lib/supabase";
import type { CallKind, ListingStatus, ListingWithOwner } from "@/lib/types";
import { useSession } from "@/stores/session";
import { colors, gutter, radius, shadow, space } from "@/theme/tokens";
import { useClampedScroll } from "@/ui/clamped-scroll";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { IconButton } from "@/ui/icon-button";
import { Screen } from "@/ui/screen";
import { Segmented } from "@/ui/segmented";
import { useAfterOpen } from "@/ui/use-after-open";
import { Label, Text } from "@/ui/text";

import { AreaConverter } from "./area-converter";
import {
  DocumentsCard,
  LocationCard,
  OwnerCard,
  ParcelCard,
  StatRow,
} from "./detail-sections";
import { PriceFigure } from "./listing-card";
import { ScrollYProvider } from "./in-view";
import { HeroGallery } from "./media/hero-gallery";
import type { OriginRect } from "./media/overlay";
import { PhotoViewer, type ViewerOrigin } from "./media/photo-viewer";
import { PanoramaCard } from "./panorama/panorama-card";
import { PanoramaViewer } from "./panorama/panorama-viewer";
import { STATUS_META, landTypeLabel } from "./meta";
import { SaveButton } from "./save-button";
import { SkeletonBlock } from "./skeleton";
import { StateView } from "./state-view";
import { useListingMutations } from "./use-listing-mutations";
import { useSaved } from "./use-saved";

const SHEET_OVERLAP = radius.xxl;

/**
 * Open choreography, alongside the native push (~280 ms): chips, title, place, price and stats rise 8pt and fade in 40 ms apart on an ease-out
 * with no overshoot. Heavy sections mount after the push ends and use the same rise. Reduced
 * motion skips all of it (the builders' default ReduceMotion.System).
 */
const RISE_MS = 280;
const RISE_STEP = 40;
const RISE_MAX = 6;
const riseEase = Easing.bezier(0.2, 0.8, 0.2, 1);
const rises = new Map<number, FadeInDown>();
function rise(index: number) {
  const step = Math.min(Math.max(0, index), RISE_MAX);
  let b = rises.get(step);
  if (!b) {
    b = FadeInDown.duration(RISE_MS)
      .delay(step * RISE_STEP)
      .easing(riseEase)
      .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
    rises.set(step, b);
  }
  return b;
}
function Rise({
  index,
  style,
  children,
}: {
  index: number;
  style?: ComponentProps<typeof Animated.View>["style"];
  children: ReactNode;
}) {
  return (
    <Animated.View entering={rise(index)} style={style}>
      {children}
    </Animated.View>
  );
}
/** Approximate heights of the sections mounted after the transition, to keep the scroll steady. */
const DEFERRED_HEIGHT = { panorama: 256, parcel: 452, location: 360 } as const;
const OWNER_STATUSES: readonly { value: ListingStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "under_offer", label: "Under offer" },
  { value: "sold", label: "Sold" },
];

/** Upper bound on waiting for the push animation before mounting the heavy sections anyway. */

/** The listing as the feed / Saved already has it, so the screen renders on the first frame. */
function cachedListing(
  qc: QueryClient,
  id: string | undefined,
): ListingWithOwner | undefined {
  if (!id) return undefined;
  for (const queryKey of [["listings"], qk.savedListings]) {
    for (const [, data] of qc.getQueriesData<ListingWithOwner[]>({
      queryKey,
    })) {
      const hit = Array.isArray(data)
        ? data.find((l) => l.id === id)
        : undefined;
      if (hit) return hit;
    }
  }
  return undefined;
}

function DetailSkeleton({ heroHeight }: { heroHeight: number }) {
  return (
    <View>
      <SkeletonBlock height={heroHeight} r={0} />
      <View style={[styles.sheet, styles.sheetBody]}>
        <SkeletonBlock width="72%" height={28} />
        <SkeletonBlock width="44%" height={16} />
        <SkeletonBlock
          width="38%"
          height={32}
          style={{ marginTop: space[2] }}
        />
        <SkeletonBlock
          height={84}
          r={radius.xl}
          style={{ marginTop: space[2] }}
        />
        <SkeletonBlock height={260} r={radius.xl} />
      </View>
    </View>
  );
}

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useSession((s) => s.userId);
  const role = useSession((s) => s.profile?.role);
  const { isSaved, toggle } = useSaved();
  const { setStatus } = useListingMutations();

  const heroHeight = Math.round(Math.min(width * 1.05, 460));
  const [barHeight, setBarHeight] = useState(96);
  const [busy, setBusy] = useState<null | "message" | CallKind>(null);
  const [photo, setPhoto] = useState<{
    index: number;
    origin: ViewerOrigin | null;
  } | null>(null);
  const [pano, setPano] = useState<{
    origin: OriginRect | null;
    yaw: number;
  } | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  const {
    data: listing,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: qk.listing(id ?? ""),
    queryFn: () => fetchListing(id!),
    enabled: !!id,
    // Seeded from the list the user tapped in; marked stale so it still refreshes in the background.
    initialData: () => cachedListing(qc, id),
    initialDataUpdatedAt: 0,
  });
  const settled = useAfterOpen();
  // After the push lands, mount the rest in three small batches instead of one big frame:
  // 1 = 360° + parcel plan, 2 = area, about, features, documents, 3 = map + owner.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!settled) return;
    setStage(1);
    const a = setTimeout(() => setStage(2), 140);
    const b = setTimeout(() => setStage(3), 300);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [settled]);

  useEffect(() => {
    if (id) recordListingView(id).catch(() => {});
  }, [id]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.set(e.contentOffset.y);
    },
  });
  // Pull-down stretches the hero from its top edge; scrolling up drifts it at half speed.
  // Past twice its height the half-speed hero is off screen, so its style stops re-running there.
  const heroY = useClampedScroll(scrollY, -heroHeight, heroHeight * 2);
  const heroStyle = useAnimatedStyle(() => {
    const y = heroY.get();
    return {
      transform: [
        { translateY: y < 0 ? y / 2 : y * 0.5 },
        { scale: y < 0 ? 1 - y / heroHeight : 1 },
      ],
    };
  });
  const fadeStart = heroHeight - insets.top - 140;
  const topBar = useAnimatedStyle(() => ({
    opacity: interpolate(
      heroY.get(),
      [fadeStart, fadeStart + 60],
      [0, 1],
      "clamp",
    ),
  }));

  const isOwner = !!listing && listing.owner_id === me;
  const showSave = !!listing && !isOwner && role === "buyer";

  // The hero is full-bleed at the top and drifts at half speed, so its window rect follows from
  // the scroll offset; the sheet covers its bottom edge, which the open transition clips away.
  function openPhoto(index: number) {
    const y = Math.max(0, scrollY.get());
    const top = -y * 0.5;
    const visibleBottom = Math.min(
      top + heroHeight,
      heroHeight - SHEET_OVERLAP - y,
    );
    const clipTop = Math.max(0, top);
    const origin =
      visibleBottom - clipTop > 24
        ? {
            image: { x: 0, y: top, width, height: heroHeight },
            clip: { x: 0, y: clipTop, width, height: visibleBottom - clipTop },
          }
        : null;
    setPhoto({ index, origin });
  }

  async function contact(kind: "message" | CallKind) {
    if (!listing || busy) return;
    setBusy(kind);
    try {
      const conversationId = await openDirectConversation(
        listing.owner_id,
        listing.id,
      );
      qc.invalidateQueries({ queryKey: qk.conversations });
      if (kind === "message")
        router.push({ pathname: "/chat/[id]", params: { id: conversationId } });
      else await placeCall(conversationId, kind);
    } catch (e) {
      Alert.alert("Could not reach the owner", errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function share() {
    if (!listing) return;
    Share.share({
      message: `${listing.title} — ${listing.locality}, ${listing.district}. ${formatPrice(listing.price_total)} on LandConnect.`,
    });
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (!id || (!isPending && !listing)) {
    return (
      <Screen style={{ paddingTop: insets.top + space[2] }}>
        <View style={styles.headerRow}>
          <IconButton label="Back" onPress={back}>
            <ChevronLeft size={22} color={colors.ink} strokeWidth={2.2} />
          </IconButton>
        </View>
        <View style={styles.centerState}>
          {isError ? (
            <StateView
              icon={MapPinOff}
              tone="alert"
              title="This listing could not load"
              body="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => refetch()}
            />
          ) : (
            <StateView
              icon={MapPinOff}
              title="Listing not available"
              body="The owner may have removed it or made it private. Other parcels nearby are still on Explore."
              actionLabel="Back to Explore"
              onAction={() => router.replace("/")}
            />
          )}
        </View>
      </Screen>
    );
  }

  const status = listing ? STATUS_META[listing.status] : null;
  const allowCalls = listing?.owner?.allow_calls !== "nobody";

  return (
    <Screen>
      {!listing ? (
        <DetailSkeleton heroHeight={heroHeight} />
      ) : (
        <ScrollYProvider value={scrollY}>
          <Animated.ScrollView
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: barHeight + space[6] }}
          >
            <Animated.View style={[{ height: heroHeight }, heroStyle]}>
              <View style={styles.flex}>
                <HeroGallery
                  listing={listing}
                  width={width}
                  height={heroHeight}
                  overlap={SHEET_OVERLAP}
                  syncIndex={heroIndex}
                  onOpenPhoto={openPhoto}
                  onOpenPanorama={() => setPano({ origin: null, yaw: 0 })}
                  settled={settled}
                />
              </View>
            </Animated.View>

            <View style={[styles.sheet, styles.sheetBody]}>
              <View style={styles.titleBlock}>
                <Rise index={0}>
                  <View style={styles.chipRow}>
                    {status ? (
                      <Chip label={status.label} tone={status.tone} mono />
                    ) : null}
                    <Chip label={landTypeLabel(listing.land_type)} mono />
                    {listing.verified ? (
                      <Chip
                        label="Verified"
                        tone="accent"
                        mono
                        leading={
                          <BadgeCheck
                            size={12}
                            color={colors.accent}
                            strokeWidth={2.4}
                          />
                        }
                      />
                    ) : null}
                  </View>
                </Rise>
                <Rise index={1}>
                  <Text variant="title" numberOfLines={3}>
                    {listing.title}
                  </Text>
                </Rise>
                <Rise index={2}>
                  <View style={styles.place}>
                    <MapPin
                      size={15}
                      color={colors.inkTertiary}
                      strokeWidth={2.1}
                    />
                    <Text
                      variant="caption"
                      tone="secondary"
                      style={styles.flex}
                      numberOfLines={1}
                    >
                      {`${listing.locality}, ${listing.district} · listed ${formatAgo(listing.created_at)}`}
                    </Text>
                  </View>
                </Rise>
              </View>

              <Rise index={3} style={styles.priceRow}>
                <View style={styles.flexShrink}>
                  <PriceFigure inr={listing.price_total} size="large" />
                  <Label numberOfLines={1}>
                    {formatRate(
                      listing.price_total,
                      listing.area_value,
                      listing.area_unit,
                    )}
                  </Label>
                </View>
                <Chip
                  label={listing.negotiable ? "Negotiable" : "Fixed price"}
                  tone={listing.negotiable ? "accent" : "neutral"}
                />
              </Rise>

              <Rise index={4}>
                <StatRow listing={listing} />
              </Rise>
              {listing.panorama_url ? (
                settled ? (
                  <Rise index={0}>
                    <PanoramaCard
                      url={listing.panorama_url}
                      width={width - gutter * 2}
                      scrollY={scrollY}
                      paused={!!photo || !!pano}
                      onOpen={(origin, yaw) => setPano({ origin, yaw })}
                    />
                  </Rise>
                ) : (
                  <SkeletonBlock
                    height={DEFERRED_HEIGHT.panorama}
                    r={radius.xl}
                  />
                )
              ) : null}
              {settled ? (
                <Rise index={1}>
                  <ParcelCard listing={listing} width={width - gutter * 2} />
                </Rise>
              ) : (
                <SkeletonBlock height={DEFERRED_HEIGHT.parcel} r={radius.xl} />
              )}
              {stage >= 2 ? (
              <>
              <Rise index={0}>
                <AreaConverter
                  value={listing.area_value}
                  unit={listing.area_unit}
                />
              </Rise>

              {listing.description.trim() ? (
                <Rise index={0} style={styles.section}>
                  <Label>About this land</Label>
                  <Text variant="body" tone="secondary">
                    {listing.description.trim()}
                  </Text>
                </Rise>
              ) : null}

              {listing.features.length > 0 ? (
                <Rise index={1} style={styles.section}>
                  <Label>Features</Label>
                  <View style={styles.features}>
                    {listing.features.map((f) => (
                      <Chip
                        key={f}
                        label={f}
                        tone="surface"
                        leading={
                          <Check
                            size={14}
                            color={colors.accent}
                            strokeWidth={2.4}
                          />
                        }
                      />
                    ))}
                  </View>
                </Rise>
              ) : null}

              <Rise index={1}>
                <DocumentsCard
                  documents={listing.documents}
                  verified={listing.verified}
                  onRequest={isOwner ? undefined : () => contact("message")}
                />
              </Rise>
              </>
              ) : null}
              {stage >= 3 ? (
                <Rise index={2}>
                  <LocationCard listing={listing} isOwner={isOwner} />
                </Rise>
              ) : (
                <SkeletonBlock
                  height={DEFERRED_HEIGHT.location}
                  r={radius.xl}
                />
              )}
              {stage >= 3 && listing.owner && !isOwner ? (
                <Rise index={1} style={styles.section}>
                  <Label>Listed by</Label>
                  <OwnerCard listing={listing} />
                </Rise>
              ) : null}
            </View>
          </Animated.ScrollView>
        </ScrollYProvider>
      )}

      {/* Solid bar fades in as the hero leaves, so the floating buttons stay legible on the canvas. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.topBar, { height: insets.top + 60 }, topBar]}
      >
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          style={[styles.topTitle, { marginTop: insets.top }]}
        >
          {listing?.title ?? ""}
        </Text>
      </Animated.View>

      <View
        style={[styles.floating, { top: insets.top + space[2] }]}
        pointerEvents="box-none"
      >
        <IconButton label="Back" onPress={back}>
          <ChevronLeft size={22} color={colors.ink} strokeWidth={2.2} />
        </IconButton>
        <View style={styles.floatingEnd}>
          {showSave && listing ? (
            <SaveButton
              saved={isSaved(listing.id)}
              onToggle={() => toggle(listing.id)}
            />
          ) : null}
          {listing ? (
            <IconButton label="Share listing" onPress={share}>
              <Share2 size={19} color={colors.ink} strokeWidth={2.1} />
            </IconButton>
          ) : null}
        </View>
      </View>

      {listing ? (
        <View
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          style={[
            styles.bar,
            { paddingBottom: Math.max(insets.bottom, space[3]) + space[1] },
          ]}
        >
          {isOwner ? (
            <>
              {listing.status === "draft" ? (
                <Label>Draft · choose a status to publish</Label>
              ) : null}
              <Segmented
                options={OWNER_STATUSES}
                value={listing.status}
                onChange={(s) => setStatus(listing.id, s)}
              />
              <Button
                label="Edit listing"
                variant="primary"
                leading={
                  <PenLine
                    size={18}
                    color={colors.inkOnDark}
                    strokeWidth={2.2}
                  />
                }
                onPress={() =>
                  router.push({
                    pathname: "/listing/edit",
                    params: { id: listing.id },
                  })
                }
              />
            </>
          ) : (
            <View style={styles.actions}>
              <Button
                label="Message"
                variant="accent"
                style={styles.flex}
                loading={busy === "message"}
                leading={
                  <MessageCircle
                    size={19}
                    color={colors.inkOnDark}
                    strokeWidth={2.2}
                  />
                }
                onPress={() => contact("message")}
              />
              <IconButton
                label="Audio call"
                size={56}
                variant="sunken"
                disabled={!allowCalls || busy !== null}
                onPress={() => contact("audio")}
              >
                <Phone size={21} color={colors.ink} strokeWidth={2.1} />
              </IconButton>
              <IconButton
                label="Video call"
                size={56}
                variant="sunken"
                disabled={!allowCalls || busy !== null}
                onPress={() => contact("video")}
              >
                <Video size={22} color={colors.ink} strokeWidth={2.1} />
              </IconButton>
            </View>
          )}
          {!isOwner && !allowCalls ? (
            <Text variant="caption" tone="tertiary" center>
              This owner accepts messages only. Your number is never shared.
            </Text>
          ) : null}
        </View>
      ) : null}

      {listing && photo && listing.images.length > 0 ? (
        <PhotoViewer
          images={listing.images}
          startIndex={Math.min(photo.index, listing.images.length - 1)}
          title={listing.title}
          origin={photo.origin}
          hasPanorama={!!listing.panorama_url}
          onIndexChange={setHeroIndex}
          onOpenPanorama={() => setPano({ origin: null, yaw: 0 })}
          onClose={() => setPhoto(null)}
        />
      ) : null}
      {listing?.panorama_url && pano ? (
        <PanoramaViewer
          url={listing.panorama_url}
          title="360° site view"
          subtitle={`${listing.locality}, ${listing.district}`}
          origin={pano.origin}
          initialYaw={pano.yaw}
          onClose={() => setPano(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  headerRow: { paddingHorizontal: gutter, flexDirection: "row" },
  centerState: { flex: 1, justifyContent: "center", paddingBottom: space[16] },
  sheet: {
    marginTop: -SHEET_OVERLAP,
    borderTopLeftRadius: SHEET_OVERLAP,
    borderTopRightRadius: SHEET_OVERLAP,
    borderCurve: "continuous",
    backgroundColor: colors.canvas,
  },
  sheetBody: { paddingHorizontal: gutter, paddingTop: space[6], gap: space[5] },
  titleBlock: { gap: space[2] },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  place: { flexDirection: "row", alignItems: "center", gap: space[1] },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space[3],
  },
  section: { gap: space[3] },
  features: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.canvas,
    boxShadow: shadow.hair,
    justifyContent: "center",
  },
  topTitle: {
    marginHorizontal: gutter + 44 * 2 + space[4],
    textAlign: "center",
  },
  floating: {
    position: "absolute",
    left: gutter,
    right: gutter,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  floatingEnd: { flexDirection: "row", gap: space[2] },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[3],
    paddingHorizontal: gutter,
    gap: space[3],
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: "continuous",
    boxShadow: shadow.float,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: space[2] },
});
