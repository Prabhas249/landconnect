import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useNavigation, usePreventRemove, type Href, type NativeStackNavigationProp } from 'expo-router';
import { Check, Lock, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Alert, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { qk } from '@/data/keys';
import { createListing, deleteListing, fetchListing, updateListing } from '@/data/listings';
import { convertArea, formatArea, formatPrice, formatRate, unitLabel } from '@/lib/format';
import { errorMessage } from '@/lib/supabase';
import {
  AREA_UNITS,
  DOCUMENT_OPTIONS,
  FEATURE_OPTIONS,
  LAND_TYPES,
  type AreaUnit,
  type ListingWithOwner,
} from '@/lib/types';
import { useListingDraft } from '@/stores/listing-draft';
import { canManageListings, useSession } from '@/stores/session';
import { colors, duration, gutter, radius, shadow, space, spring } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Chip } from '@/ui/chip';
import { Enter } from '@/ui/enter';
import { Field } from '@/ui/field';
import { IconButton } from '@/ui/icon-button';
import { ProgressSegments } from '@/ui/progress-segments';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { useSheetDepth } from '@/ui/sheet-depth';
import { Label, Text } from '@/ui/text';

import {
  cleanArea,
  cleanPrice,
  completeness,
  emptyForm,
  groupDecimal,
  groupIndian,
  formFromListing,
  parseArea,
  parsePrice,
  sectionStatus,
  snapshot,
  toInput,
  validate,
  type FormErrors,
  type FormState,
  type Photo,
} from './form';
import { LocationSection } from './location-section';
import { PhotosSection } from './photos-section';
import { Toggle } from './toggle';

const SECTIONS = ['photos', 'basics', 'price', 'location', 'extras'] as const;
type SectionKey = (typeof SECTIONS)[number];

/** The step check pops in with the celebration spring when a section is completed. */
const DONE_POP = ZoomIn.springify().damping(spring.bounce.damping).stiffness(spring.bounce.stiffness);

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <IconButton label="Close" onPress={onPress}>
      <X size={20} color={colors.ink} strokeWidth={2.2} />
    </IconButton>
  );
}

function SectionCard({
  index,
  title,
  hint,
  done,
  onLayout,
  enterIndex,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  done: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Stagger slot when the card mounts after the sheet settled; omit for cards that ride the sheet in. */
  enterIndex?: number;
  children: ReactNode;
}) {
  const card = (
    <Card padding={5} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.stepRow}>
          <Label tone={done ? 'accent' : 'tertiary'}>{`Step ${index + 1} of ${SECTIONS.length}`}</Label>
          {done ? (
            <Animated.View entering={DONE_POP} style={styles.doneMark} accessibilityLabel="Section complete">
              <Check size={12} color={colors.inkOnDark} strokeWidth={3} />
            </Animated.View>
          ) : null}
        </View>
        <Text variant="heading">{title}</Text>
        {hint ? (
          <Text variant="caption" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </Card>
  );
  return (
    // Measured outside Enter so the offset is relative to the scroll content, not the wrapper.
    <View onLayout={onLayout}>{enterIndex == null ? card : <Enter index={enterIndex}>{card}</Enter>}</View>
  );
}

/**
 * The editor arrives as a sheet sliding up. The header, progress meter and the first two sections
 * (everything on the first screen) render in the very first frame and ride the sheet in, so the
 * screen reads as instant. The heavier cards below the fold (unit picker, map glyph, chip walls)
 * mount once the slide has settled, so their mount never delays or stutters the transition.
 */
function useTransitionSettled() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const off = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) setSettled(true);
    });
    // Fallback for platforms or cases where no transition event arrives (e.g. reduced motion).
    const t = setTimeout(() => setSettled(true), duration.slow + duration.fast);
    return () => {
      off();
      clearTimeout(t);
    };
  }, [navigation]);
  return settled;
}

function Denied() {
  const insets = useScreenInsets();
  return (
    <Screen style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={styles.headerRow}>
        <CloseButton onPress={() => router.back()} />
      </View>
      <View style={styles.centerState}>
        <View style={styles.lockWell}>
          <Lock size={26} color={colors.accent} strokeWidth={2} />
        </View>
        <Text variant="title" center>
          Only sellers and brokers can list land
        </Text>
        <Text tone="secondary" center>
          Your account is set up as a buyer. You can still browse, save listings and talk to owners.
        </Text>
        <Button label="Go back" variant="soft" block={false} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function EditorSkeleton() {
  const insets = useScreenInsets();
  return (
    <Screen style={{ paddingTop: insets.top }}>
      <View style={styles.headerRow}>
        <CloseButton onPress={() => router.back()} />
      </View>
      <View style={styles.skeletonList}>
        {[160, 220, 200].map((h, i) => (
          <View key={i} style={[styles.skeleton, { height: h }]} />
        ))}
      </View>
    </Screen>
  );
}

function NotFound() {
  const insets = useScreenInsets();
  return (
    <Screen style={{ paddingTop: insets.top }}>
      <View style={styles.headerRow}>
        <CloseButton onPress={() => router.back()} />
      </View>
      <View style={styles.centerState}>
        <Text variant="title" center>
          This listing is unavailable
        </Text>
        <Text tone="secondary" center>
          It may have been removed, or you may not have access to edit it.
        </Text>
        <Button label="Go back" variant="soft" block={false} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

export function ListingEditor({ id }: { id?: string }) {
  const profile = useSession((s) => s.profile);
  const allowed = canManageListings(profile?.role);
  const settled = useTransitionSettled();
  useSheetDepth();
  const query = useQuery({
    queryKey: qk.listing(id ?? ''),
    queryFn: () => fetchListing(id as string),
    enabled: !!id && allowed,
  });

  if (!allowed) return <Denied />;
  if (!id) return <EditorForm key="new" initial={emptyForm} settled={settled} />;
  if (query.isPending) return <EditorSkeleton />;
  if (query.isError || !query.data) return <NotFound />;
  return <EditorForm key={id} initial={formFromListing(query.data)} listing={query.data} settled={settled} />;
}

const ALT_UNIT: Record<AreaUnit, AreaUnit> = { acre: 'gunta', gunta: 'acre', cent: 'acre', sqft: 'acre', sqyd: 'acre' };

function locKey(lat: number, lng: number, boundary: FormState['boundary']) {
  return `${lat},${lng},${boundary?.length ?? 0},${boundary?.[0]?.join(',') ?? ''}`;
}

function EditorForm({ initial, listing, settled }: { initial: FormState; listing?: ListingWithOwner; settled: boolean }) {
  const qc = useQueryClient();
  const navigation = useNavigation();
  const insets = useScreenInsets();
  const editing = !!listing;
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState<'draft' | 'publish' | 'save' | 'delete' | null>(null);
  const [footerH, setFooterH] = useState(120);
  const baseline = useRef(snapshot(initial));
  const scrollRef = useRef<ComponentRef<typeof KeyboardAwareScrollView>>(null);
  const ys = useRef<Partial<Record<SectionKey, number>>>({});
  const lastLoc = useRef('');

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      if ('title' in patch) delete next.title;
      if ('areaText' in patch) delete next.area;
      if ('priceText' in patch) delete next.price;
      if ('lat' in patch) delete next.location;
      if ('photos' in patch) delete next.photos;
      return next;
    });
  }, []);
  const setPhotos = useCallback((fn: (p: Photo[]) => Photo[]) => {
    setForm((f) => ({ ...f, photos: fn(f.photos) }));
  }, []);

  // The picker hands its result back through the draft store. Only apply when it differs from what we seeded.
  useFocusEffect(
    useCallback(() => {
      const d = useListingDraft.getState();
      if (d.lat == null || d.lng == null) return;
      const key = locKey(d.lat, d.lng, d.boundary);
      if (key === lastLoc.current) return;
      lastLoc.current = key;
      update({
        lat: d.lat,
        lng: d.lng,
        boundary: d.boundary,
        ...(d.locality ? { locality: d.locality } : null),
        ...(d.district ? { district: d.district } : null),
        ...(d.state ? { state: d.state } : null),
      });
    }, [update]),
  );

  const dirty = snapshot(form) !== baseline.current;
  const done = completeness(form);
  const sections = sectionStatus(form);

  // A soft tick each time a step becomes complete, a success tap when the whole form is ready.
  const lastDone = useRef(done);
  useEffect(() => {
    if (done > lastDone.current) {
      if (done === SECTIONS.length) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    }
    lastDone.current = done;
  }, [done]);

  // One guard for every way out (close button, Android back, iOS swipe-down), so unsaved work is
  // never dropped silently. The blocked action is replayed only after the guard has switched off.
  const [discarding, setDiscarding] = useState(false);
  const pendingExit = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  usePreventRemove(dirty && !busy && !discarding, ({ data }) => {
    Alert.alert(
      'Discard changes?',
      editing ? 'Your edits to this listing have not been saved.' : 'This land has not been saved as a draft.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            pendingExit.current = data.action;
            setDiscarding(true);
          },
        },
      ],
    );
  });
  useEffect(() => {
    if (discarding && pendingExit.current) navigation.dispatch(pendingExit.current);
  }, [discarding, navigation]);

  const close = () => router.back();

  const pickLocation = () => {
    useListingDraft.getState().setLocation({
      lat: form.lat,
      lng: form.lng,
      boundary: form.boundary,
      locality: form.locality || null,
      district: form.district || null,
      state: form.state || null,
    });
    if (form.lat != null && form.lng != null) lastLoc.current = locKey(form.lat, form.lng, form.boundary);
    router.push('/listing/pick-location' as Href);
  };

  const scrollToFirst = (e: FormErrors) => {
    const target: SectionKey | null = e.photos
      ? 'photos'
      : e.title
        ? 'basics'
        : e.area || e.price
          ? 'price'
          : e.location
            ? 'location'
            : null;
    if (!target) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, (ys.current[target] ?? 0) - space[4]), animated: true });
  };

  const save = async (kind: 'draft' | 'publish' | 'save') => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      scrollToFirst(e);
      return;
    }
    setBusy(kind);
    try {
      const status = kind === 'publish' ? 'active' : kind === 'draft' ? 'draft' : (listing?.status ?? 'active');
      const input = toInput(form, status);
      const saved = listing ? await updateListing(listing.id, input) : await createListing(input);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['listings'] }),
        qc.invalidateQueries({ queryKey: qk.myListings }),
        qc.invalidateQueries({ queryKey: qk.listing(saved.id) }),
      ]);
      useListingDraft.getState().reset();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not save listing', errorMessage(err));
      setBusy(null);
    }
  };

  const remove = () => {
    if (!listing) return;
    Alert.alert('Delete this listing?', 'It will be removed for everyone. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete listing',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await deleteListing(listing.id);
            qc.removeQueries({ queryKey: qk.listing(listing.id) });
            await Promise.all([
              qc.invalidateQueries({ queryKey: ['listings'] }),
              qc.invalidateQueries({ queryKey: qk.myListings }),
            ]);
            useListingDraft.getState().reset();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          } catch (err) {
            Alert.alert('Could not delete listing', errorMessage(err));
            setBusy(null);
          }
        },
      },
    ]);
  };

  const mark = (k: SectionKey) => (e: LayoutChangeEvent) => {
    ys.current[k] = e.nativeEvent.layout.y;
  };
  const toggleIn = (key: 'features' | 'documents', v: string) =>
    update({ [key]: form[key].includes(v) ? form[key].filter((x) => x !== v) : [...form[key], v] });

  const area = parseArea(form.areaText);
  const price = parsePrice(form.priceText);
  const alt = ALT_UNIT[form.unit];
  const altLabel = AREA_UNITS.find((u) => u.value === alt)?.label.toLowerCase() ?? alt;
  const showDraftFlow = !editing || listing?.status === 'draft';

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <View style={styles.headerRow}>
        <CloseButton onPress={close} />
        <View style={styles.titleBlock}>
          <Text variant="heading" center numberOfLines={1}>
            {editing ? 'Edit listing' : 'List land'}
          </Text>
          <Text variant="caption" tone="secondary" center numberOfLines={1}>
            {listing ? listing.title : 'Private until you publish'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.meter}>
        <ProgressSegments total={SECTIONS.length} value={done} height={6} />
        <View style={styles.meterRow}>
          <Label tone={done === SECTIONS.length ? 'accent' : 'tertiary'}>
            {done === SECTIONS.length ? 'Ready to publish' : `${done} of ${SECTIONS.length} complete`}
          </Label>
          {dirty ? <Label tone="tertiary">Unsaved</Label> : null}
        </View>
      </View>

      <KeyboardAwareScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        bottomOffset={footerH + space[4]}
        contentContainerStyle={[styles.content, { paddingBottom: footerH + space[6] }]}>
        <SectionCard
          index={0}
          title="Photos"
          hint="Clear daylight photos of the land, its access road and boundary."
          done={sections[0]}
          onLayout={mark('photos')}>
          <PhotosSection photos={form.photos} setPhotos={setPhotos} error={errors.photos} />
        </SectionCard>

        <SectionCard index={1} title="Basics" done={sections[1]} onLayout={mark('basics')}>
          <Field
            label="Title"
            placeholder="e.g. 2 acre agricultural plot near Devanahalli"
            value={form.title}
            onChangeText={(title) => update({ title })}
            error={errors.title}
            maxLength={90}
            counter
            returnKeyType="next"
          />
          <View style={styles.group}>
            <Label>Land type</Label>
            <View style={styles.chips}>
              {LAND_TYPES.map((t) => (
                <Chip
                  key={t.value}
                  label={t.label}
                  selected={form.landType === t.value}
                  onPress={() => update({ landType: t.value })}
                />
              ))}
            </View>
          </View>
          <Field
            label="Description"
            placeholder="Access, soil, surroundings, anything a serious buyer should know."
            value={form.description}
            onChangeText={(description) => update({ description })}
            maxLength={2000}
            counter
            multiline
          />
        </SectionCard>

        {settled ? (
          <>

            <SectionCard index={2} enterIndex={0} title="Size and price" done={sections[2]} onLayout={mark('price')}>
              <Field
                label="Approximate area"
                placeholder="0"
                keyboardType="decimal-pad"
                value={groupDecimal(form.areaText)}
                onChangeText={(t) => update({ areaText: cleanArea(t) })}
                suffix={unitLabel(form.unit, area !== 1)}
                error={errors.area}
              />
              <Segmented options={AREA_UNITS} value={form.unit} onChange={(unit) => update({ unit })} />
              <Field
                label="Total asking price"
                placeholder="0"
                keyboardType="number-pad"
                leading={<Text variant="bodyStrong" tone="secondary">₹</Text>}
                value={groupIndian(form.priceText)}
                onChangeText={(t) => update({ priceText: cleanPrice(t) })}
                error={errors.price}
              />
              <View style={styles.preview}>
                <Text variant="figure" tone={price > 0 ? 'ink' : 'tertiary'} numberOfLines={1}>
                  {price > 0 ? formatPrice(price) : '₹0'}
                </Text>
                <Text variant="captionStrong" tone={price > 0 && area > 0 ? 'secondary' : 'tertiary'} style={styles.figures}>
                  {price > 0 && area > 0 ? formatRate(price, area, form.unit) : 'Rate per unit appears here'}
                </Text>
                <Text variant="caption" tone="tertiary" style={styles.figures}>
                  {area > 0
                    ? `= ${formatArea(Math.round(convertArea(area, form.unit, alt) * 100) / 100, alt)}`
                    : `Equivalent in ${altLabel} appears here`}
                </Text>
              </View>
              <Toggle label="Negotiable" value={form.negotiable} onChange={(negotiable) => update({ negotiable })} />
            </SectionCard>

            <SectionCard
              index={3}
              enterIndex={1}
              title="Location"
              hint="Pin the parcel and outline its boundary if you can."
              done={sections[3]}
              onLayout={mark('location')}>
              <LocationSection form={form} update={update} onPick={pickLocation} error={errors.location} />
            </SectionCard>

            <SectionCard
              index={4}
              enterIndex={2}
              title="Features and documents"
              hint="Only mark paperwork you can share on request."
              done={sections[4]}
              onLayout={mark('extras')}>
              <View style={styles.group}>
                <Label>Features</Label>
                <View style={styles.chips}>
                  {FEATURE_OPTIONS.map((f) => (
                    <Chip key={f} label={f} selected={form.features.includes(f)} onPress={() => toggleIn('features', f)} />
                  ))}
                </View>
              </View>
              <View style={styles.group}>
                <Label>Documents available</Label>
                <View style={styles.chips}>
                  {DOCUMENT_OPTIONS.map((d) => (
                    <Chip key={d} label={d} selected={form.documents.includes(d)} onPress={() => toggleIn('documents', d)} />
                  ))}
                </View>
              </View>
            </SectionCard>

            {editing ? (
              <Enter index={3}>
                <Button
                  label="Delete listing"
                  variant="ghost"
                  loading={busy === 'delete'}
                  disabled={!!busy}
                  onPress={remove}
                  style={styles.delete}
                />
              </Enter>
            ) : null}
          </>
        ) : (
          // Holds the cards' place below the fold until they mount, so the scroll height and the
          // footer never jump.
          <View style={styles.deferred}>
            <View style={[styles.skeleton, { height: 360 }]} />
            <View style={[styles.skeleton, { height: 200 }]} />
          </View>
        )}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.raw.bottom }} style={styles.footerWrap}>
        <View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={[styles.footer, { paddingBottom: Math.max(insets.raw.bottom, space[4]) }]}>
          {showDraftFlow ? (
            <>
              <Button
                label="Save draft"
                variant="soft"
                block={false}
                style={styles.half}
                loading={busy === 'draft'}
                disabled={!!busy}
                onPress={() => save('draft')}
              />
              <Button
                label="Publish listing"
                variant="accent"
                block={false}
                style={styles.wide}
                loading={busy === 'publish'}
                disabled={!!busy}
                onPress={() => save('publish')}
              />
            </>
          ) : (
            <Button
              label="Save changes"
              variant="accent"
              loading={busy === 'save'}
              disabled={!!busy}
              onPress={() => save('save')}
            />
          )}
        </View>
      </KeyboardStickyView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter, gap: space[3], minHeight: 52 },
  titleBlock: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: 44 },
  meter: { paddingHorizontal: gutter, paddingTop: space[3], paddingBottom: space[3], gap: space[2] },
  meterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  content: { paddingHorizontal: gutter, paddingTop: space[2], gap: space[4] },
  card: { gap: space[5] },
  cardHead: { gap: space[1] },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 18 },
  doneMark: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  group: { gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  preview: {
    gap: space[1],
    minHeight: 96,
    padding: space[4],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  figures: { fontVariant: ['tabular-nums'] },
  delete: { marginTop: space[2] },
  footerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footer: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: gutter,
    paddingTop: space[4],
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: 'continuous',
    boxShadow: shadow.float,
  },
  half: { flex: 1 },
  wide: { flex: 1.5 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], paddingHorizontal: space[8] },
  lockWell: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  deferred: { gap: space[4] },
  skeletonList: { paddingHorizontal: gutter, gap: space[4], paddingTop: space[4] },
  skeleton: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
});
