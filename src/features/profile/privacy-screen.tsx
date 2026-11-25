import { useQuery } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { Lock, Mail, MapPinOff, Phone, ShieldCheck, UserX } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { qk } from '@/data/keys';
import { fetchBlocked } from '@/data/profiles';
import type { CallPermission, Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space, spring } from '@/theme/tokens';
import { Card, Divider } from '@/ui/card';
import { Enter } from '@/ui/enter';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { StackTopBar, useScrollY, useStackContentTop } from './chrome';
import { CallRelayDiagram } from './graphics';
import { Group, reportError, serialOf } from './parts';
import { PostureSummary } from './posture';
import { CallsPreview, PresencePreview, ReceiptsPreview } from './previews';
import { SettingsCard } from './settings-list';
import { SettingRow, Toggle } from './toggle';
import { TheirScreen } from './visibility-preview';

const CALL_OPTIONS: { value: CallPermission; title: string; description: string }[] = [
  { value: 'everyone', title: 'Everyone', description: 'Any verified participant can ring you from a chat.' },
  { value: 'contacts', title: "People I've chatted with", description: 'Only people you already have a conversation with.' },
  { value: 'nobody', title: 'Nobody', description: 'Calls are switched off. You can still message.' },
];

const NEVER_SHARED = [
  { icon: Phone, title: 'Phone number', note: 'Calls run through LandConnect, not your SIM.' },
  { icon: Mail, title: 'Email address', note: 'Visible only to you.' },
  { icon: MapPinOff, title: 'Exact parcel location', note: 'When the owner hides it, others see an approximate area.' },
] as const;

function RadioRow({ title, description, selected, onPress }: { title: string; description: string; selected: boolean; onPress: () => void }) {
  const p = useDerivedValue(() => withSpring(selected ? 1 : 0, spring.snappy));
  const wash = useAnimatedStyle(() => ({ opacity: p.get() }));
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: p.get() }], opacity: p.get() }));
  return (
    <PressableScale
      to={0.98}
      haptic={selected ? false : 'selection'}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        if (!selected) onPress();
      }}
      style={styles.option}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.optionWash, wash]} />
      <View style={styles.radio}>
        <Animated.View style={[styles.radioDot, dot]} />
      </View>
      <View style={styles.optionCopy}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="secondary">
          {description}
        </Text>
      </View>
    </PressableScale>
  );
}

/** A counterpart serial of the other side's role, so the diagram shows a believable pair. */
function counterpartOf(profile: Profile) {
  return profile.role === 'buyer' ? 'S-3108' : 'B-5276';
}

/**
 * The relay diagram, looping only while its card is on screen and the screen is focused.
 * Visibility is decided on the UI thread from the scroll offset; JS hears only the edges.
 */
function RelayCard({ profile, scrollY }: { profile: Profile | null; scrollY: SharedValue<number> }) {
  const focused = useIsFocused();
  const { height: screenH } = useWindowDimensions();
  const top = useSharedValue(-1);
  const height = useSharedValue(0);
  const [onScreen, setOnScreen] = useState(false);

  useAnimatedReaction(
    () => {
      const y = top.get();
      if (y < 0) return false;
      const s = scrollY.get();
      return y + height.get() > s && y < s + screenH;
    },
    (visible, prev) => {
      if (visible !== prev) scheduleOnRN(setOnScreen, visible);
    },
    [screenH],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    top.set(e.nativeEvent.layout.y);
    height.set(e.nativeEvent.layout.height);
  };

  const mine = profile ? serialOf(profile.handle) : 'B-2041';
  const theirs = profile ? counterpartOf(profile) : 'S-3108';

  return (
    <View onLayout={onLayout}>
      <Enter index={6}>
        <Group title="How calls stay private">
          <Card padding={5} style={styles.diagramCard}>
            <CallRelayDiagram mine={mine} theirs={theirs} active={onScreen && focused} />
            <Text variant="caption" tone="secondary" center>
              Both of you connect to a LandConnect relay, so neither side ever sees the other&apos;s number.
            </Text>
          </Card>
        </Group>
      </Enter>
    </View>
  );
}

/**
 * Every privacy control in one place. The top card is the summary the profile links to:
 * the posture meter and a live mock of what the other side sees. Each setting below
 * live-saves and carries its own small preview.
 */
export default function PrivacyScreen() {
  const insets = useScreenInsets();
  const contentTop = useStackContentTop();
  const profile = useSession((s) => s.profile);
  const updateProfile = useSession((s) => s.updateProfile);
  const blocked = useQuery({ queryKey: qk.blocked, queryFn: fetchBlocked });
  const { scrollY, onScroll } = useScrollY();

  // Settings live-save; `updateProfile` is optimistic and rolls back on failure.
  const save = async (patch: Parameters<typeof updateProfile>[0]) => reportError(await updateProfile(patch));

  const blockedCount = blocked.data?.length;

  return (
    <Screen>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: contentTop, paddingBottom: insets.bottom }]}>
        {profile ? (
          <>
            <Enter index={0}>
              <Card padding={4} style={styles.summary}>
                <PostureSummary profile={profile} />
                <TheirScreen profile={profile} innerRadius={SUMMARY_INNER} />
              </Card>
            </Enter>

            <Enter index={1}>
              <Group title="Identity" hint="Each choice saves as you make it.">
                <Card padding={5}>
                  <SettingRow
                    title="Show my real name"
                    description={`Off, and others see your anonymous handle, ${profile.handle}, everywhere.`}
                    trailing={<Toggle label="Show my real name" value={profile.show_real_name} onValueChange={(v) => save({ show_real_name: v })} />}
                  />
                </Card>
              </Group>
            </Enter>

            <Enter index={2}>
              <Group title="Presence and messages">
                <Card padding={5}>
                  <SettingRow
                    title="Show last seen and online"
                    description="When off, you will not see theirs either."
                    trailing={<Toggle label="Show last seen and online" value={profile.show_last_seen} onValueChange={(v) => save({ show_last_seen: v })} />}
                  />
                  <PresencePreview profile={profile} />
                  <Divider />
                  <SettingRow
                    title="Read receipts"
                    description="Let people know when you have read their message."
                    trailing={<Toggle label="Read receipts" value={profile.read_receipts} onValueChange={(v) => save({ read_receipts: v })} />}
                  />
                  <ReceiptsPreview on={profile.read_receipts} />
                </Card>
              </Group>
            </Enter>

            <Enter index={3}>
              <Group title="Who can call me">
                <Card padding={2} style={styles.options}>
                  {CALL_OPTIONS.map((o) => (
                    <RadioRow
                      key={o.value}
                      title={o.title}
                      description={o.description}
                      selected={profile.allow_calls === o.value}
                      onPress={() => save({ allow_calls: o.value })}
                    />
                  ))}
                  <View style={styles.callPreview}>
                    <CallsPreview value={profile.allow_calls} />
                  </View>
                </Card>
              </Group>
            </Enter>

            <Enter index={4}>
              <Group title="Safety">
                <SettingsCard
                  items={[
                    {
                      key: 'blocked',
                      icon: UserX,
                      title: 'Blocked people',
                      value:
                        blockedCount === undefined
                          ? undefined
                          : blockedCount === 0
                            ? 'No one blocked'
                            : `${blockedCount} ${blockedCount === 1 ? 'person' : 'people'}`,
                      loading: blocked.isPending,
                      onPress: () => router.push('/blocked'),
                    },
                  ]}
                />
              </Group>
            </Enter>
          </>
        ) : (
          <View style={styles.skeletons}>
            {[260, 120, 260].map((h, i) => (
              <View key={i} style={[styles.skeleton, { height: h }]} />
            ))}
          </View>
        )}

        <Enter index={5}>
          <Group title="What LandConnect never shares">
            <Card padding={5}>
              {NEVER_SHARED.map((item, i) => (
                <View key={item.title}>
                  {i > 0 ? <Divider inset={space[10] + space[3]} /> : null}
                  <View style={styles.never}>
                    <View style={styles.neverIcon}>
                      <item.icon size={18} color={colors.accent} strokeWidth={2.1} />
                      <View style={styles.lockBadge}>
                        <Lock size={9} color={colors.inkOnDark} strokeWidth={2.6} />
                      </View>
                    </View>
                    <View style={styles.optionCopy}>
                      <Text variant="bodyStrong">{item.title}</Text>
                      <Text variant="caption" tone="secondary">
                        {item.note}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          </Group>
        </Enter>

        <RelayCard profile={profile} scrollY={scrollY} />

        <Enter index={7}>
          <View style={styles.foot}>
            <ShieldCheck size={14} color={colors.inkTertiary} strokeWidth={2.1} />
            <Text variant="caption" tone="tertiary">
              Roles and privacy rules are enforced by the server.
            </Text>
          </View>
        </Enter>
      </Animated.ScrollView>
      <StackTopBar scrollY={scrollY} title="Privacy and safety" />
    </Screen>
  );
}

// Summary card padding 16 inside radius xl (28): the preview nests at 12 (sm).
const SUMMARY_INNER = radius.xl - space[4];
// Card padding 2 (8) inside radius xl (28) gives inner radius 20, which sits between lg and xl.
const INNER = radius.xl - space[2];

const styles = StyleSheet.create({
  content: { paddingHorizontal: gutter, gap: space[6] },
  summary: { gap: space[4] },
  options: { gap: space[1] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 64,
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    borderRadius: INNER,
    borderCurve: 'continuous',
  },
  optionWash: { backgroundColor: colors.accentSoft, borderRadius: INNER, borderCurve: 'continuous' },
  optionCopy: { flex: 1, gap: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
  callPreview: { paddingHorizontal: space[3], paddingTop: space[2] },
  never: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 60, paddingVertical: space[2] },
  neverIcon: {
    width: space[10],
    height: space[10],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagramCard: { gap: space[3] },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  skeletons: { gap: space[6] },
  skeleton: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
});
