import type { LucideIcon } from 'lucide-react-native';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react-native';

import { formatDuration } from '@/lib/format';
import type { CallKind, CallStatus } from '@/lib/types';

import { callTint, type CallTint } from './tints';

export type CallFacts = {
  kind: CallKind;
  status: CallStatus | undefined;
  /** Seconds both sides were connected; 0 when the call never connected. */
  seconds: number;
  /** Seen from the viewer: true when the viewer placed the call. */
  outgoing: boolean;
};

export type CallCopy = {
  /** "Voice call", "Missed video call". */
  title: string;
  /** "3:12", "No answer", "Declined" — null when the title says it all. */
  detail: string | null;
  /** One line for previews: "Voice call · 3:12", "Missed video call". */
  line: string;
  missed: boolean;
  tint: CallTint;
  Direction: LucideIcon;
};

/** Every call surface (thread card, inbox preview, call history) phrases a call the same way. */
export function describeCall({ kind, status, seconds, outgoing }: CallFacts): CallCopy {
  const noun = kind === 'video' ? 'video call' : 'voice call';
  const Noun = kind === 'video' ? 'Video call' : 'Voice call';
  const connected = seconds > 0 || status === 'accepted';

  let title = Noun;
  let detail: string | null = null;
  let missed = false;

  if (connected) {
    detail = seconds > 0 ? formatDuration(seconds) : null;
  } else if (outgoing) {
    detail = status === 'rejected' ? 'Declined' : status === 'cancelled' ? 'Cancelled' : status === 'ringing' ? 'Calling' : 'No answer';
  } else {
    title = `Missed ${noun}`;
    detail = status === 'rejected' ? 'Declined' : null;
    missed = true;
  }

  return {
    title,
    detail,
    line: detail ? `${title} · ${detail}` : title,
    missed,
    tint: missed ? callTint.missed : !connected ? callTint.unanswered : kind === 'video' ? callTint.video : callTint.voice,
    Direction: missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming,
  };
}

const LOG_LINE = /^(?:(Audio|Video) call(?: · (.+))?|(Missed|Declined|Cancelled) (audio|video) call)$/;

/**
 * The conversation trigger stores a call log's body as the preview ("Video call · 3:12",
 * "Missed audio call"). Recover the facts from that fixed phrasing so the inbox can re-phrase it
 * from the viewer's side. Returns null for anything that is not a call log line.
 */
export function parseCallPreview(text: string | null, outgoing: boolean): CallFacts | null {
  const m = text ? LOG_LINE.exec(text) : null;
  if (!m) return null;
  if (m[1]) {
    const kind: CallKind = m[1] === 'Video' ? 'video' : 'audio';
    const seconds = m[2] && /^\d/.test(m[2]) ? toSeconds(m[2]) : 0;
    return { kind, status: 'ended', seconds, outgoing };
  }
  const status: CallStatus = m[3] === 'Declined' ? 'rejected' : m[3] === 'Cancelled' ? 'cancelled' : 'missed';
  return { kind: m[4] === 'video' ? 'video' : 'audio', status, seconds: 0, outgoing };
}

function toSeconds(clock: string) {
  return clock.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}
