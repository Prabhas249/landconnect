import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, EyeOff, MessageCircleOff, PhoneOff, Undo2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { qk } from '@/data/keys';
import { fetchBlocked, setBlocked } from '@/data/profiles';
import { OptionSheet } from '@/features/listings/option-sheet';
import { publicName } from '@/lib/format';
import { errorMessage } from '@/lib/supabase';
import { ROLE_COPY, type Profile } from '@/lib/types';
import { colors, font, gutter, radius, shadow, space, type } from '@/theme/tokens';
import { Avatar, AVATAR_SIZE } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card, Divider } from '@/ui/card';
import { Enter } from '@/ui/enter';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { StackTopBar, useScrollY, useStackContentTop } from './chrome';
import { BlockedIllustration } from './graphics';
import { GroupHead, reportError, serialOf } from './parts';

const AnimatedList = Animated.createAnimatedComponent(FlashList<Profile>);

const ROW_PAD = space[3];
const ROW_H = ROW_PAD * 2 + AVATAR_SIZE.lg;
const UNDO_MS = 5000;

const EFFECTS = [
  { icon: MessageCircleOff, text: 'They can no longer message you.' },
  { icon: PhoneOff, text: 'They can no longer call you through the relay.' },
  { icon: EyeOff, text: 'You disappear from each other’s profile lookups.' },
] as const;

type Confirm = 'unblock' | 'keep';

function Row({ person, index, onUnblock }: { person: Profile; index: number; onUnblock: () => void }) {
  const anonymous = !person.show_real_name;
  const role = ROLE_COPY[person.role].label;
  const serial = serialOf(person.handle);
  return (
    <Enter index={index}>
      <Card padding={3} style={styles.row}>
        <Avatar
          profile={person}
          size={AVATAR_SIZE.lg}
          badge={
            <View style={styles.badge}>
              <Ban size={10} color={colors.inkOnDark} strokeWidth={2.6} />
            </View>
          }
        />
        <View style={styles.rowCopy}>
          {anonymous ? (
            // An anonymous participant is known only by their ID, so it leads, in mono.
            <Text style={styles.serialTitle} numberOfLines={1}>
              {serial}
            </Text>
          ) : (
            <Text variant="bodyStrong" numberOfLines={1}>
              {person.display_name}
            </Text>
          )}
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {anonymous ? (
              `${role} · real name hidden`
            ) : (
              <>
                {role} · <Text style={styles.serial}>{serial}</Text>
              </>
            )}
          </Text>
        </View>
        <Button label="Unblock" variant="soft" size="sm" block={false} onPress={onUnblock} />
      </Card>
    </Enter>
  );
}

function Effects() {
  return (
    <Card padding={4} tone="muted" elevated={false} style={styles.effects}>
      {EFFECTS.map((e, i) => (
        <View key={e.text}>
          {i > 0 ? <Divider inset={space[8] + space[3]} /> : null}
          <View style={styles.effect}>
            <View style={styles.effectIcon}>
              <e.icon size={16} color={colors.accent} strokeWidth={2.2} />
            </View>
            <Text variant="caption" tone="secondary" style={styles.flex}>
              {e.text}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function Skeleton({ top }: { top: number }) {
  return (
    <View style={[styles.list, { paddingTop: top }]}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeleton} />
      ))}
    </View>
  );
}

/** Floating confirmation after an unblock, with a one-tap way back. */
function UndoBar({ person, bottom, onUndo }: { person: Profile; bottom: number; onUndo: () => void }) {
  return (
    <Animated.View entering={FadeInDown.springify().damping(24).stiffness(220)} exiting={FadeOutDown.duration(180)} style={[styles.undo, { bottom }]}>
      <Text variant="captionStrong" tone="onDark" numberOfLines={1} style={styles.flex}>
        {publicName(person)} unblocked
      </Text>
      <PressableScale to={0.94} haptic="selection" onPress={onUndo} accessibilityLabel={`Undo, block ${publicName(person)} again`} style={styles.undoButton}>
        <Undo2 size={14} color={colors.accentBright} strokeWidth={2.4} />
        <Text variant="captionStrong" style={styles.undoLabel}>
          Undo
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

export default function BlockedScreen() {
  const insets = useScreenInsets();
  const contentTop = useStackContentTop();
  const { scrollY, onScroll } = useScrollY();
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey: qk.blocked, queryFn: fetchBlocked });
  const [asking, setAsking] = useState<Profile | null>(null);
  const [undo, setUndo] = useState<Profile | null>(null);

  // The row leaves at once; the server catches up, and a failure puts it back.
  const unblock = useMutation({
    mutationFn: (person: Profile) => setBlocked(person.id, false),
    onMutate: async (person) => {
      await qc.cancelQueries({ queryKey: qk.blocked });
      const prev = qc.getQueryData<Profile[]>(qk.blocked);
      qc.setQueryData<Profile[]>(qk.blocked, (list) => (list ?? []).filter((p) => p.id !== person.id));
      return { prev };
    },
    onSuccess: (_d, person) => setUndo(person),
    onError: (e, _person, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.blocked, ctx.prev);
      reportError(errorMessage(e, 'Please try again.'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.blocked }),
  });

  const reblock = useMutation({
    mutationFn: (person: Profile) => setBlocked(person.id, true),
    onMutate: async (person) => {
      setUndo(null);
      await qc.cancelQueries({ queryKey: qk.blocked });
      qc.setQueryData<Profile[]>(qk.blocked, (list) => [person, ...(list ?? []).filter((p) => p.id !== person.id)]);
    },
    onError: (e) => reportError(errorMessage(e, 'Please try again.')),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.blocked }),
  });

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const onConfirm = (choice: Confirm) => {
    const person = asking;
    setAsking(null);
    if (choice === 'unblock' && person) unblock.mutate(person);
  };

  const count = data?.length ?? 0;
  const askingName = asking ? publicName(asking) : '';

  return (
    <Screen>
      {isPending ? (
        <Skeleton top={contentTop} />
      ) : isError ? (
        <View style={[styles.center, { paddingTop: contentTop }]}>
          <Text variant="heading" center>
            Could not load this list
          </Text>
          <Text variant="body" tone="secondary" center>
            Check your connection and try again.
          </Text>
          <Button label="Try again" variant="soft" size="md" block={false} onPress={() => refetch()} />
        </View>
      ) : (
        <AnimatedList
          data={data}
          keyExtractor={(p) => p.id}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: contentTop, paddingBottom: insets.bottom + space[16] }}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={count > 0 ? <Header /> : null}
          ListEmptyComponent={<Empty />}
          ListFooterComponent={count > 0 ? <Footer /> : null}
          renderItem={({ item, index }) => <Row person={item} index={index + 1} onUnblock={() => setAsking(item)} />}
        />
      )}

      {undo ? <UndoBar person={undo} bottom={insets.bottom} onUndo={() => reblock.mutate(undo)} /> : null}

      <StackTopBar
        scrollY={scrollY}
        title="Blocked people"
        subtitle={count > 0 ? `${count} ${count === 1 ? 'person' : 'people'}` : undefined}
      />

      <OptionSheet<Confirm>
        visible={asking !== null}
        title={`Unblock ${askingName}?`}
        options={[
          { value: 'unblock', label: 'Unblock', hint: 'They can message and call you again. They are not told.' },
          { value: 'keep', label: 'Keep blocked' },
        ]}
        value={null}
        onSelect={onConfirm}
        onClose={() => setAsking(null)}
      />
    </Screen>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

function Header() {
  return (
    <Enter index={0}>
      <View style={styles.header}>
        <GroupHead title="Blocked by you" hint="They are not told. Unblocking takes effect at once." />
      </View>
    </Enter>
  );
}

function Footer() {
  return (
    <Enter index={4}>
      <View style={styles.footer}>
        <GroupHead title="While someone is blocked" />
        <Effects />
      </View>
    </Enter>
  );
}

function Empty() {
  return (
    <Enter>
      <View style={styles.empty}>
        <BlockedIllustration width={280} />
        <View style={styles.emptyCopy}>
          <Text variant="heading" center>
            No one is blocked
          </Text>
          <Text variant="body" tone="secondary" center>
            Block anyone from their profile or a chat. It is quiet and reversible, and the other person is not told.
          </Text>
        </View>
        <Effects />
      </View>
    </Enter>
  );
}

// Row card padding 12 inside radius xl (28).
const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: gutter, gap: space[3] },
  gap: { height: space[3] },
  skeleton: { height: ROW_H, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: ROW_H, paddingRight: space[4] },
  rowCopy: { flex: 1, gap: 2 },
  serialTitle: {
    fontFamily: font.mono,
    fontSize: type.bodyStrong.fontSize,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.ink,
  },
  // The handle is the one code-like string here, so it alone is set in mono.
  serial: { fontFamily: font.mono },
  badge: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3], paddingHorizontal: gutter },
  header: { paddingBottom: space[2] },
  empty: { alignItems: 'center', gap: space[6], paddingTop: space[4] },
  emptyCopy: { gap: space[2], paddingHorizontal: space[4] },
  effects: { alignSelf: 'stretch' },
  effect: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 48 },
  effectIcon: {
    width: space[8],
    height: space[8],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { gap: space[2], paddingTop: space[6] },
  undo: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 52,
    paddingLeft: space[5],
    paddingRight: space[2],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.ink,
    boxShadow: shadow.float,
  },
  undoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
  },
  undoLabel: { color: colors.accentBright },
});
