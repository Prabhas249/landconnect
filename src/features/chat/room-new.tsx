import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, Minus, Plus, Search, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { createRoom, fetchContacts, searchProfiles, sendMessage } from '@/data/chat';
import { qk } from '@/data/keys';
import { formatDateTime, publicName } from '@/lib/format';
import { errorMessage } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Chip } from '@/ui/chip';
import { Field } from '@/ui/field';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Header, Screen, useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';

import { chatKeys } from './api';
import { EmptyState, RoleChip, RowSkeleton, VerifiedTick } from './parts';

type Quick = 'none' | 'now' | 'hour' | 'tomorrow' | 'custom';

const QUICK: { value: Exclude<Quick, 'custom'>; label: string }[] = [
  { value: 'none', label: 'Any time' },
  { value: 'now', label: 'Now' },
  { value: 'hour', label: 'In 1 hour' },
  { value: 'tomorrow', label: 'Tomorrow 10 am' },
];

const FIVE_MIN = 5 * 60_000;

function roundUp(d: Date) {
  return new Date(Math.ceil(d.getTime() / FIVE_MIN) * FIVE_MIN);
}

function quickDate(q: Quick): Date | null {
  const now = new Date();
  if (q === 'now') return now;
  if (q === 'hour') return roundUp(new Date(now.getTime() + 3_600_000));
  if (q === 'tomorrow') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0);
  return null;
}

const FOOTER_HEIGHT = 56 + space[3] * 2;

export function NewRoomScreen() {
  const insets = useScreenInsets();
  const queryClient = useQueryClient();
  const myProfile = useSession((s) => s.profile);

  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [quick, setQuick] = useState<Quick>('none');
  const [when, setWhen] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const contacts = useQuery({ queryKey: qk.contacts, queryFn: fetchContacts });
  const searching = debounced.length >= 2;
  const results = useQuery({
    queryKey: chatKeys.profileSearch(debounced),
    queryFn: () => searchProfiles(debounced),
    enabled: searching,
  });

  const people = searching ? results.data : contacts.data;
  const peopleLoading = searching ? results.isPending : contacts.isPending;
  const selectedIds = new Set(selected.map((p) => p.id));

  const pickQuick = (q: Exclude<Quick, 'custom'>) => {
    setQuick(q);
    setWhen(quickDate(q));
  };

  /** Steppers nudge the time but never into the past. */
  const nudge = (ms: number) => {
    const base = when ?? roundUp(new Date());
    const next = new Date(base.getTime() + ms);
    const floor = new Date();
    setWhen(next < floor ? roundUp(floor) : next);
    setQuick('custom');
  };

  const toggle = (p: Profile) => {
    setSelected((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]));
  };

  const create = useMutation({
    mutationFn: async () => {
      const id = await createRoom({
        title,
        agenda,
        scheduledAt: when,
        memberIds: selected.map((p) => p.id),
      });
      // The opening system line is a courtesy; the room exists even if it fails.
      await sendMessage(id, `${publicName(myProfile)} created the room`, 'system').catch(() => undefined);
      return id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: qk.conversations });
      queryClient.invalidateQueries({ queryKey: qk.contacts });
      router.replace({ pathname: '/room/[id]', params: { id } });
    },
    onError: (e) => Alert.alert('Room not created', errorMessage(e)),
  });

  const canCreate = title.trim().length > 0 && !create.isPending;

  return (
    <Screen>
      <View style={{ paddingTop: insets.top }}>
        <Header
          title="New meeting room"
          back={false}
          trailing={
            <IconButton label="Close" onPress={() => router.back()}>
              <X size={20} color={colors.ink} strokeWidth={2.2} />
            </IconButton>
          }
        />
      </View>

      <KeyboardAwareScrollView
        bottomOffset={FOOTER_HEIGHT + space[4]}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: FOOTER_HEIGHT + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <Section label="About">
          <Field
            label="Title"
            placeholder="Site visit, Devanahalli plot"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            returnKeyType="next"
          />
          <Field
            label="Agenda"
            placeholder="Walk the boundary, review RTC and EC, agree next steps"
            value={agenda}
            onChangeText={setAgenda}
            multiline
            maxLength={600}
          />
        </Section>

        <Section label="When">
          <View style={styles.chips}>
            {QUICK.map((q) => (
              <Chip key={q.value} label={q.label} selected={quick === q.value} onPress={() => pickQuick(q.value)} />
            ))}
          </View>
          <Card padding={4} style={styles.whenCard}>
            <View style={styles.whenTop}>
              <View style={styles.flex}>
                <Label>{when ? 'Starts' : 'Schedule'}</Label>
                <Animated.View key={when ? when.getTime() : 'none'} entering={FadeIn.duration(160)}>
                  <Text variant="heading" tone={when ? 'ink' : 'tertiary'} style={styles.tabular}>
                    {when ? formatDateTime(when.toISOString()) : 'Open, join any time'}
                  </Text>
                </Animated.View>
              </View>
            </View>
            <View style={styles.steppers}>
              <Stepper label="Day" onMinus={() => nudge(-86_400_000)} onPlus={() => nudge(86_400_000)} />
              <Stepper label="Hour" onMinus={() => nudge(-3_600_000)} onPlus={() => nudge(3_600_000)} />
            </View>
          </Card>
        </Section>

        <Section label={selected.length > 0 ? `Members · ${selected.length}` : 'Members'}>
          {selected.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {selected.map((p) => (
                <Animated.View
                  key={p.id}
                  entering={ZoomIn.springify().damping(spring.snappy.damping).stiffness(spring.snappy.stiffness)}
                  exiting={ZoomOut.duration(140)}
                  layout={LinearTransition.springify().damping(spring.gentle.damping)}>
                  <PressableScale
                    haptic="selection"
                    accessibilityLabel={`Remove ${publicName(p)}`}
                    onPress={() => toggle(p)}
                    style={styles.stripItem}>
                    <View>
                      <Avatar name={publicName(p)} seed={p.id} uri={p.avatar_url} size={52} />
                      <View style={styles.stripRemove}>
                        <X size={11} color={colors.inkOnDark} strokeWidth={2.8} />
                      </View>
                    </View>
                    <Text variant="caption" numberOfLines={1} style={styles.stripName}>
                      {publicName(p)}
                    </Text>
                  </PressableScale>
                </Animated.View>
              ))}
            </ScrollView>
          ) : null}

          <Field
            placeholder="Search people by name or handle"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            leading={<Search size={18} color={colors.inkTertiary} strokeWidth={2.1} />}
          />

          <Label>{searching ? 'Results' : 'People you talk to'}</Label>
          {peopleLoading ? (
            <RowSkeleton count={3} avatar={44} />
          ) : (people ?? []).length === 0 ? (
            <EmptyState
              art="search"
              title={searching ? 'Nobody matches' : 'No contacts yet'}
              body={
                searching
                  ? 'Names follow each person’s privacy setting. Try their handle, like B-2041.'
                  : 'Search above to invite anyone on LandConnect by name or handle.'
              }
              style={styles.emptyCompact}
            />
          ) : (
            <Card padding={2}>
              {(people ?? []).map((p) => (
                <PersonRow key={p.id} profile={p} selected={selectedIds.has(p.id)} onToggle={() => toggle(p)} />
              ))}
            </Card>
          )}
        </Section>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.raw.bottom }} style={styles.footerWrap}>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.raw.bottom, space[3]) }]}>
          <Button
            label={selected.length > 0 ? `Create room with ${selected.length}` : 'Create room'}
            variant="accent"
            haptic="medium"
            disabled={!canCreate}
            loading={create.isPending}
            onPress={() => create.mutate()}
          />
        </View>
      </KeyboardStickyView>
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}

function Stepper({ label, onMinus, onPlus }: { label: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.stepper}>
      <IconButton label={`Earlier by one ${label.toLowerCase()}`} size={40} haptic="selection" onPress={onMinus}>
        <Minus size={18} color={colors.ink} strokeWidth={2.2} />
      </IconButton>
      <Label tone="secondary">{label}</Label>
      <IconButton label={`Later by one ${label.toLowerCase()}`} size={40} haptic="selection" onPress={onPlus}>
        <Plus size={18} color={colors.ink} strokeWidth={2.2} />
      </IconButton>
    </View>
  );
}

function PersonRow({ profile, selected, onToggle }: { profile: Profile; selected: boolean; onToggle: () => void }) {
  const name = publicName(profile);
  return (
    <PressableScale
      haptic="selection"
      to={0.98}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      style={[styles.person, selected ? styles.personSelected : null]}>
      <Avatar name={name} seed={profile.id} uri={profile.avatar_url} size={44} />
      <View style={styles.flex}>
        <View style={styles.nameRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
            {name}
          </Text>
          {profile.verified ? <VerifiedTick size={14} /> : null}
        </View>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {profile.city ? `${profile.handle} · ${profile.city}` : profile.handle}
        </Text>
      </View>
      <RoleChip role={profile.role} />
      <View style={[styles.check, selected ? styles.checkOn : null]}>
        {selected ? (
          <Animated.View entering={ZoomIn.duration(140)} exiting={FadeOut.duration(100)}>
            <Check size={14} color={colors.inkOnDark} strokeWidth={3} />
          </Animated.View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Person rows sit in a card with padding 8, so their highlight radius is the card's minus that. */
const ROW_RADIUS = radius.xl - space[2];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  content: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[6] },
  section: { gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  whenCard: { gap: space[4] },
  whenTop: { flexDirection: 'row', alignItems: 'center' },
  steppers: { flexDirection: 'row', gap: space[3] },
  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space[1],
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  strip: { gap: space[3], paddingVertical: space[1] },
  stripItem: { width: 64, alignItems: 'center', gap: space[1] },
  stripName: { maxWidth: 64 },
  stripRemove: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCompact: { paddingVertical: space[4] },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[2],
    borderRadius: ROW_RADIUS,
    borderCurve: 'continuous',
  },
  personSelected: { backgroundColor: colors.accentSoft },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  footerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footer: { paddingHorizontal: gutter, paddingTop: space[3], backgroundColor: colors.canvas },
});
