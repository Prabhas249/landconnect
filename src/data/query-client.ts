import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  QueryClient,
  dehydrate,
  focusManager,
  hashKey,
  hydrate,
  keepPreviousData,
  type DehydratedState,
  type QueryKey,
} from '@tanstack/react-query';
import { AppState } from 'react-native';

import { fetchCallLog } from '@/data/call-log';
import { fetchConversations } from '@/data/chat';
import { FEED_DEFAULT, qk } from '@/data/keys';
import { fetchMyListings, fetchSavedIds, fetchSavedListings } from '@/data/listings';
import type { Profile } from '@/lib/types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Defaults tuned for perceived speed: show what is cached at once, refresh quietly behind it.
 * - RN has no window focus; app-foreground refreshes come from realtime and pull-to-refresh.
 * - One quick retry: a second failure is better shown as the designed error state than a spinner.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * SECOND,
      gcTime: 15 * MINUTE,
      retry: 1,
      retryDelay: (attempt) => Math.min(600 * 2 ** attempt, 4 * SECOND),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

// RN has no document visibility, so React Query treats the app as always focused and keeps every
// refetchInterval (room sessions, presence headers, lobby) polling while backgrounded. Tie focus to
// AppState so intervals pause off-screen. refetchOnWindowFocus stays off: resuming is not a storm.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});

// Listings change slowly; a new filter keeps the old cards up until the new ones land.
for (const root of ['listing', 'my-listings', 'saved-listings', 'saved-ids'] as const) {
  queryClient.setQueryDefaults([root], { staleTime: 60 * SECOND });
}
queryClient.setQueryDefaults(['listings'], { staleTime: 60 * SECOND, placeholderData: keepPreviousData });
// Chats are kept fresh by realtime invalidation; the stale time only covers a missed event.
for (const root of ['conversations', 'conversation', 'messages', 'call-log'] as const) {
  queryClient.setQueryDefaults([root], { staleTime: 30 * SECOND });
}
for (const root of ['profile', 'contacts', 'blocked'] as const) {
  queryClient.setQueryDefaults([root], { staleTime: 2 * MINUTE });
}

// ── Feed mirror
// Explore's first page and the Map tab are the same query (unfiltered, newest first) under two
// keys. Whichever lands first fills the other, so opening Map after Explore needs no request.

const FEED_KEYS: QueryKey[] = [qk.listings(FEED_DEFAULT), qk.listings()];
const FEED_HASHES = FEED_KEYS.map((k) => hashKey(k));

function mirrorFeed(fromHash: string) {
  const from = queryClient.getQueryCache().get(fromHash);
  const data = from?.state.data;
  if (!from || data === undefined) return;
  FEED_KEYS.forEach((key, i) => {
    if (FEED_HASHES[i] === fromHash) return;
    const other = queryClient.getQueryState(key);
    if (other?.data !== undefined && other.dataUpdatedAt >= from.state.dataUpdatedAt) return;
    queryClient.setQueryData(key, data, { updatedAt: from.state.dataUpdatedAt });
  });
}

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
  if (FEED_HASHES.includes(event.query.queryHash)) mirrorFeed(event.query.queryHash);
});

// ── Snapshot
// The first screen paints from the last session's data while the network refreshes it. Kept
// deliberately small: the feed and the inbox lists only (no messages, no search results), tied to
// one user, dropped after a day, and wiped on sign-out. Bump the version when a cached shape changes.

const SNAPSHOT_KEY = 'lc.query-snapshot';
const SNAPSHOT_VERSION = 1;
const SNAPSHOT_MAX_AGE = 24 * 60 * MINUTE;
// AsyncStorage rows on Android read through a ~2 MB cursor window; stay well below it.
const SNAPSHOT_MAX_CHARS = 1_200_000;
const WRITE_THROTTLE = 4 * SECOND;

type Snapshot = { v: number; userId: string; savedAt: number; state: DehydratedState };

const PERSISTED_ROOTS = new Set(['conversations', 'my-listings', 'saved-ids', 'saved-listings', 'call-log']);

function persistable(key: QueryKey, hash: string) {
  if (hash === FEED_HASHES[0]) return true;
  return typeof key[0] === 'string' && PERSISTED_ROOTS.has(key[0]);
}

// Read as early as possible so it overlaps the session check instead of following it.
const snapshotRead: Promise<string | null> = AsyncStorage.getItem(SNAPSHOT_KEY).catch(() => null);

/** Fill the cache from the last session's snapshot for this user, if there is a fresh one. */
export async function restoreSnapshot(userId: string) {
  try {
    const raw = await snapshotRead;
    if (!raw) return;
    const snap = JSON.parse(raw) as Snapshot;
    if (snap.v !== SNAPSHOT_VERSION || snap.userId !== userId || Date.now() - snap.savedAt > SNAPSHOT_MAX_AGE) return;
    hydrate(queryClient, snap.state);
    mirrorFeed(FEED_HASHES[0]);
  } catch {
    // A corrupt snapshot only costs the instant first paint.
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function writeSnapshot(userId: string) {
  writeTimer = null;
  try {
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && persistable(q.queryKey, q.queryHash),
      shouldDehydrateMutation: () => false,
    });
    const json = JSON.stringify({ v: SNAPSHOT_VERSION, userId, savedAt: Date.now(), state } satisfies Snapshot);
    if (json.length > SNAPSHOT_MAX_CHARS) return;
    AsyncStorage.setItem(SNAPSHOT_KEY, json).catch(() => undefined);
  } catch {
    // Never let persistence break the session.
  }
}

/** Keep the snapshot current while signed in. Returns a stop function. */
export function startSnapshots(userId: string) {
  const schedule = () => {
    if (writeTimer === null) writeTimer = setTimeout(() => writeSnapshot(userId), WRITE_THROTTLE);
  };
  const offCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (persistable(event.query.queryKey, event.query.queryHash)) schedule();
  });
  // Flush on the way to the background: the OS may kill the app before the throttle fires.
  const offApp = AppState.addEventListener('change', (s) => {
    if (s !== 'active' && writeTimer !== null) {
      clearTimeout(writeTimer);
      writeSnapshot(userId);
    }
  });
  return () => {
    offCache();
    offApp.remove();
    if (writeTimer !== null) clearTimeout(writeTimer);
    writeTimer = null;
  };
}

/** Sign-out: nothing of the previous account may survive in memory or on disk. */
export function forgetSession() {
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = null;
  queryClient.clear();
  AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => undefined);
}

// ── Prefetch
// The tab shell already starts the feed (ListingsWarmup) and the inbox (badge). This adds what the
// other tabs open on, staggered so it never competes with the first screen's own requests.

let prefetchTimers: ReturnType<typeof setTimeout>[] = [];

export function prefetchSignedIn({ userId, profile, manages }: { userId: string; profile: Profile | null; manages: boolean }) {
  // Own profile is already in the session store: seed it (marked stale) so profile screens paint at once.
  if (profile && queryClient.getQueryData(qk.profile(userId)) === undefined) {
    queryClient.setQueryData(qk.profile(userId), profile, { updatedAt: 1 });
  }
  queryClient.prefetchQuery({ queryKey: qk.savedIds, queryFn: fetchSavedIds });
  queryClient.prefetchQuery({ queryKey: qk.conversations, queryFn: fetchConversations });

  prefetchTimers.forEach(clearTimeout);
  prefetchTimers = [
    setTimeout(() => {
      if (manages) queryClient.prefetchQuery({ queryKey: qk.myListings, queryFn: fetchMyListings });
      else queryClient.prefetchQuery({ queryKey: qk.savedListings, queryFn: fetchSavedListings });
    }, 900),
    setTimeout(() => queryClient.prefetchQuery({ queryKey: qk.callLog, queryFn: fetchCallLog }), 1800),
  ];
  return () => {
    prefetchTimers.forEach(clearTimeout);
    prefetchTimers = [];
  };
}
