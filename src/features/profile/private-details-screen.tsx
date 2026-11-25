import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail, Phone } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';

import { qk } from '@/data/keys';
import { fetchMyPrivate, updateMyPrivate } from '@/data/profiles';
import { errorMessage } from '@/lib/supabase';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Enter } from '@/ui/enter';
import { Field } from '@/ui/field';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { StackTopBar, useStackContentTop } from './chrome';
import { maskEmail, maskPhone, reportError } from './parts';
import { SettingsCard, type SettingsItem } from './settings-list';

/** Email and phone: masked by default, revealable, phone editable. Only the owner can read this row. */
export default function PrivateDetailsScreen() {
  const insets = useScreenInsets();
  const contentTop = useStackContentTop();
  const qc = useQueryClient();
  const scrollY = useSharedValue(0);
  const { data, isPending, isError, refetch } = useQuery({ queryKey: qk.myPrivate, queryFn: fetchMyPrivate });
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');

  const save = useMutation({
    mutationFn: (value: string) => updateMyPrivate({ phone: value.trim() || null }),
    onSuccess: () => {
      setEditing(false);
      return qc.invalidateQueries({ queryKey: qk.myPrivate });
    },
    onError: (e) => reportError(errorMessage(e)),
  });

  const email = data?.email ?? null;
  const number = data?.phone ?? null;

  const items: SettingsItem[] = [
    {
      key: 'email',
      icon: Mail,
      title: 'Email',
      value: email ? (revealed ? email : maskEmail(email)) : 'Not on file',
      valueTone: email ? 'secondary' : 'tertiary',
      accessibilityLabel: email ? `Email, ${revealed ? email : 'hidden'}` : 'Email, not on file',
    },
    {
      key: 'phone',
      icon: Phone,
      title: 'Phone',
      value: number ? (revealed ? number : maskPhone(number)) : 'Not added',
      valueTone: number ? 'secondary' : 'tertiary',
      accessibilityLabel: number ? `Phone, ${revealed ? number : 'hidden'}` : 'Phone, not added',
      trailing: editing ? null : (
        <Button
          label={number ? 'Change' : 'Add'}
          variant="soft"
          size="sm"
          block={false}
          onPress={() => {
            setPhone(number ?? '');
            setEditing(true);
          }}
        />
      ),
    },
  ];

  return (
    <Screen>
      <KeyboardAwareScrollView
        bottomOffset={space[6]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => scrollY.set(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={[styles.content, { paddingTop: contentTop, paddingBottom: insets.bottom }]}>
        <Enter index={0}>
          <View style={styles.lead}>
            <View style={styles.leadIcon}>
              <Lock size={18} color={colors.accent} strokeWidth={2.2} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyStrong">Only you can see these</Text>
              <Text variant="caption" tone="secondary">
                They are never shown to other members, in chats, calls or listings.
              </Text>
            </View>
          </View>
        </Enter>

        <Enter index={1}>
          {isPending ? (
            <View style={styles.skeleton} />
          ) : isError ? (
            <Card padding={4} style={styles.failed}>
              <Text variant="caption" tone="secondary" style={styles.flex}>
                Your details could not be loaded right now.
              </Text>
              <Button label="Retry" variant="soft" size="sm" block={false} onPress={() => refetch()} />
            </Card>
          ) : (
            <View style={styles.stack}>
              <SettingsCard items={items} />
              {editing ? (
                <Card padding={5} style={styles.edit}>
                  <Field
                    label="Phone"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    maxLength={18}
                    placeholder="+91"
                    autoFocus
                  />
                  <View style={styles.actions}>
                    <Button
                      label="Cancel"
                      variant="soft"
                      size="md"
                      block={false}
                      disabled={save.isPending}
                      onPress={() => setEditing(false)}
                      style={styles.flex}
                    />
                    <Button
                      label="Save phone"
                      variant="accent"
                      size="md"
                      block={false}
                      loading={save.isPending}
                      onPress={() => save.mutate(phone)}
                      style={styles.flex}
                    />
                  </View>
                </Card>
              ) : null}
              {email || number ? (
                <Button
                  label={revealed ? 'Hide details' : 'Show details'}
                  variant="ghost"
                  size="sm"
                  leading={
                    revealed ? (
                      <EyeOff size={16} color={colors.inkSecondary} strokeWidth={2.2} />
                    ) : (
                      <Eye size={16} color={colors.inkSecondary} strokeWidth={2.2} />
                    )
                  }
                  onPress={() => setRevealed((v) => !v)}
                />
              ) : null}
            </View>
          )}
        </Enter>

        <Enter index={2}>
          <Text variant="caption" tone="tertiary" style={styles.foot}>
            Calls run through the LandConnect relay, so no one needs your number to reach you.
          </Text>
        </Enter>
      </KeyboardAwareScrollView>
      <StackTopBar scrollY={scrollY} title="Private details" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter, gap: space[5] },
  lead: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5] },
  leadIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: { gap: space[3] },
  edit: { gap: space[4] },
  actions: { flexDirection: 'row', gap: space[3] },
  failed: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  skeleton: { height: 128, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
  foot: { paddingHorizontal: space[5] },
});
