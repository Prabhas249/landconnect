import { router } from 'expo-router';
import { Alert } from 'react-native';

import { startCall, startRoomSession } from '@/data/calls';
import { errorMessage } from '@/lib/supabase';
import type { CallKind } from '@/lib/types';

import { useCallStore } from './call-store';

/**
 * One call at a time: while a call is up (usually minimized under the in-call bar), starting
 * another offers to return to it instead of silently ending it.
 */
function blockedByLiveCall(): boolean {
  const { phase, call } = useCallStore.getState();
  if (!call || (phase !== 'outgoing' && phase !== 'connecting' && phase !== 'connected')) return false;
  Alert.alert('You are already on a call', 'End it before starting another.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Return to call', onPress: () => openActiveCall() },
  ]);
  return true;
}

/** Brings the active call screen back (from the in-call bar or the busy prompt). */
export function openActiveCall() {
  const id = useCallStore.getState().call?.id;
  if (id) router.push({ pathname: '/call/[id]', params: { id } });
}

/** Ring the other person in a direct conversation and open the call screen. */
/** A call being placed (RPC in flight): a double tap must not ring twice and cancel the first. */
let placing = false;

export async function placeCall(conversationId: string, kind: CallKind) {
  if (placing || blockedByLiveCall()) return;
  placing = true;
  try {
    const call = await startCall(conversationId, kind);
    router.push({ pathname: '/call/[id]', params: { id: call.id } });
  } catch (e) {
    Alert.alert('Call unavailable', errorMessage(e));
  } finally {
    placing = false;
  }
}

/** Join (or start) the live session of a meeting room. */
export async function joinRoom(conversationId: string, kind: CallKind = 'video') {
  if (blockedByLiveCall()) return;
  try {
    const call = await startRoomSession(conversationId, kind);
    router.push({ pathname: '/call/[id]', params: { id: call.id } });
  } catch (e) {
    Alert.alert('Could not join', errorMessage(e));
  }
}

/** "Call again" from the end summary: the new call replaces the finished call screen. */
export async function redial(conversationId: string, kind: CallKind): Promise<boolean> {
  try {
    const call = await startCall(conversationId, kind);
    router.replace({ pathname: '/call/[id]', params: { id: call.id } });
    return true;
  } catch (e) {
    Alert.alert('Call unavailable', errorMessage(e));
    return false;
  }
}
