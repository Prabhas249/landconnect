import { CheckCheck, Lock, Phone, Video } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useReducedMotion, withSpring, withTiming } from 'react-native-reanimated';

import { formatPresence } from '@/lib/format';
import { ROLE_COPY, type Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, radius, shadow, space, spring } from '@/theme/tokens';
import { Avatar, AVATAR_SIZE } from '@/ui/avatar';
import { Card } from '@/ui/card';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';

import { LIGHT_CARD, reportError } from './parts';

const FACE_H = 48;

type Mode = 'handle' | 'real';

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'handle', label: 'Anonymous' },
  { value: 'real', label: 'Real name' },
];

type FaceProps = {
  name: string;
  seed: string;
  uri: string | null;
  anonymous: boolean;
  verified: boolean;
  role: string;
  presence: string;
  onColor: string;
};

function Face({ name, seed, uri, anonymous, verified, role, presence, onColor }: FaceProps) {
  return (
    <View style={styles.face}>
      <Avatar
        name={name}
        seed={seed}
        uri={uri}
        anonymous={anonymous}
        verified={verified}
        onColor={onColor}
        size={AVATAR_SIZE.md}
      />
      <View style={styles.faceCopy}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {role} · {presence}
        </Text>
      </View>
    </View>
  );
}

/**
 * The public identity row, split-flap style: flipping the setting turns the row over
 * on its horizontal axis to reveal the other identity. Both faces stay mounted so
 * the flip is pure transform + opacity on the UI thread.
 */
export function IdentityFlip({
  profile,
  height = FACE_H,
  onColor = colors.surfaceMuted,
}: {
  profile: Profile;
  height?: number;
  /** Surface behind the row, so the avatar's seal is cut cleanly out of it. */
  onColor?: string;
}) {
  const reduced = useReducedMotion();
  const real = profile.show_real_name;
  const p = useDerivedValue(() => (reduced ? withTiming(real ? 1 : 0, { duration: 0 }) : withSpring(real ? 1 : 0, spring.gentle)));

  const handleFace = useAnimatedStyle(() => ({
    opacity: p.get() < 0.5 ? 1 : 0,
    transform: [{ perspective: 600 }, { rotateX: `${p.get() * 180}deg` }],
  }));
  const realFace = useAnimatedStyle(() => ({
    opacity: p.get() >= 0.5 ? 1 : 0,
    transform: [{ perspective: 600 }, { rotateX: `${(p.get() - 1) * 180}deg` }],
  }));

  const role = ROLE_COPY[profile.role].label;
  const presence = formatPresence(profile) ?? 'last seen hidden';

  return (
    <View style={{ height }} accessibilityLabel={`Others see ${real ? profile.display_name : profile.handle}`}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.faceWrap, handleFace]}>
        {/* The anonymous face never carries the photo: a photo would undo the handle. */}
        <Face name={profile.handle} seed={profile.id} uri={null} anonymous verified={profile.verified} role={role} presence={presence} onColor={onColor} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.faceWrap, realFace]}>
        <Face
          name={profile.display_name}
          seed={profile.id}
          uri={profile.avatar_url}
          anonymous={false}
          verified={profile.verified}
          role={role}
          presence={presence}
          onColor={onColor}
        />
      </Animated.View>
    </View>
  );
}

/** Optimistic: the store patches first, so the row flips before the network answers and flips back on failure. */
function useNameMode(profile: Profile) {
  const updateProfile = useSession((s) => s.updateProfile);
  const mode: Mode = profile.show_real_name ? 'real' : 'handle';
  const onChange = async (next: Mode) => reportError(await updateProfile({ show_real_name: next === 'real' }));
  return { mode, onChange };
}

function visibilityLine(profile: Profile, mode: Mode) {
  const photo = !!profile.avatar_url;
  return mode === 'handle'
    ? `Others see only your handle. Your ${photo ? 'name and photo stay' : 'name stays'} with you.`
    : `Your ${photo ? 'name and photo are' : 'name is'} visible to people you talk to.`;
}

/**
 * Profile's "How others see you": the public identity row, the name switch and one
 * caption. The full mock of their screen lives on the Privacy screen. Headless.
 */
export function VisibilitySwitch({ profile }: { profile: Profile }) {
  const { mode, onChange } = useNameMode(profile);
  return (
    <Card padding={4} style={[styles.compact, LIGHT_CARD]}>
      <IdentityFlip profile={profile} onColor={colors.surface} />
      <Segmented options={MODES} value={mode} onChange={onChange} />
      <Text variant="caption" tone="secondary">
        {visibilityLine(profile, mode)}
      </Text>
    </Card>
  );
}

/**
 * A live mock of another participant's screen: your public identity, the call buttons
 * your call setting allows, and a message with the ticks your receipts setting sends.
 * Sized for a card with padding 4; pass `innerRadius` when the card's padding differs.
 */
export function TheirScreen({ profile, innerRadius = INNER }: { profile: Profile; innerRadius?: number }) {
  const callsOff = profile.allow_calls === 'nobody';
  return (
    <View style={[styles.stage, { borderRadius: innerRadius }]}>
      <View style={styles.stageHead}>
        <Text variant="captionStrong" tone="secondary">
          On their screen
        </Text>
        <View style={styles.relay}>
          <Lock size={12} color={colors.accent} strokeWidth={2.4} />
          <Text variant="captionStrong" tone="accent">
            Number hidden
          </Text>
        </View>
      </View>
      <View style={styles.stageRow}>
        <View style={styles.flex}>
          <IdentityFlip profile={profile} />
        </View>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Phone size={16} color={callsOff ? colors.inkTertiary : colors.accent} strokeWidth={2.1} />
          </View>
          <View style={styles.action}>
            <Video size={16} color={callsOff ? colors.inkTertiary : colors.accent} strokeWidth={2.1} />
          </View>
        </View>
      </View>
      <View style={styles.bubble}>
        <Text variant="caption" style={styles.flexShrink} numberOfLines={1}>
          {profile.role === 'buyer' ? 'A site visit on Saturday works for us.' : 'Is the RTC in the owner’s name?'}
        </Text>
        <CheckCheck size={14} color={profile.read_receipts ? colors.accent : colors.inkTertiary} strokeWidth={2.3} />
      </View>
    </View>
  );
}

// Card padding 4 (16) inside radius xl (28) leaves an inner radius of 12 (sm).
const INNER = radius.xl - space[4];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  compact: { gap: space[3] },
  flexShrink: { flexShrink: 1 },
  stage: {
    gap: space[3],
    padding: space[3],
    borderRadius: INNER,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  stageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  relay: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  faceWrap: { justifyContent: 'center', backfaceVisibility: 'hidden' },
  face: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  faceCopy: { flex: 1, gap: 1 },
  actions: { flexDirection: 'row', gap: space[2] },
  action: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.hair,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    alignSelf: 'flex-end',
    maxWidth: '86%',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderBottomRightRadius: radius.xs / 2,
    borderCurve: 'continuous',
    backgroundColor: colors.bubbleOut,
  },
});
