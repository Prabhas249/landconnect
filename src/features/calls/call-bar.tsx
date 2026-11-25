import { useQuery } from '@tanstack/react-query';
import { Mic, MicOff, PhoneOff, Users } from 'lucide-react-native';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchConversation } from '@/data/chat';
import { qk } from '@/data/keys';
import { publicName } from '@/lib/format';
import { TAB_BAR_HEIGHT, colors, gutter, palette, radius, shadow, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { openActiveCall } from './actions';
import { hangUp, toggleMic, useCallStore } from './call-store';
import { CALM_RED, CallTimer, SignalBars } from './ui/parts';
import { END_TITLE } from './ui/states';

const BAR_H = 60;
const BUTTON = 40;

/** Room title for the bar (rooms have no single peer). */
function useRoomTitle(conversationId: string | undefined, enabled: boolean) {
  const { data } = useQuery({
    queryKey: qk.conversation(conversationId ?? ''),
    queryFn: () => fetchConversation(conversationId ?? ''),
    enabled: enabled && !!conversationId,
  });
  return data?.title ?? 'Meeting room';
}

function BarStatus() {
  const phase = useCallStore((s) => s.phase);
  const since = useCallStore((s) => s.call?.answered_at ?? null);
  const reconnecting = useCallStore((s) => s.reconnecting);
  const micBlocked = useCallStore((s) => s.micBlocked);
  const endReason = useCallStore((s) => s.endReason);
  const endDetail = useCallStore((s) => s.endDetail);

  if (phase === 'ended') {
    const title = END_TITLE[endReason ?? 'ended'];
    return (
      <Text variant="caption" tone="onDarkSecondary" numberOfLines={1}>
        {endDetail && /^\d/.test(endDetail) ? `${title} · ${endDetail}` : title}
      </Text>
    );
  }
  const text = micBlocked ? 'Microphone needed · tap to fix' : reconnecting ? 'Reconnecting…' : phase === 'connecting' ? 'Connecting…' : null;
  if (text) {
    return (
      <Text variant="caption" tone={micBlocked || reconnecting ? 'highlight' : 'onDarkSecondary'} numberOfLines={1}>
        {text}
      </Text>
    );
  }
  return <CallTimer since={since} tone="onDarkSecondary" />;
}

/**
 * The minimized call, floating above every screen: who, how long, mute and end. Tap returns to
 * the call screen; drag it to the top or bottom edge (it snaps on a critically damped spring) so
 * it never sits on what you are reading. After the call ends it shows the outcome briefly, then
 * the store dismisses it.
 */
export function CallBar() {
  const visible = useCallStore((s) => s.minimized && !!s.call && s.phase !== 'idle');
  if (!visible) return null;
  return <FloatingBar />;
}

function FloatingBar() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const call = useCallStore((s) => s.call);
  const peer = useCallStore((s) => s.peer);
  const isRoom = useCallStore((s) => s.isRoom);
  const ended = useCallStore((s) => s.phase === 'ended');
  const wantMic = useCallStore((s) => s.wantMic);
  const quality = useCallStore((s) => s.quality);
  const roomTitle = useRoomTitle(call?.conversation_id, isRoom);
  const name = isRoom ? roomTitle : publicName(peer);

  const topY = insets.top + space[2];
  const bottomY = Math.max(topY, height - insets.bottom - TAB_BAR_HEIGHT - space[4] - BAR_H);
  const y = useSharedValue(topY);
  const startY = useSharedValue(0);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onBegin: () => {
      'worklet';
      startY.set(y.get());
    },
    onUpdate: (e) => {
      'worklet';
      y.set(Math.min(bottomY + space[4], Math.max(topY - space[4], startY.get() + e.translationY)));
    },
    onDeactivate: (e) => {
      'worklet';
      const projected = y.get() + e.velocityY * 0.12;
      y.set(withSpring(projected < (topY + bottomY) / 2 ? topY : bottomY, { ...spring.gentle, velocity: e.velocityY }));
    },
  });
  const position = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.host, position]}>
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ended ? `${name}, call ended` : `Return to call with ${name}`}
            disabled={ended}
            onPress={openActiveCall}
            style={styles.body}>
            {isRoom ? (
              <View style={styles.roomDisc}>
                <Users size={18} color={palette.white} strokeWidth={2.2} />
              </View>
            ) : (
              <Avatar name={name} seed={peer?.id} uri={peer?.avatar_url} size={36} onColor={palette.forest} />
            )}
            <View style={styles.copy}>
              <View style={styles.nameRow}>
                <Text variant="bodyStrong" tone="onDark" numberOfLines={1} style={styles.name}>
                  {name}
                </Text>
                {ended ? null : <SignalBars quality={quality} onVideo />}
              </View>
              <BarStatus />
            </View>
          </Pressable>
          {ended ? null : (
            <View style={styles.actions}>
              <PressableScale
                to={0.9}
                accessibilityLabel={wantMic ? 'Mute microphone' : 'Unmute microphone'}
                onPress={toggleMic}
                style={[styles.button, wantMic ? styles.buttonIdle : styles.buttonOn]}>
                {wantMic ? (
                  <Mic size={18} color={palette.white} strokeWidth={2.2} />
                ) : (
                  <MicOff size={18} color={colors.ink} strokeWidth={2.2} />
                )}
              </PressableScale>
              <PressableScale
                to={0.9}
                haptic="medium"
                accessibilityLabel={isRoom ? 'Leave room' : 'End call'}
                onPress={hangUp}
                style={[styles.button, styles.end]}>
                <PhoneOff size={18} color={palette.white} strokeWidth={2.2} />
              </PressableScale>
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 0, left: gutter, right: gutter },
  bar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[2],
    paddingRight: 10,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: palette.forest,
    boxShadow: shadow.float,
  },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], alignSelf: 'stretch' },
  roomDisc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.green },
  copy: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: space[2] },
  button: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
  buttonIdle: { backgroundColor: 'rgba(255,255,255,0.14)' },
  buttonOn: { backgroundColor: palette.white },
  end: { backgroundColor: CALM_RED },
});
