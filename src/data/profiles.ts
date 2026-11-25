import { supabase } from '@/lib/supabase';
import type { Profile, ProfilePrivate } from '@/lib/types';
import { currentUserId } from '@/stores/session';

function need<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function fetchProfile(id: string): Promise<Profile | null> {
  return need(await supabase.from('profiles').select('*').eq('id', id).maybeSingle()) as Profile | null;
}

/** The signed-in user's own contact details. RLS makes this unreadable for anyone else. */
export async function fetchMyPrivate(): Promise<ProfilePrivate | null> {
  const me = currentUserId();
  if (!me) return null;
  return need(await supabase.from('profile_private').select('*').eq('id', me).maybeSingle()) as ProfilePrivate | null;
}

export async function updateMyPrivate(patch: Partial<Pick<ProfilePrivate, 'phone'>>): Promise<void> {
  const me = currentUserId();
  if (!me) return;
  const { error } = await supabase.from('profile_private').update(patch).eq('id', me);
  if (error) throw new Error(error.message);
}

/** Heartbeat for presence. Called on foreground and every minute while active. */
export async function touchPresence(): Promise<void> {
  const me = currentUserId();
  if (!me) return;
  await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', me);
}

// ── blocking

export async function fetchBlocked(): Promise<Profile[]> {
  const me = currentUserId();
  if (!me) return [];
  const rows = need(
    await supabase.from('blocks').select('blocked:profiles!blocks_blocked_id_fkey(*)').eq('blocker_id', me),
  ) as unknown as { blocked: Profile | null }[];
  return rows.map((r) => r.blocked).filter((p): p is Profile => !!p);
}

export async function isBlockedByMe(userId: string): Promise<boolean> {
  const me = currentUserId();
  if (!me) return false;
  const { count } = await supabase
    .from('blocks')
    .select('blocked_id', { count: 'exact', head: true })
    .eq('blocker_id', me)
    .eq('blocked_id', userId);
  return (count ?? 0) > 0;
}

/** Blocked users cannot message or call you, and you disappear from each other's profile lookups. */
export async function setBlocked(userId: string, blocked: boolean): Promise<void> {
  const me = currentUserId();
  if (!me) throw new Error('Not signed in.');
  const res = blocked
    ? await supabase.from('blocks').upsert({ blocker_id: me, blocked_id: userId })
    : await supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId);
  if (res.error) throw new Error(res.error.message);
}
