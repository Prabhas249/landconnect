import { formatDay } from '@/lib/format';
import type { Message } from '@/lib/types';

/** Rows of the inverted thread list, newest first (index 0 sits at the bottom of the screen). */
export type ThreadItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'notice'; key: string }
  | {
      type: 'msg';
      key: string;
      message: Message;
      /** Oldest bubble of a same-sender run: gets the wider top gap and, in rooms, the sender name. */
      first: boolean;
      /** Newest bubble of a run: gets the tail corner and, in rooms, the sender avatar. */
      last: boolean;
    };

/** Bubbles closer than this from the same sender read as one thought. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isBubble(m: Message) {
  return m.kind === 'text' || m.kind === 'image' || m.kind === 'listing';
}

function joins(a: Message | undefined, b: Message | undefined) {
  if (!a || !b) return false;
  if (a.sender_id !== b.sender_id || !isBubble(a) || !isBubble(b)) return false;
  if (dayKey(a.created_at) !== dayKey(b.created_at)) return false;
  return Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) < GROUP_WINDOW_MS;
}

/** `complete` means the whole history is loaded, so the privacy notice can sit above the first message. */
export function buildThreadItems(messages: Message[], complete: boolean): ThreadItem[] {
  const out: ThreadItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const newer = messages[i - 1];
    const older = messages[i + 1];
    out.push({ type: 'msg', key: m.id, message: m, first: !joins(m, older), last: !joins(m, newer) });
    // In an inverted list the separator goes *after* the oldest message of its day.
    if (!older || dayKey(older.created_at) !== dayKey(m.created_at)) {
      out.push({ type: 'day', key: `day-${dayKey(m.created_at)}`, label: formatDay(m.created_at) });
    }
  }
  if (complete && out.length > 0) out.push({ type: 'notice', key: 'notice' });
  return out;
}

export function sortNewestFirst(list: Message[]) {
  return [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
