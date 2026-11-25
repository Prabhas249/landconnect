import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { qk } from '@/data/keys';
import { deleteListing, updateListing } from '@/data/listings';
import { errorMessage } from '@/lib/supabase';
import type { Listing, ListingStatus, ListingWithOwner } from '@/lib/types';

function invalidateListing(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: qk.myListings });
  qc.invalidateQueries({ queryKey: ['listings'] });
  qc.invalidateQueries({ queryKey: qk.listing(id) });
  qc.invalidateQueries({ queryKey: qk.savedListings });
}

type StatusCtx = { prevMine?: Listing[]; prevOne?: ListingWithOwner | null };

/** Owner-side writes with optimistic cache updates for My land and the detail screen. */
export function useListingMutations() {
  const qc = useQueryClient();

  const setStatus = useMutation<Listing, Error, { id: string; status: ListingStatus }, StatusCtx>({
    mutationFn: ({ id, status }) => updateListing(id, { status }),
    onMutate: async ({ id, status }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: qk.myListings }),
        qc.cancelQueries({ queryKey: qk.listing(id) }),
      ]);
      const prevMine = qc.getQueryData<Listing[]>(qk.myListings);
      const prevOne = qc.getQueryData<ListingWithOwner | null>(qk.listing(id));
      qc.setQueryData<Listing[]>(qk.myListings, (old) => old?.map((l) => (l.id === id ? { ...l, status } : l)));
      qc.setQueryData<ListingWithOwner | null>(qk.listing(id), (old) => (old ? { ...old, status } : old));
      return { prevMine, prevOne };
    },
    onError: (e, { id }, ctx) => {
      if (ctx?.prevMine) qc.setQueryData(qk.myListings, ctx.prevMine);
      if (ctx?.prevOne !== undefined) qc.setQueryData(qk.listing(id), ctx.prevOne);
      Alert.alert('Status not changed', errorMessage(e));
    },
    onSettled: (_d, _e, { id }) => invalidateListing(qc, id),
  });

  const remove = useMutation<void, Error, string, { prevMine?: Listing[] }>({
    mutationFn: (id) => deleteListing(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.myListings });
      const prevMine = qc.getQueryData<Listing[]>(qk.myListings);
      qc.setQueryData<Listing[]>(qk.myListings, (old) => old?.filter((l) => l.id !== id));
      return { prevMine };
    },
    onError: (e, _id, ctx) => {
      if (ctx?.prevMine) qc.setQueryData(qk.myListings, ctx.prevMine);
      Alert.alert('Listing not deleted', errorMessage(e));
    },
    onSettled: (_d, _e, id) => {
      qc.removeQueries({ queryKey: qk.listing(id) });
      invalidateListing(qc, id);
    },
  });

  return {
    setStatus: (id: string, status: ListingStatus) => setStatus.mutate({ id, status }),
    remove: (id: string) => remove.mutate(id),
  };
}

export const STATUS_CHOICES = [
  { value: 'active', label: 'Active', hint: 'Visible in Explore and open to enquiries' },
  { value: 'under_offer', label: 'Under offer', hint: 'Still visible, marked as in negotiation' },
  { value: 'sold', label: 'Sold', hint: 'Kept for reference, no new enquiries expected' },
  { value: 'draft', label: 'Draft', hint: 'Hidden from buyers until you publish' },
] as const satisfies readonly { value: ListingStatus; label: string; hint: string }[];
