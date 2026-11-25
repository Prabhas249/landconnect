import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { qk } from '@/data/keys';
import { fetchSavedIds, setSaved } from '@/data/listings';
import { errorMessage } from '@/lib/supabase';
import type { ListingWithOwner } from '@/lib/types';
import { useSession } from '@/stores/session';

type Vars = { id: string; saved: boolean };
type Ctx = { prevIds?: string[]; prevListings?: ListingWithOwner[] };

/** Buyer shortlist with an optimistic toggle; rolls back and explains if the write fails. */
export function useSaved() {
  const qc = useQueryClient();
  const signedIn = useSession((s) => s.status === 'signedIn');

  const { data: ids } = useQuery({ queryKey: qk.savedIds, queryFn: fetchSavedIds, enabled: signedIn });
  const savedSet = new Set(ids ?? []);

  const mutation = useMutation<void, Error, Vars, Ctx>({
    mutationFn: ({ id, saved }) => setSaved(id, saved),
    onMutate: async ({ id, saved }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: qk.savedIds }),
        qc.cancelQueries({ queryKey: qk.savedListings }),
      ]);
      const prevIds = qc.getQueryData<string[]>(qk.savedIds);
      const prevListings = qc.getQueryData<ListingWithOwner[]>(qk.savedListings);
      qc.setQueryData<string[]>(qk.savedIds, (old = []) =>
        saved ? (old.includes(id) ? old : [id, ...old]) : old.filter((x) => x !== id),
      );
      if (!saved) {
        qc.setQueryData<ListingWithOwner[]>(qk.savedListings, (old) => old?.filter((l) => l.id !== id));
      }
      return { prevIds, prevListings };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prevIds) qc.setQueryData(qk.savedIds, ctx.prevIds);
      if (ctx?.prevListings) qc.setQueryData(qk.savedListings, ctx.prevListings);
      Alert.alert('Shortlist not updated', errorMessage(e));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.savedIds });
      qc.invalidateQueries({ queryKey: qk.savedListings });
    },
  });

  return {
    savedIds: ids ?? [],
    isSaved: (id: string) => savedSet.has(id),
    toggle: (id: string) => mutation.mutate({ id, saved: !savedSet.has(id) }),
  };
}
