import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { BadgeCheck, KeyRound, LockKeyhole, LogOut, Radio, ShieldCheck, UserRoundPen, UserX } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';

import { qk } from '@/data/keys';
import { fetchBlocked, fetchMyPrivate } from '@/data/profiles';
import { OptionSheet, type SheetOption } from '@/features/listings/option-sheet';
import { ROLE_COPY, type Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Avatar, AVATAR_SIZE } from '@/ui/avatar';
import { ConfirmSheet } from '@/ui/confirm-sheet';
import { Enter } from '@/ui/enter';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { CollapsingTopBar, useScrollY } from './chrome';
import { MemberPass, MemberPassSkeleton } from './member-pass';
import { Group, TINT, maskEmail, postureSummary } from './parts';
import { useProfilePhoto, type PhotoSource } from './photo';
import { SettingsCard, SettingsGroup, SettingsSkeleton, type SettingsItem } from './settings-list';
import { StatsStrip, StatsStripSkeleton } from './stats-strip';
import { VisibilitySwitch } from './visibility-preview';

type PhotoAction = PhotoSource | 'remove';

function photoOptions(profile: Profile, hasPhoto: boolean): SheetOption<PhotoAction>[] {
  const seen = profile.show_real_name ? 'Shown to people you talk to.' : 'Kept to yourself while you are anonymous.';
  const out: SheetOption<PhotoAction>[] = [
    { value: 'library', label: 'Choose from library', hint: `Cropped to a circle. ${seen}` },
    { value: 'camera', label: 'Take a photo', hint: 'Uses the front or back camera.' },
  ];
  if (hasPhoto) out.push({ value: 'remove', label: 'Remove photo', hint: 'Your initials are shown instead.' });
  return out;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The settings entry points, grouped the way people look for them. */
function Settings({ profile }: { profile: Profile }) {
  const blocked = useQuery({ queryKey: qk.blocked, queryFn: fetchBlocked });
  const priv = useQuery({ queryKey: qk.myPrivate, queryFn: fetchMyPrivate });
  const posture = postureSummary(profile);
  const blockedCount = blocked.data?.length;

  const account: SettingsItem[] = [
    {
      key: 'edit',
      icon: UserRoundPen,
      title: 'Edit profile',
      tint: TINT.green,
      value: profile.about ?? 'Name, city and a line about you',
      valueTone: profile.about ? 'secondary' : 'tertiary',
      onPress: () => router.push('/edit-profile'),
    },
    {
      key: 'private',
      icon: KeyRound,
      title: 'Private details',
      tint: TINT.green,
      value: priv.data?.email ? `${maskEmail(priv.data.email)} · only you` : 'Email and phone, only you',
      onPress: () => router.push('/private-details'),
    },
  ];

  const privacy: SettingsItem[] = [
    {
      key: 'privacy',
      icon: ShieldCheck,
      title: 'Privacy',
      tint: TINT.blue,
      value: posture.line,
      accessibilityLabel: `Privacy, ${posture.headline}, ${posture.safe} of ${posture.total} protections on`,
      onPress: () => router.push('/privacy'),
    },
    {
      key: 'blocked',
      icon: UserX,
      title: 'Blocked people',
      tint: TINT.blue,
      value: blockedCount === undefined ? undefined : blockedCount === 0 ? 'No one blocked' : count(blockedCount, 'person', 'people'),
      loading: blocked.isPending,
      onPress: () => router.push('/blocked'),
    },
  ];

  const access: SettingsItem[] = [
    {
      key: 'role',
      icon: LockKeyhole,
      title: 'Your role and access',
      tint: TINT.amber,
      value: ROLE_COPY[profile.role].label,
      onPress: () => router.push('/access'),
    },
  ];

  const about: SettingsItem[] = [
    {
      key: 'identity',
      icon: BadgeCheck,
      title: 'Identity',
      tint: TINT.green,
      // The seal on the pass is the visual mark; this is the one place it is put in words.
      value: profile.verified ? 'Verified participant' : 'Verification in review',
    },
    { key: 'relay', icon: Radio, title: 'Relayed calls', tint: TINT.amber, value: 'Your number is never shared' },
  ];

  return (
    <>
      <Enter index={4}>
        <SettingsGroup title="Account" items={account} />
      </Enter>
      <Enter index={5}>
        <SettingsGroup title="Privacy and safety" items={privacy} />
      </Enter>
      <Enter index={6}>
        <SettingsGroup title="Access" items={access} />
      </Enter>
      <Enter index={7}>
        <SettingsGroup title="About" items={about} />
      </Enter>
    </>
  );
}

export default function ProfileScreen() {
  const insets = useScreenInsets({ tabBar: true });
  const profile = useSession((s) => s.profile);
  const signOut = useSession((s) => s.signOut);
  const photo = useProfilePhoto();
  const [photoSheet, setPhotoSheet] = useState(false);
  const { scrollY, onScroll } = useScrollY();

  // The page title steps back as the compact bar takes over, so the two are never both legible.
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [0, space[8]], [1, 0], 'clamp'),
  }));

  const [signOutSheet, setSignOutSheet] = useState(false);
  const openSignOut = useCallback(() => setSignOutSheet(true), []);
  const closeSignOut = useCallback(() => setSignOutSheet(false), []);
  // Runs once the sheet has slid away, so the auth redirect never cuts the exit short.
  const confirmSignOut = useCallback(() => {
    void signOut();
  }, [signOut]);
  const signOutItems = useMemo(
    () => [{ key: 'signout', icon: LogOut, title: 'Sign out', tint: TINT.red, onPress: openSignOut, trailing: null }],
    [openSignOut],
  );

  const onPhotoAction = (action: PhotoAction) => {
    setPhotoSheet(false);
    // Let the sheet finish closing before the system picker takes over the screen.
    setTimeout(() => {
      if (action === 'remove') void photo.remove();
      else void photo.change(action);
    }, 260);
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Animated.View style={[styles.titleRow, titleStyle]}>
          <Text variant="title" accessibilityRole="header">
            Profile
          </Text>
        </Animated.View>

        {profile ? (
          <View style={styles.body}>
            <View style={styles.hero}>
              {/* The pass runs its own entrance: it slides up and settles like a card laid down. */}
              <MemberPass profile={profile} photoUri={photo.preview} uploading={photo.busy} onChangePhoto={() => setPhotoSheet(true)} />
              <Enter index={2}>
                <StatsStrip role={profile.role} />
              </Enter>
            </View>

            <Enter index={3}>
              <Group title="How others see you">
                <VisibilitySwitch profile={profile} />
              </Group>
            </Enter>

            <Settings profile={profile} />

            <Enter index={7}>
              <View style={styles.end}>
                <SettingsCard items={signOutItems} />
                <Text variant="caption" tone="tertiary" center>
                  LandConnect · Version {version}
                </Text>
              </View>
            </Enter>
          </View>
        ) : (
          <View style={styles.body}>
            <View style={styles.hero}>
              <MemberPassSkeleton />
              <StatsStripSkeleton />
            </View>
            <View style={[styles.skeleton, { height: 196 }]} />
            <SettingsSkeleton rows={2} />
            <SettingsSkeleton rows={2} />
          </View>
        )}
      </Animated.ScrollView>

      <CollapsingTopBar
        scrollY={scrollY}
        title="Profile"
        leading={
          profile ? (
            <Avatar name={profile.display_name} seed={profile.id} uri={photo.preview ?? profile.avatar_url} size={AVATAR_SIZE.xs} />
          ) : null
        }
      />

      <ConfirmSheet
        visible={signOutSheet}
        icon={LogOut}
        title="Sign out of LandConnect?"
        message="Your listings and chats stay safe. Sign back in anytime."
        confirmLabel="Sign out"
        tone="danger"
        onConfirm={confirmSignOut}
        onClose={closeSignOut}
      />

      {profile ? (
        <OptionSheet
          visible={photoSheet}
          title="Profile photo"
          options={photoOptions(profile, photo.hasPhoto)}
          value={null}
          onSelect={onPhotoAction}
          onClose={() => setPhotoSheet(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { height: 44, justifyContent: 'center', paddingHorizontal: gutter, marginBottom: space[2] },
  body: { paddingHorizontal: gutter, gap: space[7] },
  hero: { gap: space[4] },
  end: { gap: space[5] },
  skeleton: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
});
