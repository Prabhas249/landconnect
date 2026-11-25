import { RoomContext } from '@livekit/react-native';
import { useQuery } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Phone, Users, Video } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, BackHandler, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchConversation } from '@/data/chat';
import { qk } from '@/data/keys';
import { colors, gutter, palette, space } from '@/theme/tokens';
import { Label, Text } from '@/ui/text';

import { redial } from './actions';
import {
  acceptCall,
  declineCall,
  dismissCall,
  hangUp,
  minimizeCall,
  openCall,
  registerCallScreen,
  useCallStore,
} from './call-store';
import { PreCallControlBar } from './ui/controls';
import { DirectCall } from './ui/direct-call';
import {
  HERO_AVATAR,
  IncomingCallView,
  PeerHero,
  VIDEO_SURFACE,
  VideoBackdrop,
  rise,
  useRingingPreview,
} from './ui/incoming-view';
import { HEADER_SPACE } from './ui/live-header';
import { CallBackdrop, LIGHT_SURFACE, NoticeBanner, PrivacyLine, VIDEO_GLASS } from './ui/parts';
import { RoomCall } from './ui/room-call';
import { EndStateView, PermissionView, isErrorEnd, stepLabel, type EndActions } from './ui/states';

/** How long a plain end state (room left, declined ring) stays before the screen closes. */
const END_LINGER_MS = 1200;
/** A 1:1 summary offers "Call again" / "Message": it stays long enough to reach for them. */
const SUMMARY_LINGER_MS = 5000;
/** Error end states explain a problem; they wait longer (or for "Close"). */
const ERROR_LINGER_MS = 8000;

/** Call ids whose screen has already been popped. Closing runs from several effects (end
 * timer, "call no longer mine", back button); without this, dismissCall flips the store while
 * the pop animates, a second effect fires, and its router.back() pops the chat underneath. */
const closed = new Set<string>();

function closeScreen(id: string) {
  if (closed.has(id)) return;
  closed.add(id);
  dismissCall(id);
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Puts a live call away (button or system back): the store keeps media running and the global
 * in-call bar takes over. Not added to `closed`: the same id is pushed again to return.
 */
function minimize() {
  if (!minimizeCall()) return false;
  if (router.canGoBack()) router.back();
  else router.replace('/');
  return true;
}

function confirmCancel() {
  Alert.alert('Cancel this call?', undefined, [
    { text: 'Stay', style: 'cancel' },
    { text: 'Cancel call', style: 'destructive', onPress: hangUp },
  ]);
}

/**
 * The call screen for every phase. It never decides anything itself: it asks the
 * store to open the call, renders whatever phase the store is in, and closes once
 * the store reaches `ended`. Media lives in the store too, so unmounting this
 * screen mid-connect cannot orphan a microphone or camera.
 */
export function CallScreen({ id }: { id: string }) {
  const phase = useCallStore((s) => s.phase);
  const call = useCallStore((s) => s.call);
  const openingId = useCallStore((s) => s.openingId);
  const room = useCallStore((s) => s.room);
  const peer = useCallStore((s) => s.peer);
  const isRoom = useCallStore((s) => s.isRoom);
  const micBlocked = useCallStore((s) => s.micBlocked);
  const endReason = useCallStore((s) => s.endReason);
  const endDetail = useCallStore((s) => s.endDetail);
  const notice = useCallStore((s) => s.notice);
  const isVideoCall = useCallStore((s) => s.call?.kind === 'video');
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [redialing, setRedialing] = useState(false);

  /** Does the store currently describe *this* screen's call? */
  const holds = call?.id === id || (call === null && phase === 'ended');

  useEffect(() => {
    // A room session id can be pushed again after this screen closed once (leave, then re-join).
    closed.delete(id);
    return registerCallScreen(id);
  }, [id]);
  useEffect(() => {
    openCall(id);
  }, [id]);

  const actions = phase === 'ended' && holds ? endActions(id, isRoom, endReason, redialing, setRedialing) : undefined;
  const hasActions = !!actions;

  // Ended → linger → close (back to the chat). Only the focused screen navigates.
  useEffect(() => {
    if (!focused || !holds || phase !== 'ended' || redialing) return;
    const linger = isErrorEnd(endReason) ? ERROR_LINGER_MS : hasActions ? SUMMARY_LINGER_MS : END_LINGER_MS;
    const timer = setTimeout(() => closeScreen(id), linger);
    return () => clearTimeout(timer);
  }, [focused, holds, phase, endReason, id, redialing, hasActions]);

  // A screen whose call is no longer in the store (a newer call took over while it sat
  // underneath) closes itself as soon as it is visible again. Read live state: this runs
  // in the same commit as `openCall`, which has already claimed the id synchronously.
  useEffect(() => {
    if (!focused) return;
    const s = useCallStore.getState();
    const mine = s.call?.id === id || s.openingId === id || (s.call === null && s.phase === 'ended');
    if (!mine) closeScreen(id);
  }, [focused, holds, openingId, id]);

  // Android back: a live call minimizes (it keeps running); a ringing-out call asks to cancel.
  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = useCallStore.getState();
      if (s.call?.id !== id && !(s.call === null && s.phase === 'ended')) return false;
      if (s.phase === 'ended') {
        closeScreen(id);
        return true;
      }
      if (s.phase === 'incoming') return true;
      if (s.phase === 'connecting' || s.phase === 'connected') {
        if (!minimize()) hangUp();
        return true;
      }
      if (s.phase === 'outgoing') {
        confirmCancel();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [focused, id]);

  let content;
  // Which view is up. Each change cross-fades in, so ringing → connected reads as one calm settle.
  let view: string;
  if (!holds) {
    view = 'pre';
    content = <PreCallView loading />;
  } else if (phase === 'ended') {
    view = 'ended';
    content = (
      <EndStateView
        reason={endReason}
        detail={endDetail}
        peer={peer}
        isRoom={isRoom}
        onClose={() => closeScreen(id)}
        actions={actions}
      />
    );
  } else if (micBlocked) {
    view = 'permission';
    content = <PermissionView onEnd={hangUp} />;
  } else if (phase === 'incoming' && call) {
    view = 'incoming';
    content = <IncomingCallView call={call} peer={peer} onAccept={acceptCall} onDecline={declineCall} />;
  } else if (phase === 'outgoing' || !room) {
    view = 'pre';
    content = <PreCallView />;
  } else {
    view = 'live';
    content = (
      <RoomContext.Provider value={room}>
        {isRoom ? <RoomCall onMinimize={minimize} /> : <DirectCall onMinimize={minimize} />}
      </RoomContext.Provider>
    );
  }

  // Video calls stay on a dark surface while ringing and live: it frames a camera, never a light page.
  const dark = isVideoCall && (view === 'pre' || view === 'incoming' || view === 'live');

  return (
    <View style={[styles.screen, dark ? styles.darkScreen : null]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Animated.View key={view} entering={FadeIn.duration(320)} style={styles.fill}>
        {content}
      </Animated.View>
      <View pointerEvents="none" style={[styles.notice, { top: insets.top + HEADER_SPACE + space[4] }]}>
        <NoticeBanner message={notice} onVideo={dark} />
      </View>
    </View>
  );
}

/** "Call again" / "Message" for a finished 1:1 call (not for errors, rooms or a stale link). */
function endActions(
  id: string,
  isRoom: boolean,
  reason: ReturnType<typeof useCallStore.getState>['endReason'],
  busy: boolean,
  setBusy: (busy: boolean) => void,
): EndActions | undefined {
  const { call, role } = useCallStore.getState();
  if (!call || isRoom || isErrorEnd(reason) || reason === 'unavailable') return undefined;
  const conversationId = call.conversation_id;
  return {
    kind: call.kind === 'video' ? 'video' : 'audio',
    againLabel: role === 'callee' ? 'Call back' : 'Call again',
    busy,
    onCallAgain: () => {
      setBusy(true);
      closed.add(id);
      redial(conversationId, call.kind).then((ok) => {
        if (ok) return;
        closed.delete(id);
        setBusy(false);
      });
    },
    onMessage: () => {
      if (closed.has(id)) return;
      closed.add(id);
      dismissCall(id);
      // Back to the chat if it is underneath, otherwise the chat replaces this screen.
      router.dismissTo({ pathname: '/chat/[id]', params: { id: conversationId } });
    },
  };
}

// ── before media: outgoing ring, permission check, token, or loading the row

function useRingingLabel() {
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRinging(true), 2200);
    return () => clearTimeout(timer);
  }, []);
  return ringing ? 'Ringing…' : 'Calling…';
}

function PreCallView({ loading = false }: { loading?: boolean }) {
  const insets = useSafeAreaInsets();
  const call = useCallStore((s) => s.call);
  const phase = useCallStore((s) => s.phase);
  const step = useCallStore((s) => s.step);
  const peer = useCallStore((s) => s.peer);
  const isRoom = useCallStore((s) => s.isRoom);
  const preview = useRingingPreview();
  const ringingLabel = useRingingLabel();

  const outgoing = !loading && phase === 'outgoing';
  const status = loading ? 'Connecting…' : outgoing ? ringingLabel : stepLabel(step);
  const video = call?.kind === 'video';
  // Your own camera full-bleed while it rings; the identity shrinks to the top so the face stays clear.
  const showPreview = video && !!preview.url;
  const kindLabel = isRoom ? 'LandConnect meeting room' : video ? 'LandConnect video call' : 'LandConnect audio call';
  const kindInk = video ? palette.white : palette.green;

  return (
    <View style={styles.fill}>
      {video ? <VideoBackdrop url={preview.url} mirror={preview.mirror} /> : <CallBackdrop />}

      <Animated.View entering={rise(0)} style={[styles.preTop, { paddingTop: insets.top + space[6] }]}>
        <View style={styles.kind}>
          {video ? (
            <Video size={13} color={kindInk} strokeWidth={2.4} />
          ) : isRoom ? (
            <Users size={13} color={kindInk} strokeWidth={2.4} />
          ) : (
            <Phone size={13} color={kindInk} strokeWidth={2.4} />
          )}
          <Label tone={video ? 'onDark' : 'accent'}>{loading ? 'LandConnect call' : kindLabel}</Label>
        </View>
      </Animated.View>

      {isRoom && call ? (
        <RoomHero conversationId={call.conversation_id} status={status} onVideo={video} />
      ) : (
        <PeerHero peer={loading ? null : peer} status={status} onVideo={video} compact={showPreview} />
      )}
      {showPreview && !isRoom ? <View style={styles.fill} /> : null}

      <Animated.View entering={rise(2)} style={[styles.preBottom, { paddingBottom: Math.max(insets.bottom, space[4]) + space[8] }]}>
        <PrivacyLine onVideo={video} />
        <PreCallControlBar
          isVideo={video}
          endLabel={outgoing ? 'Cancel' : 'End'}
          onEnd={hangUp}
          onVideo={video}
          disabled={loading}
        />
      </Animated.View>
    </View>
  );
}

function RoomHero({ conversationId, status, onVideo = false }: { conversationId: string; status: string; onVideo?: boolean }) {
  const { data } = useQuery({ queryKey: qk.conversation(conversationId), queryFn: () => fetchConversation(conversationId) });
  return (
    <View style={styles.roomHero}>
      <View style={[styles.roomBadge, onVideo ? { backgroundColor: VIDEO_GLASS } : LIGHT_SURFACE]}>
        <View style={styles.roomDisc}>
          <Users size={40} color={palette.white} strokeWidth={2} />
        </View>
      </View>
      <View style={styles.identity}>
        <Text variant="display" tone={onVideo ? 'onDark' : 'ink'} center numberOfLines={2}>
          {data?.title ?? 'Meeting room'}
        </Text>
        <Text variant="body" tone={onVideo ? 'onDark' : 'secondary'} center>
          {status}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  darkScreen: { backgroundColor: VIDEO_SURFACE },
  fill: { flex: 1 },
  notice: { position: 'absolute', left: gutter, right: gutter, alignItems: 'center' },
  preTop: { alignItems: 'center', paddingHorizontal: gutter },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preBottom: { alignItems: 'center', gap: space[8], paddingHorizontal: gutter },
  roomHero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[6], paddingHorizontal: gutter },
  roomBadge: {
    width: HERO_AVATAR,
    height: HERO_AVATAR,
    borderRadius: HERO_AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[2],
  },
  roomDisc: { flex: 1, alignSelf: 'stretch', borderRadius: HERO_AVATAR, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.green },
  identity: { alignItems: 'center', gap: space[2] },
});
