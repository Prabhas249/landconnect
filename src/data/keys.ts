import type { ListingFilters } from '@/lib/types';

/**
 * The unfiltered, newest-first feed. Explore opens on it and the Map tab shows the same rows, so
 * the query client mirrors one into the other instead of fetching twice. Hashes the same as
 * `{ query: undefined, landType: 'all', sort: 'newest' }` (undefined keys drop out of the hash).
 */
export const FEED_DEFAULT: ListingFilters = { landType: 'all', sort: 'newest' };

/** React Query keys — one place so screens invalidate each other correctly. */
export const qk = {
  listings: (filters?: unknown) => ['listings', filters ?? {}] as const,
  listing: (id: string) => ['listing', id] as const,
  myListings: ['my-listings'] as const,
  savedIds: ['saved-ids'] as const,
  savedListings: ['saved-listings'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  contacts: ['contacts'] as const,
  callLog: ['call-log'] as const,
  roomSession: (id: string) => ['room-session', id] as const,
  profile: (id: string) => ['profile', id] as const,
  myPrivate: ['my-private'] as const,
  blocked: ['blocked'] as const,
};
