import type { QueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { LocalVideoTrack, Room } from 'livekit-client';
import { create } from 'zustand';

import { sendMessage } from '@/data/chat';
import { qk } from '@/data/keys';
import { fetchProfile } from '@/data/profiles';
import { formatDuration, publicName } from '@/lib/format';
import { errorMessage } from '@/lib/supabase';
import type { Call, CallStatus, Profile } from '@/lib/types';
import { useSession } from '@/stores/session';

import {
  CallMedia,
  MediaFailure,
  closePreview,
  flipPreview,
  hasCameraPermission,
  hasMicPermission,
  openPreview,
  requestCallPermissions,
  type Facing,
  type LinkQuality,
} from './media';
import {
  RING_TIMEOUT_MS,
  callDurationS,
  followCall,
  isTerminal,
  readCall,
  ringTimeLeft,
  transitionCall,
  tryTransition,
} from './signal';
import { playTone, stopTones } from './tones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  The active-call state machine. One call at a time, owned here, not by screens.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   idle ──ringIn()──────────────────▶ incoming ──acceptCall()──▶ connecting
 *   idle ──openCall(ringing, caller)─▶ outgoing ──row: accepted─▶ connecting
 *   idle ──openCall(accepted)────────────────────────────────────▶ connecting
 *   connecting ──LiveKit Connected──▶ connected
 *
 *   incoming   ──declineCall() / row terminal / 40 s──▶ idle    (overlay simply vanishes)
 *   outgoing   ──hangUp() / row terminal / 40 s───────▶ ended   ("Call cancelled", "Declined", "No answer")
 *   connecting ┐
 *   connected  ┴─hangUp() / row terminal / peer left / media failure──▶ ended
 *   ended ──dismissCall() (call screen / summary actions)──▶ idle
 *   ended ──(minimized: no call screen) END_BAR_MS──────▶ idle
 *
 * `minimized` is orthogonal to the phase: the call screen was put away while media stays
 * live, and the global in-call bar (`call-bar.tsx`) stands in for it.
 *
 * Rules that make the races safe:
 * - Every write to the `calls` row is compare-and-set (`signal.ts`), so "accept
 *   while the caller cancels" and "both hang up at once" each have one winner.
 * - Every async continuation captures `rt.gen` and drops itself if the active
 *   call changed meanwhile (hang-up mid-connect, a newer call, unmount).
 * - `finish()` is the only way into `ended` and is idempotent; it stops the
 *   follower and timers and disposes media (mic + camera + audio session).
 * - Ringtone, ringback and keep-awake are derived from `phase` by one store
 *   subscription at the bottom of this file, so they can never leak.
 * - While anything is live, a new ring is auto-rejected (busy).
 */

export type CallPhase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'connected' | 'ended';

export type EndReason =
  | 'ended' // normal hang-up, either side
  | 'left' // left a meeting room
  | 'declined'
  | 'no-answer' // caller: nobody picked up in 40 s
  | 'missed' // callee: caller gave up / answered too late
  | 'cancelled' // caller hung up before an answer
  | 'unavailable' // the call vanished, or the other side never joined media
  | 'not-configured' // LiveKit secrets missing on the server
  | 'failed'; // network / media error

export type ConnectStep = 'permissions' | 'securing' | 'joining';

export type CallState = {
  call: Call | null;
  phase: CallPhase;
  /** The other party of a 1:1 call (null for rooms). */
  peer: Profile | null;
  endReason?: EndReason;
  /** Error copy or the call length shown on the end screen. */
  endDetail?: string;
  role: 'caller' | 'callee' | null;
  isRoom: boolean;
  /** A call screen is resolving this id; counts as busy so a ring cannot sneak in. */
  openingId: string | null;
  /** LiveKit room while media is live — fed to `RoomContext` by the call screen. */
  room: Room | null;
  step: ConnectStep | null;
  /** Microphone permission denied: the call screen shows the blocking permission state. */
  micBlocked: boolean;
  /** Transient, calm banner (camera busy, permission off…). */
  notice: string | null;
  speaker: boolean;
  facing: Facing;
  /** Your own camera while a video call rings (caller and callee). */
  preview: LocalVideoTrack | null;
  /**
   * What the user chose for mic / camera. Before media is live these drive the controls and are
   * applied on connect; once `mediaLive`, LiveKit's own track state is shown instead.
   */
  wantMic: boolean;
  wantCamera: boolean;
  /** LiveKit connected and the initial tracks published: controls act on the room directly. */
  mediaLive: boolean;
  /** 1:1: the other side's media joined at least once. */
  peerJoined: boolean;
  /** The call screen was put away mid-call; the global in-call bar is showing instead. */
  minimized: boolean;
  /** LiveKit lost the media path and is re-establishing it (the call is still up). */
  reconnecting: boolean;
  quality: LinkQuality;
  /** 1:1: the other side's connection as LiveKit reports it. */
  peerQuality: LinkQuality;
};

const INITIAL: CallState = {
  call: null,
  phase: 'idle',
  peer: null,
  endReason: undefined,
  endDetail: undefined,
  role: null,
  isRoom: false,
  openingId: null,
  room: null,
  step: null,
  micBlocked: false,
  notice: null,
  speaker: false,
  facing: 'user',
  preview: null,
  wantMic: true,
  wantCamera: false,
  mediaLive: false,
  peerJoined: false,
  minimized: false,
  reconnecting: false,
  quality: 'unknown',
  peerQuality: 'unknown',
};

export const useCallStore = create<CallState>(() => ({ ...INITIAL }));

const get = useCallStore.getState;
const set = useCallStore.setState;

/** Imperative runtime that must not trigger renders. */
const rt = {
  /** Generation of the active call. Bumped whenever the active call changes or resets. */
  gen: 0,
  stopFollow: null as null | (() => void),
  ringTimer: null as ReturnType<typeof setTimeout> | null,
  joinTimer: null as ReturnType<typeof setTimeout> | null,
  noticeTimer: null as ReturnType<typeof setTimeout> | null,
  endTimer: null as ReturnType<typeof setTimeout> | null,
  media: null as CallMedia | null,
  /** Call ids this device has already rung / answered / rejected — never ring them again. */
  seen: new Set<string>(),
  /** Call ids whose chat log message was posted. */
  logged: new Set<string>(),
  /** Mounted call screens per call id (ref-counted so StrictMode remounts are harmless). */
  screens: new Map<string, number>(),
  queryClient: null as QueryClient | null,
};

/** The other side gets this long to join the LiveKit room after we connect. */
const PEER_JOIN_TIMEOUT_MS = 30_000;
const NOTICE_MS = 4500;
/** How long the minimized bar shows "Call ended · 4:12" before it goes away. */
const END_BAR_MS = 3200;

/** Quick replies offered when declining a ring (sent into the chat as a normal message). */
export const QUICK_REPLIES = ["Can't talk now, I'll call you back.", 'On my way.', 'Message me instead?'] as const;

const me = () => useSession.getState().userId;
const isLive = (phase: CallPhase) => phase === 'incoming' || phase === 'outgoing' || phase === 'connecting' || phase === 'connected';
const isBusy = () => isLive(get().phase) || get().openingId !== null;

function roleOf(call: Call): 'caller' | 'callee' {
  return call.caller_id === me() ? 'caller' : 'callee';
}

function reasonFor(status: CallStatus, role: 'caller' | 'callee' | null): EndReason {
  switch (status) {
    case 'rejected':
      return 'declined';
    case 'missed':
      return role === 'caller' ? 'no-answer' : 'missed';
    case 'cancelled':
      return role === 'caller' ? 'cancelled' : 'missed';
    default:
      return 'ended';
  }
}

function logStatusFor(reason: EndReason): CallStatus {
  if (reason === 'declined') return 'rejected';
  if (reason === 'no-answer' || reason === 'missed') return 'missed';
  if (reason === 'cancelled') return 'cancelled';
  return 'ended';
}

// ── runtime helpers

function clearTimer(key: 'ringTimer' | 'joinTimer' | 'noticeTimer' | 'endTimer') {
  const t = rt[key];
  if (t) clearTimeout(t);
  rt[key] = null;
}

/** Stops everything attached to the active call. Safe to call repeatedly. */
function stopRuntime() {
  rt.stopFollow?.();
  rt.stopFollow = null;
  clearTimer('ringTimer');
  clearTimer('joinTimer');
  clearTimer('noticeTimer');
  clearTimer('endTimer');
  const media = rt.media;
  rt.media = null;
  media?.dispose();
  closePreview(get().preview);
}

function resetToIdle() {
  stopRuntime();
  rt.gen += 1;
  set({ ...INITIAL });
}

/** Makes `call` the active call in `phase` and starts following its row. Returns the new generation. */
function adopt(call: Call, phase: CallPhase): number {
  stopRuntime();
  rt.gen += 1;
  const gen = rt.gen;
  const isRoom = call.callee_id === null;
  rt.seen.add(call.id);
  set({
    ...INITIAL,
    call,
    phase,
    role: roleOf(call),
    isRoom,
    // Video calls and rooms start on the loudspeaker, audio calls on the earpiece.
    speaker: call.kind === 'video' || isRoom,
    wantCamera: call.kind === 'video',
  });
  rt.stopFollow = followCall(call.id, (row) => onRemote(gen, row));
  if (!isRoom) {
    const peerId = roleOf(call) === 'caller' ? call.callee_id : call.caller_id;
    if (peerId) {
      fetchProfile(peerId)
        .then((peer) => {
          if (gen === rt.gen) set({ peer });
        })
        .catch(() => {});
    }
  }
  return gen;
}

function armRingTimeout(gen: number, call: Call) {
  clearTimer('ringTimer');
  rt.ringTimer = setTimeout(async () => {
    if (gen !== rt.gen) return;
    const phase = get().phase;
    if (phase !== 'incoming' && phase !== 'outgoing') return;
    if (phase === 'incoming') {
      tryTransition(call.id, 'missed', ['ringing']);
      finish(gen, 'missed', { live: true });
      return;
    }
    // Caller: the callee may have answered in the same instant. If the timeout loses the
    // compare-and-set, follow the real row (connect if accepted) instead of stranding the callee.
    const row = await tryTransition(call.id, 'missed', ['ringing']);
    if (gen !== rt.gen || get().phase !== 'outgoing') return;
    const latest = row ? null : await readCall(call.id);
    if (gen !== rt.gen || get().phase !== 'outgoing') return;
    if (latest && latest.status !== 'ringing') onRemote(gen, latest);
    else finish(gen, 'no-answer', { live: true });
  }, ringTimeLeft(call));
}

function showNotice(gen: number, message: string) {
  if (gen !== rt.gen) return;
  clearTimer('noticeTimer');
  set({ notice: message });
  rt.noticeTimer = setTimeout(() => {
    if (gen === rt.gen) set({ notice: null });
  }, NOTICE_MS);
}

/**
 * Writes the terminal status for a 1:1 row from whatever state it is in now:
 * an unanswered ring becomes cancelled (caller) / rejected (callee), an answered
 * call becomes ended. The likelier branch goes first; the other covers the race.
 */
function endRow(call: Call, role: 'caller' | 'callee' | null) {
  const unanswered = role === 'caller' ? 'cancelled' : 'rejected';
  const first = get().call?.id === call.id ? (get().call?.status ?? call.status) : call.status;
  if (first === 'ringing') {
    tryTransition(call.id, unanswered, ['ringing']).then((row) => row ?? tryTransition(call.id, 'ended', ['accepted']));
  } else {
    tryTransition(call.id, 'ended', ['accepted']).then((row) => row ?? tryTransition(call.id, unanswered, ['ringing']));
  }
}

// ── the only way into `ended`

function finish(gen: number, reason: EndReason, opts: { live?: boolean; detail?: string } = {}) {
  if (gen !== rt.gen) return;
  const s = get();
  if (!isLive(s.phase)) return; // already ended or idle — idempotent
  const call = s.call;
  const wasPhase = s.phase;
  stopRuntime();

  const duration = call ? callDurationS(call) : 0;
  // The caller posts exactly one log message for a 1:1 call it watched finish (not for old calls re-opened).
  if (call && opts.live && s.role === 'caller' && !s.isRoom) {
    postCallLog(call, logStatusFor(reason), duration, s.peerJoined);
  }

  try {
    if (reason === 'ended' || reason === 'left') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  } catch {}

  // A ring that never reached a call screen just disappears — nothing stale is left on screen.
  if (wasPhase === 'incoming' && !(call && (rt.screens.get(call.id) ?? 0) > 0)) {
    resetToIdle();
    return;
  }

  set({
    phase: 'ended',
    endReason: reason,
    endDetail: opts.detail ?? (reason === 'ended' && (s.peerJoined || duration > 0) ? formatDuration(duration) : undefined),
    room: null,
    preview: null,
    step: null,
    micBlocked: false,
    notice: null,
    reconnecting: false,
  });

  // Minimized: no call screen will dismiss this, so the bar's summary dismisses itself.
  if (s.minimized && call) {
    rt.endTimer = setTimeout(() => {
      if (gen === rt.gen) dismissCall(call.id);
    }, END_BAR_MS);
  }
}

// ── realtime follower

function onRemote(gen: number, row: Call) {
  if (gen !== rt.gen) return;
  const s = get();
  if (!s.call || s.call.id !== row.id) return;
  set({ call: row });

  switch (s.phase) {
    case 'incoming':
      if (row.status === 'accepted') finish(gen, 'unavailable', { detail: 'Answered on another device.' });
      else if (isTerminal(row.status)) finish(gen, 'missed');
      return;
    case 'outgoing':
      if (row.status === 'accepted') {
        clearTimer('ringTimer');
        enterConnecting(gen);
      } else if (isTerminal(row.status)) {
        finish(gen, reasonFor(row.status, 'caller'), { live: true });
      }
      return;
    case 'connecting':
    case 'connected':
      // A room session outlives its row: people already inside stay until they leave.
      if (isTerminal(row.status) && !s.isRoom) finish(gen, reasonFor(row.status, s.role), { live: true });
      return;
    default:
      return;
  }
}

// ── media

function markPeerJoined(gen: number) {
  if (gen !== rt.gen) return;
  clearTimer('joinTimer');
  if (!get().peerJoined) set({ peerJoined: true });
}

async function enterConnecting(gen: number) {
  const s = get();
  const call = s.call;
  if (!call || gen !== rt.gen || rt.media) return;
  // The ringing preview must release the camera before LiveKit opens it again.
  closePreview(s.preview);
  set({ phase: 'connecting', step: 'permissions', micBlocked: false, preview: null });

  const wantsVideo = call.kind === 'video';
  const grants = await requestCallPermissions(wantsVideo);
  // `finish()` keeps the generation, so also bail if the call ended while the dialog was up
  // (e.g. the caller cancelled): otherwise a LiveKit session would start behind the end screen.
  if (gen !== rt.gen || get().phase !== 'connecting' || rt.media) return;
  if (!grants.mic) {
    set({ micBlocked: true, step: null });
    return;
  }
  if (wantsVideo && !grants.camera) showNotice(gen, 'Camera access is off. You can still talk; allow it in Settings to share video.');

  const { isRoom, role } = get();
  const media: CallMedia = new CallMedia({
    onConnected: () => {
      if (gen !== rt.gen) return;
      if (get().phase === 'connecting') set({ phase: 'connected', step: null });
      if (isRoom) return;
      if (media.remoteCount > 0) {
        markPeerJoined(gen);
      } else {
        clearTimer('joinTimer');
        rt.joinTimer = setTimeout(() => {
          if (gen !== rt.gen || get().peerJoined) return;
          const name = publicName(get().peer);
          finish(gen, 'unavailable', { live: true, detail: `${name} could not connect.` });
          endRow(call, role);
        }, PEER_JOIN_TIMEOUT_MS);
      }
    },
    onPeerJoined: () => markPeerJoined(gen),
    onPeerLeft: () => {
      if (gen === rt.gen && media.remoteCount === 0) set({ peerQuality: 'unknown' });
      // In a 1:1 call the other side leaving the room is a hang-up, even if their status write never arrives.
      if (gen !== rt.gen || isRoom || media.remoteCount > 0) return;
      finish(gen, 'ended', { live: true });
      endRow(call, role);
    },
    onLost: () => {
      if (gen !== rt.gen) return;
      finish(gen, 'failed', { live: true, detail: 'The connection was lost.' });
      if (!isRoom) endRow(call, role);
    },
    onNotice: (message) => showNotice(gen, message),
    onStep: (step) => {
      if (gen === rt.gen && get().phase === 'connecting') set({ step });
    },
    onReconnecting: (reconnecting) => {
      if (gen === rt.gen) set({ reconnecting });
    },
    onQuality: (who, quality) => {
      if (gen !== rt.gen) return;
      if (who === 'local') set({ quality });
      else if (!isRoom) set({ peerQuality: quality });
    },
  });
  rt.media = media;
  set({ room: media.room });

  const start = get();
  const startVideo = start.wantCamera && grants.camera;
  try {
    await media.start(call.id, { video: startVideo, speaker: start.speaker, mic: start.wantMic, facing: start.facing });
    if (gen !== rt.gen || media.isDisposed) return;
    // The user may have changed speaker / mic / camera / lens while media was starting: apply it now.
    const now = get();
    if (now.speaker !== start.speaker) media.setSpeaker(now.speaker);
    if (now.wantMic !== start.wantMic) await media.setMic(now.wantMic);
    if (gen !== rt.gen) return;
    // A denied camera on a video call stays off; an audio call asks for the camera inside setCamera.
    const wantVideo = now.wantCamera && (grants.camera || !wantsVideo);
    if (wantVideo !== startVideo) await media.setCamera(wantVideo);
    if (gen !== rt.gen) return;
    set({ mediaLive: true, facing: media.facingMode });
  } catch (e) {
    if (gen !== rt.gen) return;
    const failure = e instanceof MediaFailure ? e : null;
    const reason: EndReason = failure?.kind === 'not-configured' ? 'not-configured' : 'failed';
    finish(gen, reason, { live: true, detail: failure?.message ?? 'The call could not be connected.' });
    // The other side must not wait on a call that cannot carry media.
    if (!isRoom) endRow(call, role);
  }
}

// ── public actions

/** Called by CallHost for every ring (realtime INSERT, cold-open query, foreground catch-up). */
export function ringIn(call: Call) {
  if (call.status !== 'ringing' || call.callee_id !== me() || call.caller_id === me()) return;
  if (rt.seen.has(call.id) || get().call?.id === call.id) return;
  if (isBusy()) {
    // One call at a time: the newcomer hears "Declined" straight away.
    rt.seen.add(call.id);
    tryTransition(call.id, 'rejected', ['ringing']);
    return;
  }
  const gen = adopt(call, 'incoming');
  armRingTimeout(gen, call);
  prepareIncoming(gen, call);
}

/** Answers the ringing call. Returns its id so the caller can navigate, or null if there is nothing to answer. */
export function acceptCall(): string | null {
  const s = get();
  const call = s.call;
  if (s.phase !== 'incoming' || !call) return null;
  const gen = rt.gen;
  clearTimer('ringTimer');
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch {}

  // Optimistic: media starts in parallel with the status write (the token function accepts ringing calls).
  transitionCall(call.id, 'accepted', ['ringing']).then(
    async (row) => {
      if (gen !== rt.gen) return;
      if (row) {
        set({ call: row });
        return;
      }
      // Lost the race: the caller hung up (or the ring timed out) a moment before we answered.
      const latest = await readCall(call.id);
      if (gen !== rt.gen) return;
      if (latest?.status === 'accepted') finish(gen, 'unavailable', { detail: 'Answered on another device.' });
      else finish(gen, 'missed', { detail: 'The caller hung up before you answered.' });
    },
    (e) => {
      if (gen === rt.gen) finish(gen, 'failed', { detail: errorMessage(e, 'The call could not be answered.') });
    },
  );
  enterConnecting(gen);
  return call.id;
}

export function declineCall() {
  const s = get();
  if (s.phase !== 'incoming' || !s.call) return;
  tryTransition(s.call.id, 'rejected', ['ringing']);
  finish(rt.gen, 'declined');
}

/** Declines the ring and drops a short reply into the conversation, so the caller is not left guessing. */
export function declineWithMessage(text: string) {
  const call = get().call;
  if (get().phase !== 'incoming' || !call) return;
  declineCall();
  sendMessage(call.conversation_id, text)
    .catch(() => {})
    .finally(() => refreshChat(call.conversation_id));
}

/** The red button, the back-button confirmation and screen unmount all end up here. */
export function hangUp() {
  const s = get();
  const call = s.call;
  if (!call) return;
  const gen = rt.gen;

  switch (s.phase) {
    case 'incoming':
      declineCall();
      return;
    case 'outgoing':
      finish(gen, 'cancelled', { live: true });
      // If the callee answered in the same instant, the cancel loses and we end the accepted call instead.
      endRow(call, 'caller');
      return;
    case 'connecting':
    case 'connected':
      if (s.isRoom) {
        // Leaving a room never ends it for others; the last one out closes the session row.
        const alone = (rt.media?.remoteCount ?? 0) === 0;
        finish(gen, 'left', { live: true });
        if (alone) tryTransition(call.id, 'ended', ['accepted']);
        return;
      }
      finish(gen, 'ended', { live: true });
      endRow(call, s.role);
      return;
    default:
      return;
  }
}

/**
 * Called by the call screen with its route id. Reuses the active call when it
 * is the same one (overlay → screen hand-off, remounts); otherwise loads the row
 * and enters the phase it implies.
 */
export async function openCall(id: string) {
  const s = get();
  if (s.call?.id === id || s.openingId === id) return;
  if (isLive(s.phase)) hangUp(); // a newer call screen always wins over a stale live call

  stopRuntime();
  rt.gen += 1;
  const gen = rt.gen;
  set({ ...INITIAL, openingId: id });

  const call = await readCall(id);
  if (gen !== rt.gen) return;
  if (!call) {
    set({ ...INITIAL, phase: 'ended', endReason: 'unavailable', endDetail: 'This call is no longer available.' });
    return;
  }
  rt.seen.add(call.id);

  if (isTerminal(call.status)) {
    // Opened after the fact (stale link, late navigation): show how it ended, then go back.
    const role = roleOf(call);
    // A call we just placed can already be over here (the callee was busy and auto-rejected it
    // before this read): the caller still owes the chat its log line.
    const fresh = Date.now() - new Date(call.created_at).getTime() < RING_TIMEOUT_MS;
    if (role === 'caller' && call.callee_id !== null && fresh) postCallLog(call, call.status, 0, false);
    set({
      ...INITIAL,
      call,
      phase: 'ended',
      role,
      isRoom: call.callee_id === null,
      endReason: call.callee_id === null ? 'ended' : reasonFor(call.status, role),
      endDetail: call.callee_id === null ? 'This session has ended.' : undefined,
    });
    return;
  }

  if (call.status === 'ringing') {
    const outgoing = roleOf(call) === 'caller';
    const g = adopt(call, outgoing ? 'outgoing' : 'incoming');
    armRingTimeout(g, call);
    if (outgoing) prepareOutgoing(g, call);
    else prepareIncoming(g, call);
    return;
  }

  enterConnecting(adopt(call, 'connecting'));
}

/** While ringing: ask for permissions early and, for video, show the caller's own camera. */
async function prepareOutgoing(gen: number, call: Call) {
  const grants = await requestCallPermissions(call.kind === 'video');
  if (gen !== rt.gen || get().phase !== 'outgoing') return;
  if (!grants.mic) {
    set({ micBlocked: true });
    return;
  }
  if (call.kind !== 'video' || !grants.camera) return;
  await startPreview(gen, 'outgoing');
}

/** Incoming video: show your own camera behind the ring — only if already allowed (never prompt over a ring). */
async function prepareIncoming(gen: number, call: Call) {
  if (call.kind !== 'video' || !(await hasCameraPermission())) return;
  await startPreview(gen, 'incoming');
}

/** Opens the ringing preview unless the call moved on, the camera was switched off, or one is already up. */
async function startPreview(gen: number, phase: 'incoming' | 'outgoing') {
  const ok = () => gen === rt.gen && get().phase === phase && get().wantCamera && !get().preview;
  if (!ok()) return;
  const track = await openPreview(get().facing);
  if (!ok()) {
    closePreview(track);
    return;
  }
  set({ preview: track });
}

/**
 * Recover from a denied microphone. `prompt: false` (returning from Settings) only re-checks
 * the grant, so a still-denied permission can never re-open the dialog in a loop.
 */
export async function retryPermissions({ prompt = true }: { prompt?: boolean } = {}) {
  const s = get();
  if (!s.micBlocked || !s.call) return;
  const gen = rt.gen;
  const granted = prompt ? (await requestCallPermissions(false)).mic : await hasMicPermission();
  if (gen !== rt.gen || !granted || !get().micBlocked) return;
  if (get().phase === 'connecting') {
    set({ micBlocked: false });
    enterConnecting(gen);
  } else {
    set({ micBlocked: false });
  }
}

/**
 * Puts the call screen away while media keeps running (the screen then pops itself). Only a call
 * that is up — not ringing out, not blocked on the microphone — can be minimized.
 */
export function minimizeCall(): boolean {
  const s = get();
  if ((s.phase !== 'connecting' && s.phase !== 'connected') || s.micBlocked) return false;
  set({ minimized: true });
  return true;
}

/** The end screen has been shown; release the store for the next call. */
export function dismissCall(id: string) {
  const s = get();
  if (s.phase !== 'ended') return;
  if (s.call && s.call.id !== id) return;
  resetToIdle();
}

// ── call controls
// Once media is live, mic / camera state is read back from LiveKit. Before that (ringing,
// connecting) the choice is stored in `wantMic` / `wantCamera` / `facing` and applied on connect.

export async function toggleMic() {
  const { room, mediaLive, wantMic } = get();
  const media = rt.media;
  if (room && media && mediaLive) {
    const on = !room.localParticipant.isMicrophoneEnabled;
    if (await media.setMic(on)) set({ wantMic: on });
    return;
  }
  set({ wantMic: !wantMic });
}

export async function toggleCamera() {
  const { room, mediaLive, wantCamera, phase, preview } = get();
  const media = rt.media;
  if (room && media && mediaLive) {
    const on = !room.localParticipant.isCameraEnabled;
    if (!(await media.setCamera(on))) return;
    set({ wantCamera: on });
    // Turning video on mid-audio-call moves the sound off the earpiece, like any video call.
    if (on && !get().speaker) toggleSpeaker();
    return;
  }
  const on = !wantCamera;
  set({ wantCamera: on });
  if (phase !== 'outgoing' && phase !== 'incoming') return;
  // Ringing: the preview follows the choice.
  if (!on) {
    closePreview(preview);
    set({ preview: null });
  } else {
    const gen = rt.gen;
    const grants = phase === 'outgoing' ? await requestCallPermissions(true) : { camera: await hasCameraPermission() };
    if (gen !== rt.gen) return;
    if (!grants.camera) {
      showNotice(gen, 'Camera access is off. Allow it in Settings to share video.');
      return;
    }
    await startPreview(gen, phase);
  }
}

export async function flipCamera() {
  const { mediaLive, facing, preview } = get();
  if (rt.media && (mediaLive || rt.media.hasCamera)) {
    const next = await rt.media.flipCamera();
    if (next) set({ facing: next });
    return;
  }
  const next = facing === 'user' ? 'environment' : 'user';
  if (preview) {
    const gen = rt.gen;
    const ok = await flipPreview(preview, next);
    if (gen !== rt.gen) return;
    if (!ok) {
      showNotice(gen, 'Could not switch camera.');
      return;
    }
  }
  set({ facing: next });
  rt.media?.setFacing(next);
}

export function toggleSpeaker() {
  const on = !get().speaker;
  set({ speaker: on });
  rt.media?.setSpeaker(on);
}

// ── wiring for CallHost / call screen

export function bindQueryClient(client: QueryClient | null) {
  rt.queryClient = client;
}

/**
 * The call screen registers while mounted. When the last screen for a call
 * unmounts, a live call is hung up (never a zombie call with the mic open) and
 * a finished one is released. Deferred one tick so StrictMode / Fast Refresh
 * remounts do not count as leaving.
 */
export function registerCallScreen(id: string): () => void {
  rt.screens.set(id, (rt.screens.get(id) ?? 0) + 1);
  if (get().call?.id === id && get().minimized) {
    clearTimer('endTimer');
    set({ minimized: false });
  }
  return () => {
    rt.screens.set(id, Math.max(0, (rt.screens.get(id) ?? 1) - 1));
    setTimeout(() => {
      if ((rt.screens.get(id) ?? 0) > 0) return;
      rt.screens.delete(id);
      const s = get();
      if (s.call?.id !== id && s.openingId !== id) return;
      // Minimized: the screen was put away on purpose; the call carries on under the in-call bar.
      if (s.minimized) return;
      if (isLive(s.phase)) hangUp();
      else if (s.openingId === id) resetToIdle();
      dismissCall(id);
    }, 0);
  };
}

/** True while a call screen for `id` is mounted (so accepting from the overlay does not push a second one). */
export function isCallScreenOpen(id: string) {
  return (rt.screens.get(id) ?? 0) > 0;
}

/** Sign-out / CallHost unmount: end whatever is live and clear the store. */
export function abandonCalls() {
  if (isLive(get().phase)) hangUp();
  resetToIdle();
}

// ── chat log

function postCallLog(call: Call, status: CallStatus, durationS: number, connected: boolean) {
  if (rt.logged.has(call.id)) return;
  rt.logged.add(call.id);
  const kind = call.kind === 'video' ? 'video' : 'audio';
  const Kind = kind === 'video' ? 'Video' : 'Audio';
  let label: string;
  if (status === 'ended') label = connected ? `${Kind} call · ${formatDuration(durationS)}` : `${Kind} call · not connected`;
  else if (status === 'rejected') label = `Declined ${kind} call`;
  else if (status === 'cancelled') label = `Cancelled ${kind} call`;
  else label = `Missed ${kind} call`;

  sendMessage(call.conversation_id, label, 'call', {
    call_id: call.id,
    call_kind: call.kind,
    call_status: status,
    duration_s: status === 'ended' && connected ? durationS : 0,
  })
    .catch(() => {})
    .finally(() => {
      refreshChat(call.conversation_id);
      rt.queryClient?.invalidateQueries({ queryKey: qk.callLog });
    });
}

function refreshChat(conversationId: string) {
  const client = rt.queryClient;
  if (!client) return;
  client.invalidateQueries({ queryKey: qk.messages(conversationId) });
  client.invalidateQueries({ queryKey: qk.conversations });
}

// ── side effects derived from phase (tones, keep-awake)

const KEEP_AWAKE_TAG = 'landconnect-call';
let awake = false;

useCallStore.subscribe((s, prev) => {
  if (s.phase === prev.phase) return;

  if (s.phase === 'incoming') playTone('ringtone');
  else if (s.phase === 'outgoing') playTone('ringback');
  else stopTones();

  const wantAwake = isLive(s.phase);
  if (wantAwake === awake) return;
  awake = wantAwake;
  try {
    if (wantAwake) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  } catch {}
});
