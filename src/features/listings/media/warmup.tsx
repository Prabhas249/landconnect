import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { qk } from '@/data/keys';
import { fetchListings } from '@/data/listings';
import type { ListingFilters } from '@/lib/types';

import { warmFeed, warmThumbs } from './photo-cache';

/** Must hash like Explore's first query so both share one cache entry and one request. */
const EXPLORE_DEFAULT: ListingFilters = { query: undefined, landType: 'all', sort: 'newest' };

type WithImages = { images: string[] };

function listOf(data: unknown): WithImages[] | null {
  if (!Array.isArray(data)) return null;
  return data.filter((l): l is WithImages => !!l && Array.isArray((l as WithImages).images));
}

/**
 * Mounted once by the signed-in tab shell. Starts the Explore feed request as the app opens and,
 * whenever any listings query lands (feed, filters, Saved, My land), prefetches the photos those
 * screens will show at the size they show them, in the background and without blocking the UI.
 */
export function ListingsWarmup() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.listings(EXPLORE_DEFAULT),
    queryFn: () => fetchListings(EXPLORE_DEFAULT),
  });

  useEffect(() => {
    if (!data) return;
    // Let the first visible cards start their own loads before the warm-up queues behind them.
    const t = setTimeout(() => warmFeed(data), 250);
    return () => clearTimeout(t);
  }, [data]);

  useEffect(() => {
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const root = event.query.queryKey[0];
      const list = listOf(event.action.data);
      if (!list || list.length === 0) return;
      if (root === 'listings') warmFeed(list);
      else if (root === 'saved-listings' || root === 'my-listings') warmThumbs(list);
    });
  }, [qc]);

  return null;
}
