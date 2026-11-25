import { router } from 'expo-router';
import { EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';

import type { Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Enter } from '@/ui/enter';
import { Field } from '@/ui/field';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { StackTopBar, useStackContentTop } from './chrome';
import { reportError } from './parts';

function EditForm({ profile }: { profile: Profile }) {
  const updateProfile = useSession((s) => s.updateProfile);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(profile.display_name);
  const [city, setCity] = useState(profile.city ?? '');
  const [about, setAbout] = useState(profile.about ?? '');

  const dirty =
    name.trim() !== profile.display_name || (city.trim() || null) !== profile.city || (about.trim() || null) !== profile.about;

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      Alert.alert('Add a name', 'Your display name needs at least two characters.');
      return;
    }
    setSaving(true);
    const err = await updateProfile({ display_name: trimmed, city: city.trim() || null, about: about.trim() || null });
    setSaving(false);
    if (err) reportError(err);
    else router.back();
  };

  return (
    <>
      <Enter index={0}>
        <Card padding={5} style={styles.form}>
          <Field label="Display name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={40} returnKeyType="next" />
          {profile.show_real_name ? null : (
            <View style={styles.note}>
              <EyeOff size={14} color={colors.inkTertiary} strokeWidth={2.2} />
              <Text variant="caption" tone="tertiary" style={styles.flex}>
                Hidden while you are anonymous. Others see {profile.handle}.
              </Text>
            </View>
          )}
          <Field label="City" value={city} onChangeText={setCity} autoCapitalize="words" maxLength={40} placeholder="Bengaluru" />
          <Field
            label="About"
            value={about}
            onChangeText={setAbout}
            multiline
            maxLength={240}
            placeholder="What you are looking for, or what you hold."
            hint={`${about.length} of 240. Shown on your profile card.`}
          />
        </Card>
      </Enter>
      <Enter index={1}>
        <Button label="Save changes" variant="accent" haptic="medium" disabled={!dirty} loading={saving} onPress={save} />
      </Enter>
    </>
  );
}

/** Name, city and about. Saves through the optimistic session store, then returns to the profile. */
export default function EditProfileScreen() {
  const insets = useScreenInsets();
  const contentTop = useStackContentTop();
  const profile = useSession((s) => s.profile);
  const scrollY = useSharedValue(0);

  return (
    <Screen>
      <KeyboardAwareScrollView
        bottomOffset={space[6]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => scrollY.set(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={[styles.content, { paddingTop: contentTop, paddingBottom: insets.bottom }]}>
        {profile ? (
          <EditForm profile={profile} />
        ) : (
          <>
            <View style={[styles.skeleton, { height: 320 }]} />
            <View style={[styles.skeleton, styles.buttonBone]} />
          </>
        )}
      </KeyboardAwareScrollView>
      <StackTopBar scrollY={scrollY} title="Edit profile" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter, gap: space[5] },
  form: { gap: space[4] },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[2] },
  skeleton: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
  buttonBone: { height: 56, borderRadius: radius.pill },
});
