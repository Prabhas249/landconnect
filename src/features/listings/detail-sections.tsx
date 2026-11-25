import { router } from "expo-router";
import {
  ArrowLeftRight,
  ChevronRight,
  FileCheck,
  FileText,
  Landmark,
  Lock,
  Map as MapIcon,
  Check,
  Droplets,
  Navigation,
  PencilRuler,
  Route,
  ScrollText,
  ShieldCheck,
  Stamp,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withDelay,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import {
  LandMapPreview,
  type LandMapPreviewProps,
} from "@/features/map/land-map-preview";
import { openDirections } from "@/lib/directions";
import {
  formatArea,
  formatNumber,
  formatPresence,
  groupIndian,
  isOnline,
  polygonAcres,
  publicName,
  toAcres,
} from "@/lib/format";
import {
  DOCUMENT_OPTIONS,
  ROLE_COPY,
  type Listing,
  type ListingWithOwner,
} from "@/lib/types";
import { colors, font, radius, shadow, space, spring } from "@/theme/tokens";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Chip } from "@/ui/chip";
import { PressableScale } from "@/ui/pressable-scale";
import { Label, Text } from "@/ui/text";

import { hasBoundary, openRing } from "./geometry";
import { useInView } from "./in-view";
import { ParcelPlan, parcelContext } from "./graphics/parcel-plan";
import {
  BENGALURU_CENTRE,
  distanceKm,
  formatKm,
  publicPoint,
} from "./location";
import { landTypeLabel } from "./meta";

const CARD_PAD = space[5];
const PARCEL_PAD = space[3];
const HUE = {
  green: "#0F6E56",
  blue: "#3B6FD8",
  amber: "#EF9F27",
  mint: "#3FAE89",
} as const;

/**
 * Single integration point for the map owner's optional preview props (satellite basemap,
 * slow orbit). `land-map-preview.tsx` does not expose them yet; once it does, set them here,
 * e.g. `{ satellite: true, orbit: !reduceMotion }`.
 */
const MAP_PREVIEW_EXTRAS: Partial<LandMapPreviewProps> = {
  satellite: true,
  orbit: true,
};

export function StatRow({ listing }: { listing: Listing }) {
  const cells = [
    { label: "Area", value: formatArea(listing.area_value, listing.area_unit) },
    { label: "Land type", value: landTypeLabel(listing.land_type) },
    { label: "Views", value: formatNumber(listing.views) },
  ];
  return (
    <Card padding={4} style={styles.statRow}>
      {cells.map((c, i) => (
        <View
          key={c.label}
          style={[styles.statCell, i > 0 ? styles.statDivider : null]}
        >
          <Label numberOfLines={1}>{c.label}</Label>
          <Text
            variant="figureSmall"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {c.value}
          </Text>
        </View>
      ))}
    </Card>
  );
}

export function ParcelCard({
  listing,
  width,
}: {
  listing: Listing;
  width: number;
}) {
  const traced = hasBoundary(listing.boundary);
  const declared = toAcres(listing.area_value, listing.area_unit);
  const tracedAcres = traced ? polygonAcres(openRing(listing.boundary!)) : 0;
  const differs =
    traced && declared > 0 && Math.abs(declared / tracedAcres - 1) > 0.03;
  const survey = listing.survey_number?.replace(/^sy\.?\s*(no\.?)?\s*/i, "");
  const ctx = parcelContext(listing.features);
  const readout = areaReadout(traced ? tracedAcres : declared);

  return (
    <View style={[styles.softCard, styles.gap3, { padding: PARCEL_PAD }]}>
      <View style={styles.parcelHead}>
        <View style={[styles.parcelIcon, { backgroundColor: `${HUE.green}1F` }]}>
          <PencilRuler size={17} color={HUE.green} strokeWidth={2.2} />
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {traced ? "Surveyed boundary" : "Indicative plan"}
          </Text>
          <Text variant="caption" tone="tertiary" numberOfLines={1}>
            {survey ? `Sy. no. ${survey}` : "Survey no. on request"}
          </Text>
        </View>
      </View>
      <ParcelPlan
        boundary={listing.boundary}
        areaValue={listing.area_value}
        areaUnit={listing.area_unit}
        landType={listing.land_type}
        features={listing.features}
        seed={listing.id}
        corner={radius.xl - PARCEL_PAD}
        width={width - PARCEL_PAD * 2}
      />
      <View style={styles.readout}>
        <View style={styles.readoutFigure}>
          <Text style={styles.readoutHuge} numberOfLines={1}>
            {readout.big}
          </Text>
          <Text variant="bodyStrong" tone="secondary" style={styles.readoutUnit}>
            {readout.unit}
          </Text>
        </View>
        <Text variant="captionStrong" tone="secondary" numberOfLines={1}>
          {readout.sub}
        </Text>
      </View>
      <View style={styles.legend}>
        {traced ? (
          <LegendChip
            swatch="stake"
            label="Surveyed"
            value={`${groupIndian(tracedAcres, 2)} ac`}
          />
        ) : null}
        {!traced || differs ? (
          <LegendChip
            swatch={traced ? "dashed" : "fill"}
            label="Declared"
            value={`${groupIndian(declared, 2)} ac`}
          />
        ) : (
          <LegendChip icon={Check} hue={HUE.green} label="Matches declared" />
        )}
        {ctx.road ? (
          <LegendChip icon={Route} hue={HUE.blue} label={ctx.roadLabel} />
        ) : null}
        {ctx.water ? (
          <LegendChip icon={Droplets} hue={HUE.blue} label="Water nearby" />
        ) : null}
      </View>
      {traced ? null : (
        <Text variant="caption" tone="secondary" style={styles.parcelNote}>
          Drawn to scale from the declared area. The owner has not traced the
          boundary yet.
        </Text>
      )}
    </View>
  );
}

/** Headline area in the unit that reads best: acres from 1 acre, guntas from 1 gunta, else sq ft. */
function areaReadout(acres: number) {
  const guntas = acres * 40;
  const sqft = acres * 43560;
  if (acres >= 1) {
    return {
      big: groupIndian(acres, acres >= 100 ? 0 : 2),
      unit: acres === 1 ? "acre" : "acres",
      sub: `${groupIndian(guntas, 2)} guntas · ${groupIndian(sqft)} sq ft`,
    };
  }
  if (guntas >= 1) {
    return {
      big: groupIndian(guntas, 2),
      unit: guntas === 1 ? "gunta" : "guntas",
      sub: `${groupIndian(acres, 2)} acres · ${groupIndian(sqft)} sq ft`,
    };
  }
  return {
    big: groupIndian(sqft),
    unit: "sq ft",
    sub: `${groupIndian(guntas, 2)} guntas · ${groupIndian(acres * 100, 2)} cents`,
  };
}

function LegendChip({
  swatch,
  icon: Icon,
  hue,
  label,
  value,
}: {
  swatch?: "stake" | "dashed" | "fill";
  icon?: LucideIcon;
  hue?: string;
  label: string;
  value?: string;
}) {
  return (
    <View style={styles.legendChip}>
      {Icon && hue ? (
        <View style={[styles.legendIcon, { backgroundColor: `${hue}1F` }]}>
          <Icon size={11} color={hue} strokeWidth={2.6} />
        </View>
      ) : swatch === "stake" ? (
        <View style={styles.swatchStake} />
      ) : swatch === "dashed" ? (
        <View style={styles.swatchDashed} />
      ) : (
        <View style={styles.swatchFill} />
      )}
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {value ? <Text variant="captionStrong">{value}</Text> : null}
    </View>
  );
}

type DocStatus = "verified" | "request" | "pending";

const STATUS: Record<DocStatus, { label: string; fg: string; bg: string }> = {
  verified: { label: "Verified", fg: HUE.green, bg: "rgba(15,110,86,0.10)" },
  request: { label: "On request", fg: HUE.blue, bg: "rgba(59,111,216,0.10)" },
  pending: { label: "Pending", fg: "#B86E0A", bg: "rgba(239,159,39,0.14)" },
};

/** Icon, hue and one-line explainer per Karnataka land document; unknown names fall back to a generic file. */
function docMeta(name: string): {
  icon: LucideIcon;
  hue: string;
  hint: string;
} {
  const n = name.toLowerCase();
  if (n.includes("rtc") || n.includes("pahani"))
    return {
      icon: FileText,
      hue: HUE.blue,
      hint: "Record of rights, tenancy and crops",
    };
  if (n.includes("encumbrance") || /\bec\b/.test(n))
    return {
      icon: ShieldCheck,
      hue: HUE.green,
      hint: "No loans or liens on the land",
    };
  if (n.includes("mutation"))
    return {
      icon: ArrowLeftRight,
      hue: HUE.mint,
      hint: "Ownership change on record",
    };
  if (n.includes("khata"))
    return { icon: Landmark, hue: HUE.amber, hint: "Revenue and tax account" };
  if (n.includes("survey") || n.includes("sketch") || n.includes("tippan"))
    return {
      icon: PencilRuler,
      hue: HUE.blue,
      hint: "Boundary and survey measurements",
    };
  if (n.includes("conversion") || n.includes("dc "))
    return {
      icon: Stamp,
      hue: HUE.amber,
      hint: "Approved for non-agricultural use",
    };
  if (n.includes("deed") || n.includes("title") || n.includes("sale"))
    return {
      icon: ScrollText,
      hue: HUE.green,
      hint: "Registered ownership deed",
    };
  return { icon: FileCheck, hue: HUE.mint, hint: "Supporting document" };
}

export function DocumentsCard({
  documents,
  verified = false,
  onRequest,
}: {
  documents: string[];
  /** Listing verified by LandConnect: its listed documents show as Verified. */
  verified?: boolean;
  /** Opens the request flow (chat with the owner). Omitted for the owner's own listing. */
  onRequest?: (doc: string) => void;
}) {
  const { ref, seen, onLayout } = useInView();
  const have = new Set(documents);
  const extra = documents.filter(
    (d) => !(DOCUMENT_OPTIONS as readonly string[]).includes(d),
  );
  const rows = [...extra, ...DOCUMENT_OPTIONS].sort(
    (a, b) => Number(have.has(b)) - Number(have.has(a)),
  );
  const count = rows.filter((d) => have.has(d)).length;

  return (
    <Animated.View
      ref={ref}
      onLayout={onLayout}
      style={[styles.softCard, styles.gap3, { padding: CARD_PAD }]}
    >
      <View style={styles.between}>
        <Label>Documents available</Label>
        <Label tone="accent">{`${count} of ${rows.length}`}</Label>
      </View>
      <View style={styles.docList}>
        {rows.map((doc, i) => {
          const status: DocStatus = have.has(doc)
            ? verified
              ? "verified"
              : "request"
            : "pending";
          return (
            <DocRow
              key={doc}
              doc={doc}
              status={status}
              index={i}
              seen={seen}
              onRequest={onRequest}
            />
          );
        })}
      </View>
      <View style={styles.note}>
        <Lock size={14} color={colors.inkSecondary} strokeWidth={2.1} />
        <Text variant="caption" tone="secondary" style={styles.flex}>
          Documents are shared privately in chat when you request them. Nothing
          is downloadable from the listing.
        </Text>
      </View>
    </Animated.View>
  );
}

function DocRow({
  doc,
  status,
  index,
  seen,
  onRequest,
}: {
  doc: string;
  status: DocStatus;
  index: number;
  seen: SharedValue<number>;
  onRequest?: (doc: string) => void;
}) {
  const meta = docMeta(doc);
  const s = STATUS[status];
  const Icon = meta.icon;
  const pending = status === "pending";
  const helper = pending ? "Not added by the owner yet" : meta.hint;
  const tappable = !!onRequest;

  const t = useDerivedValue(() =>
    seen.get() === 1
      ? withDelay(Math.min(index, 8) * 55, withSpring(1, spring.layout))
      : 0,
  );
  const enter = useAnimatedStyle(() => ({
    opacity: t.get(),
    transform: [{ translateY: (1 - t.get()) * 10 }],
  }));

  const body = (
    <>
      <View
        style={[
          styles.docIcon,
          { backgroundColor: pending ? colors.surfaceSunken : `${meta.hue}1F` },
        ]}
      >
        <Icon
          size={18}
          color={pending ? colors.inkTertiary : meta.hue}
          strokeWidth={2.1}
        />
      </View>
      <View style={styles.docText}>
        <Text
          variant="bodyStrong"
          tone={pending ? "secondary" : "ink"}
          numberOfLines={1}
        >
          {doc}
        </Text>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {helper}
        </Text>
      </View>
      <View style={[styles.statusChip, { backgroundColor: s.bg }]}>
        <View style={[styles.statusDot, { backgroundColor: s.fg }]} />
        <Text
          variant="captionStrong"
          style={[styles.statusText, { color: s.fg }]}
          numberOfLines={1}
        >
          {s.label}
        </Text>
      </View>
      {tappable ? (
        <ChevronRight size={16} color={colors.inkTertiary} strokeWidth={2.2} />
      ) : null}
    </>
  );

  return (
    <Animated.View style={enter}>
      {tappable ? (
        <PressableScale
          to={0.98}
          haptic="selection"
          onPress={() => onRequest?.(doc)}
          accessibilityRole="button"
          accessibilityLabel={`${doc}, ${s.label}. ${pending ? "Ask the owner for it" : "Request in chat"}`}
          style={styles.docRow}
        >
          {body}
        </PressableScale>
      ) : (
        <View
          style={styles.docRow}
          accessible
          accessibilityLabel={`${doc}, ${s.label}`}
        >
          {body}
        </View>
      )}
    </Animated.View>
  );
}

export function LocationCard({
  listing,
  isOwner,
}: {
  listing: Listing;
  isOwner: boolean;
}) {
  const point = publicPoint(listing, isOwner);
  const approximate = point.approximate;
  const fromCentre = formatKm(distanceKm(BENGALURU_CENTRE, point));
  const [routing, setRouting] = useState(false);

  async function directions() {
    if (routing) return;
    setRouting(true);
    // Only ever the public point: fuzzed for hidden-location listings viewed by non-owners.
    const ok = await openDirections({
      lat: point.lat,
      lng: point.lng,
      label: approximate
        ? `Approximate area, ${listing.locality}`
        : listing.title,
    });
    setRouting(false);
    if (!ok)
      Alert.alert(
        "No maps app found",
        "Install a maps app to get turn-by-turn directions.",
      );
  }

  // Deep link: the Map tab reads `focus` to fly to this listing (see report — param requested from the map owner).
  const openInMap = () =>
    router.navigate({ pathname: "/map", params: { focus: listing.id } });

  return (
    <Card padding={2} style={styles.gap3}>
      <View style={styles.locationHead}>
        <View style={styles.flex}>
          <Text
            variant="bodyStrong"
            numberOfLines={1}
          >{`${listing.locality}, ${listing.district}`}</Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {`${approximate ? "≈ " : ""}${fromCentre} from Bengaluru centre · straight line`}
          </Text>
        </View>
        {approximate ? (
          <Chip label="Approximate" tone="highlight" mono />
        ) : null}
      </View>
      <View style={styles.map}>
        <LandMapPreview
          landType={listing.land_type}
          lat={point.lat}
          lng={point.lng}
          boundary={approximate ? null : listing.boundary}
          approximate={approximate}
          height={188}
          {...MAP_PREVIEW_EXTRAS}
        />
      </View>
      <Text variant="caption" tone="secondary" style={styles.locationNote}>
        {approximate
          ? "Exact location is shared by the owner once you are in touch. Directions lead to the approximate area."
          : listing.hide_exact_location
            ? "Buyers see an approximate area until you share the exact pin."
            : `${listing.district}, ${listing.state}`}
      </Text>
      <View
        style={[
          styles.locationActions,
          approximate ? styles.locationActionsStacked : null,
        ]}
      >
        <Button
          label="Open in map"
          variant="soft"
          size="md"
          style={approximate ? null : styles.flex}
          leading={<MapIcon size={17} color={colors.ink} strokeWidth={2.1} />}
          onPress={openInMap}
        />
        <Button
          label={approximate ? "Directions to approximate area" : "Directions"}
          variant="accent"
          size="md"
          style={approximate ? null : styles.flex}
          loading={routing}
          leading={
            <Navigation size={17} color={colors.inkOnDark} strokeWidth={2.2} />
          }
          onPress={directions}
        />
      </View>
    </Card>
  );
}

export function OwnerCard({ listing }: { listing: ListingWithOwner }) {
  const owner = listing.owner;
  const name = publicName(owner);
  const presence = formatPresence(owner);

  return (
    <PressableScale
      to={0.985}
      onPress={() =>
        router.push({ pathname: "/user/[id]", params: { id: owner.id } })
      }
      style={styles.owner}
      accessibilityLabel={`View ${name}`}
    >
      <Avatar
        name={name}
        seed={owner.id}
        uri={owner.avatar_url}
        size={52}
        online={isOnline(owner)}
      />
      <View style={styles.ownerText}>
        <View style={styles.ownerName}>
          <Text
            variant="bodyStrong"
            numberOfLines={1}
            style={styles.flexShrink}
          >
            {name}
          </Text>
          {owner.verified ? (
            <BadgeCheck size={16} color={colors.accent} strokeWidth={2.2} />
          ) : null}
        </View>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {presence ?? "Listed by this member"}
        </Text>
      </View>
      <Chip
        label={ROLE_COPY[owner.role].label}
        tone={owner.role === "broker" ? "highlight" : "accent"}
        mono
      />
      <ChevronRight size={18} color={colors.inkTertiary} strokeWidth={2.1} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  gap3: { gap: space[3] },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statRow: { flexDirection: "row" },
  statCell: { flex: 1, gap: space[1], paddingHorizontal: space[2] },
  statDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth * 2,
    borderLeftColor: colors.hairline,
  },
  softCard: {
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(16,32,28,0.05)",
    boxShadow: "0 12px 32px rgba(16,32,28,0.08)",
  },
  parcelHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[1],
    paddingTop: space[1],
  },
  parcelIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  parcelNote: { paddingHorizontal: space[1], paddingBottom: space[1] },
  readout: { gap: 2, paddingHorizontal: space[1], paddingTop: space[1] },
  readoutFigure: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  readoutHuge: {
    fontFamily: font.semibold,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1.6,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  readoutUnit: { fontSize: 17 },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[1],
    paddingBottom: space[1],
  },
  legendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingLeft: 8,
    paddingRight: 11,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
  },
  legendIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchStake: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: HUE.green,
  },
  swatchDashed: {
    width: 14,
    height: 0,
    borderTopWidth: 2,
    borderStyle: "dashed",
    borderColor: HUE.amber,
  },
  swatchFill: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: "#B4E4CF",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#0B5743",
  },
  docList: { gap: space[1], marginHorizontal: -space[2] },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.md,
    borderCurve: "continuous",
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  docText: { flex: 1, minWidth: 0 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    height: 26,
    borderRadius: 13,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12 },
  note: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-start",
    padding: space[3],
    borderRadius: radius.xl - CARD_PAD,
    borderCurve: "continuous",
    backgroundColor: colors.surfaceMuted,
  },
  map: {
    borderRadius: radius.xl - space[2],
    borderCurve: "continuous",
    overflow: "hidden",
  },
  locationHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[3],
    paddingTop: space[3],
  },
  locationNote: { paddingHorizontal: space[3] },
  locationActions: {
    flexDirection: "row",
    gap: space[2],
    paddingHorizontal: space[1],
    paddingBottom: space[1],
  },
  locationActionsStacked: { flexDirection: "column-reverse" },
  owner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  ownerText: { flex: 1, gap: 2 },
  ownerName: { flexDirection: "row", alignItems: "center", gap: space[1] },
});
