import { RTCView } from '@livekit/react-native-webrtc';
import { BadgeCheck, MessageSquareText, Phone, PhoneOff, Video } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { publicName } from '@/lib/format';
import { ROLE_COPY, type Call, type Profile } from '@/lib/types';
import { colors, gutter, palette, radius, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Label, Text } from '@/ui/text';

import { declineWithMessage, useCallStore } from '../call-store';
import { streamURL } from '../media';
import { CallBackdrop, IdChip, NightPill, PrivacyLine, PulseRings, RoundButton, VideoScrims, roundInk } from './parts';
import { QuickReplies } from './quick-replies';

export const HERO_AVATAR = 128;
/** Small identity avatar used over a full-bleed camera preview, so the face stays visible. */
const COMPACT_AVATAR = 72;
/** Surface behind a video call before any frame arrives. Never light: it frames a camera. */
export const VIDEO_SURFACE = '#0B0F0E';

/**
 * Video calls before media is live: your own camera full-bleed (mirrored on the front lens), with
 * only dark top/bottom scrims for legibility. Falls back to a plain dark surface without a camera.
 * Returns whether a preview is actually showing, so the caller can pick the compact layout.
 */
export function useRingingPreview() {
  const preview = useCallStore((s) => s.preview);
  const facing = useCallStore((s) => s.facing);
  return { url: streamURL(preview), mirror: facing === 'user' };
}

export function VideoBackdrop({ url, mirror }: { url: string | undefined; mirror: boolean }) {
  const { height } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: VIDEO_SURFACE }]}>
      {url ? <RTCView streamURL={url} mirror={mirror} objectFit="cover" zOrder={0} style={StyleSheet.absoluteFill} /> : null}
      <VideoScrims top={height * 0.36} bottom={height * 0.4} />
    </View>
  );
}

/** "Seller · Devanahalli" — role and city only; never a contact detail. */
export function peerSubtitle(peer: Profile | null) {
  if (!peer) return ' ';
  const role = ROLE_COPY[peer.role]?.label ?? 'Member';
  return peer.city ? `${role} · ${peer.city}` : role;
}

/** Calm staggered fade-up on the shared layout spring (reduced motion: the system setting skips it). */
export function rise(index: number) {
  return FadeInDown.delay(60 + index * 60)
    .springify()
    .damping(spring.layout.damping)
    .stiffness(spring.layout.stiffness)
    .mass(spring.layout.mass)
    .overshootClamping(1)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] });
}

/**
 * Caller identity block: mint rings, avatar on a white ring, public name, anonymous ID, role.
 * `onVideo`: drawn over a camera feed — no rings, no white ring, white text. `compact`: small and
 * at the top, so the full-bleed camera preview stays visible.
 */
export function PeerHero({
  peer,
  status,
  ringing = true,
  onVideo = false,
  compact = false,
}: {
  peer: Profile | null;
  status?: string;
  ringing?: boolean;
  onVideo?: boolean;
  compact?: boolean;
}) {
  const size = compact ? COMPACT_AVATAR : HERO_AVATAR;
  const avatar = peer ? (
    onVideo ? (
      <Avatar name={publicName(peer)} seed={peer.id} uri={peer.avatar_url} size={size} />
    ) : (
      <View style={styles.avatarRing}>
        <Avatar name={publicName(peer)} seed={peer.id} uri={peer.avatar_url} size={HERO_AVATAR - 8} />
      </View>
    )
  ) : (
    <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: size / 2 }, onVideo ? styles.videoPlaceholder : null]} />
  );
  const textTone = onVideo ? 'onDark' : 'secondary';
  return (
    <View style={compact ? styles.heroCompact : styles.hero}>
      <View style={[styles.avatarSlot, { width: size, height: size }]}>
        {ringing && !onVideo ? <PulseRings size={HERO_AVATAR}>{avatar}</PulseRings> : avatar}
      </View>
      <View style={styles.identity}>
        {peer ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.identityInner}>
            <View style={styles.nameRow}>
              <Text
                variant="display"
                tone={onVideo ? 'onDark' : 'ink'}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={styles.name}>
                {publicName(peer)}
              </Text>
              {peer.verified ? <BadgeCheck size={22} color={palette.white} fill={palette.green} strokeWidth={2.2} /> : null}
            </View>
            <View style={styles.metaRow}>
              <IdChip handle={peer.handle} role={peer.role} onVideo={onVideo} />
              <Text variant="body" tone={textTone} numberOfLines={1}>
                {status ?? peerSubtitle(peer)}
              </Text>
            </View>
          </Animated.View>
        ) : (
          <>
            <View style={[styles.namePlaceholder, onVideo ? styles.videoPlaceholder : null]} />
            <Text variant="body" tone={textTone} numberOfLines={1}>
              {status ?? ' '}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

export type IncomingCallViewProps = {
  call: Call;
  peer: Profile | null;
  onAccept: () => void;
  onDecline: () => void;
};

/** Full-screen ringing UI. Used by the global overlay and, as a fallback, by the call screen. */
export function IncomingCallView({ call, peer, onAccept, onDecline }: IncomingCallViewProps) {
  const insets = useSafeAreaInsets();
  const video = call.kind === 'video';
  const preview = useRingingPreview();
  const showPreview = video && !!preview.url;
  const iconProps = { size: 28, strokeWidth: 2.2 } as const;
  const kindInk = video ? palette.white : palette.green;
  const [replying, setReplying] = useState(false);

  return (
    <View style={[styles.fill, video ? styles.videoFill : null]}>
      {video ? <VideoBackdrop url={preview.url} mirror={preview.mirror} /> : <CallBackdrop />}
      <Animated.View entering={rise(0)} style={[styles.top, { paddingTop: insets.top + space[6] }]}>
        <View style={styles.kind}>
          {video ? <Video size={13} color={kindInk} strokeWidth={2.4} /> : <Phone size={13} color={kindInk} strokeWidth={2.4} />}
          <Label tone={video ? 'onDark' : 'accent'}>{video ? 'Incoming video call' : 'Incoming call'}</Label>
        </View>
      </Animated.View>

      <PeerHero peer={peer} onVideo={video} compact={showPreview} />
      {showPreview ? <View style={styles.spacer} /> : null}

      <Animated.View entering={rise(2)} style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space[4]) + space[8] }]}>
        {replying ? (
          <QuickReplies onVideo={video} onPick={declineWithMessage} onCancel={() => setReplying(false)} />
        ) : (
          <>
            <PrivacyLine onVideo={video} />
            <NightPill
              label="Reply with a message"
              onVideo={video}
              onPress={() => setReplying(true)}
              leading={<MessageSquareText size={16} color={video ? palette.white : colors.ink} strokeWidth={2.2} />}
            />
            <View style={styles.actions}>
              <RoundButton
                label="Decline"
                caption
                tone="danger"
                size={72}
                onVideo={video}
                icon={<PhoneOff {...iconProps} color={roundInk('danger')} />}
                onPress={onDecline}
              />
              <RoundButton
                label="Accept"
                caption
                tone="accent"
                size={72}
                onVideo={video}
                icon={video ? <Video {...iconProps} color={roundInk('accent')} /> : <Phone {...iconProps} color={roundInk('accent')} />}
                onPress={onAccept}
              />
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.canvas },
  videoFill: { backgroundColor: VIDEO_SURFACE },
  spacer: { flex: 1 },
  heroCompact: { alignItems: 'center', gap: space[4], paddingTop: space[6] },
  videoPlaceholder: { backgroundColor: 'rgba(255,255,255,0.12)' },
  top: { alignItems: 'center', paddingHorizontal: gutter },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[8] },
  avatarSlot: { width: HERO_AVATAR, height: HERO_AVATAR, alignItems: 'center', justifyContent: 'center' },
  avatarRing: {
    width: HERO_AVATAR,
    height: HERO_AVATAR,
    borderRadius: HERO_AVATAR / 2,
    padding: 4,
    backgroundColor: palette.white,
    boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 16px 36px rgba(16,32,28,0.12)',
  },
  identity: { alignItems: 'center', gap: space[3], paddingHorizontal: gutter },
  identityInner: { alignItems: 'center', gap: space[3], maxWidth: '100%' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' },
  name: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  namePlaceholder: { width: 180, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  avatarPlaceholder: { width: HERO_AVATAR, height: HERO_AVATAR, borderRadius: HERO_AVATAR / 2, backgroundColor: colors.surfaceSunken },
  bottom: { alignItems: 'center', gap: space[6], paddingHorizontal: gutter },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: space[10] },
});
