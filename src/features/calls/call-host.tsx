import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import type { Call, Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors } from '@/theme/tokens';

import {
  abandonCalls,
  acceptCall,
  bindQueryClient,
  declineCall,
  isCallScreenOpen,
  ringIn,
  useCallStore,
} from './call-store';
import { CallBar } from './call-bar';
import { listenForRings } from './signal';
import { IncomingCallView } from './ui/incoming-view';

/** Mounted-host counter so a StrictMode / Fast Refresh remount is not mistaken for sign-out. */
let mountedHosts = 0;

/**
 * Mounted once at the root while signed in. Listens for rings addressed to the
 * user (realtime + cold-open / foreground catch-up) and presents the incoming
 * call above everything else. All decisions — busy, timeout, cancel — live in
 * the call store; this component only renders and forwards taps. It also floats the in-call
 * bar over the app while a call is minimized.
 */
export function CallHost() {
  const userId = useSession((s) => s.userId);
  const queryClient = useQueryClient();

  useEffect(() => {
    bindQueryClient(queryClient);
    return () => bindQueryClient(null);
  }, [queryClient]);

  useEffect(() => {
    if (!userId) return;
    return listenForRings(userId, ringIn);
  }, [userId]);

  useEffect(() => {
    mountedHosts += 1;
    return () => {
      mountedHosts -= 1;
      // Signed out (or the root unmounted): never leave a call or a ringtone running.
      setTimeout(() => {
        if (mountedHosts === 0) abandonCalls();
      }, 0);
    };
  }, []);

  return (
    <>
      <CallBar />
      <IncomingOverlay />
    </>
  );
}

type Snapshot = { call: Call; peer: Profile | null };

function IncomingOverlay() {
  const ringing = useCallStore((s) => (s.phase === 'incoming' ? s.call : null));
  const peer = useCallStore((s) => s.peer);

  // Keep the last ring on screen while the modal fades out, so the exit never flashes an empty name.
  const [shown, setShown] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (ringing) setShown({ call: ringing, peer });
  }, [ringing, peer]);

  const onAccept = () => {
    const id = acceptCall();
    if (id && !isCallScreenOpen(id)) router.push({ pathname: '/call/[id]', params: { id } });
  };

  return (
    // A native Modal is its own window on Android, so it reliably sits above the router stack.
    <Modal
      visible={ringing !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      // Back does nothing while ringing: the choice is Accept or Decline.
      onRequestClose={() => {}}>
      <StatusBar style={shown?.call.kind === 'video' ? 'light' : 'dark'} />
      {shown ? (
        <IncomingCallView key={shown.call.id} call={shown.call} peer={shown.peer} onAccept={onAccept} onDecline={declineCall} />
      ) : (
        <View style={styles.blank} />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.canvas },
});
