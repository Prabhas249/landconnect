import { CloudOff, MessageSquareText, MicOff, Phone, PhoneOff, RotateCcw, ServerCrash, Settings, Users, Video } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { publicName } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { colors, gutter, palette, radius, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Enter } from '@/ui/enter';
import { Label, Text } from '@/ui/text';

import type { ConnectStep, EndReason } from '../call-store';
import { retryPermissions } from '../call-store';
import { CALM_RED, CallBackdrop, IdChip, LIGHT_SURFACE, NightPill, RoundButton, roundInk } from './parts';

export const END_TITLE: Record<EndReason, string> = {
  ended: 'Call ended',
  left: 'You left the room',
  declined: 'Declined',
  'no-answer': 'No answer',
  missed: 'Missed call',
  cancelled: 'Call cancelled',
  unavailable: 'Unavailable',
  'not-configured': 'Calling is not configured on the server yet',
  failed: 'Call failed',
};

export function stepLabel(step: ConnectStep | null) {
  if (step === 'permissions') return 'Checking microphone…';
  if (step === 'securing') return 'Securing the line…';
  return 'Connecting…';
}

/** Reasons that explain a problem and wait for the user, instead of closing by themselves. */
export const isErrorEnd = (reason: EndReason | undefined) => reason === 'not-configured' || reason === 'failed';

export type EndActions = {
  kind: 'audio' | 'video';
  /** "Call again" for the caller, "Call back" for the callee. */
  againLabel: string;
  onCallAgain: () => void;
  onMessage: () => void;
  /** A redial is being placed: both actions wait. */
  busy?: boolean;
};

function Badge({ children }: { children: ReactNode }) {
  return <View style={[styles.badge, LIGHT_SURFACE]}>{children}</View>;
}

export function EndStateView({
  reason = 'ended',
  detail,
  peer,
  isRoom,
  onClose,
  actions,
}: {
  reason?: EndReason;
  detail?: string;
  peer: Profile | null;
  isRoom: boolean;
  onClose: () => void;
  /** 1:1 summaries offer calling again or moving the conversation to chat. */
  actions?: EndActions;
}) {
  const error = isErrorEnd(reason);
  const isDuration = reason === 'ended' && !!detail && /^\d/.test(detail);
  const icon = reason === 'not-configured' ? ServerCrash : reason === 'failed' ? CloudOff : isRoom ? Users : PhoneOff;
  const Icon = icon;

  return (
    <View style={styles.fill}>
      <CallBackdrop glowY={0.42} />
      <Enter style={styles.center}>
        {peer && !error ? (
          <View style={styles.endAvatar}>
            <Avatar name={publicName(peer)} seed={peer.id} uri={peer.avatar_url} size={80} />
            <View style={styles.endBadge}>
              <Icon size={13} color={palette.white} strokeWidth={2.4} />
            </View>
          </View>
        ) : (
          <Badge>
            <Icon size={28} color={error ? colors.highlight : CALM_RED} strokeWidth={2.1} />
          </Badge>
        )}
        <View style={styles.copy}>
          <Text variant="title" center>
            {END_TITLE[reason]}
          </Text>
          {peer && !error && !isRoom ? (
            <View style={styles.endMeta}>
              <Text variant="body" tone="secondary" numberOfLines={1}>
                {publicName(peer)}
              </Text>
              <IdChip handle={peer.handle} role={peer.role} />
            </View>
          ) : null}
          {isDuration ? (
            <View style={[styles.duration, LIGHT_SURFACE]}>
              <Label>Duration</Label>
              <Text variant="figure" style={styles.tabular}>
                {detail}
              </Text>
            </View>
          ) : null}
          {detail && !isDuration ? (
            <Text variant="caption" tone="secondary" center>
              {detail}
            </Text>
          ) : null}
          {reason === 'not-configured' ? (
            <Text variant="caption" tone="secondary" center>
              Add the LiveKit URL, key and secret to the livekit-token function, then try again.
            </Text>
          ) : null}
        </View>
        {actions ? (
          <View style={styles.row}>
            <NightPill
              label={actions.againLabel}
              tone="accent"
              onPress={actions.busy ? () => {} : actions.onCallAgain}
              leading={
                actions.kind === 'video' ? (
                  <Video size={16} color={colors.inkOnDark} strokeWidth={2.2} />
                ) : (
                  <Phone size={16} color={colors.inkOnDark} strokeWidth={2.2} />
                )
              }
            />
            <NightPill
              label="Message"
              onPress={actions.busy ? () => {} : actions.onMessage}
              leading={<MessageSquareText size={16} color={colors.ink} strokeWidth={2.2} />}
            />
          </View>
        ) : null}
        {error ? <NightPill label="Close" onPress={onClose} /> : null}
      </Enter>
    </View>
  );
}

/** Blocking state when the microphone permission is denied. The call stays up while the user fixes it. */
export function PermissionView({ onEnd }: { onEnd: () => void }) {
  const insets = useSafeAreaInsets();

  // Coming back from Settings re-checks quietly (no dialog), and continues if access was granted.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') retryPermissions({ prompt: false });
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={[styles.fill, { paddingBottom: Math.max(insets.bottom, space[4]) + space[8] }]}>
      <CallBackdrop />
      <Enter style={styles.center}>
        <Badge>
          <MicOff size={28} color={colors.highlight} strokeWidth={2.1} />
        </Badge>
        <View style={styles.copy}>
          <Label tone="highlight">Permission needed</Label>
          <Text variant="title" center>
            Microphone access is off
          </Text>
          <Text variant="caption" tone="secondary" center>
            LandConnect needs the microphone to carry your voice. Allow it in Settings, then come back — the call
            continues from here.
          </Text>
        </View>
        <View style={styles.row}>
          <NightPill
            label="Open settings"
            tone="accent"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
            leading={<Settings size={16} color={colors.inkOnDark} strokeWidth={2.2} />}
          />
          <NightPill
            label="Try again"
            onPress={() => {
              retryPermissions();
            }}
            leading={<RotateCcw size={16} color={colors.ink} strokeWidth={2.2} />}
          />
        </View>
      </Enter>
      <RoundButton
        label="End call"
        caption
        tone="danger"
        size={64}
        onPress={onEnd}
        icon={<PhoneOff size={26} color={roundInk('danger')} strokeWidth={2.2} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: gutter, gap: space[8] },
  center: { alignItems: 'center', gap: space[5] },
  copy: { alignItems: 'center', gap: space[2], maxWidth: 320 },
  row: { flexDirection: 'row', gap: space[3] },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 4,
    backgroundColor: palette.white,
    boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 12px 32px rgba(16,32,28,0.10)',
  },
  endBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CALM_RED,
  },
  endMeta: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  duration: {
    marginTop: space[3],
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  tabular: { fontVariant: ['tabular-nums'] },
});
