import { need, supabase } from '@/lib/supabase';
import { toAcres } from '@/lib/format';
import type { Listing, ListingFilters, ListingInput, ListingWithOwner } from '@/lib/types';
import { currentUserId } from '@/stores/session';

const WITH_OWNER = '*, owner:profiles!listings_owner_id_fkey(*)';

/** Most rows one feed query returns. A result shorter than this is the complete set for its filters. */
export const LISTINGS_LIMIT = 200;

/** Community feed: every non-draft listing, filtered and sorted client-side for area. */
export async function fetchListings(filters: ListingFilters = {}): Promise<ListingWithOwner[]> {
  let q = supabase.from('listings').select(WITH_OWNER).neq('status', 'draft');

  if (filters.landType && filters.landType !== 'all') q = q.eq('land_type', filters.landType);
  if (filters.maxPrice) q = q.lte('price_total', filters.maxPrice);
  if (filters.query?.trim()) {
    const term = filters.query.trim().replace(/[%,()]/g, ' ');
    q = q.or(`title.ilike.%${term}%,locality.ilike.%${term}%,district.ilike.%${term}%`);
  }

  if (filters.sort === 'price_low') q = q.order('price_total', { ascending: true });
  else if (filters.sort === 'price_high') q = q.order('price_total', { ascending: false });
  else q = q.order('created_at', { ascending: false });

  let rows = need(await q.limit(LISTINGS_LIMIT)) as ListingWithOwner[];

  if (filters.minAcres) rows = rows.filter((l) => toAcres(l.area_value, l.area_unit) >= filters.minAcres!);
  if (filters.sort === 'area') {
    rows = [...rows].sort((a, b) => toAcres(b.area_value, b.area_unit) - toAcres(a.area_value, a.area_unit));
  }
  return rows;
}

export async function fetchListing(id: string): Promise<ListingWithOwner | null> {
  const res = await supabase.from('listings').select(WITH_OWNER).eq('id', id).maybeSingle();
  return need(res) as ListingWithOwner | null;
}

/** Listings owned by the signed-in seller / broker, drafts included. */
export async function fetchMyListings(): Promise<Listing[]> {
  const me = currentUserId();
  if (!me) return [];
  return need(
    await supabase.from('listings').select('*').eq('owner_id', me).order('created_at', { ascending: false }),
  ) as Listing[];
}

export async function createListing(input: ListingInput): Promise<Listing> {
  const me = currentUserId();
  if (!me) throw new Error('Not signed in.');
  return need(await supabase.from('listings').insert({ ...input, owner_id: me }).select('*').single()) as Listing;
}

export async function updateListing(id: string, patch: Partial<ListingInput>): Promise<Listing> {
  return need(await supabase.from('listings').update(patch).eq('id', id).select('*').single()) as Listing;
}

export async function deleteListing(id: string): Promise<void> {
  const { error } = await supabase.from('listings').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function recordListingView(id: string): Promise<void> {
  await supabase.rpc('increment_listing_views', { target: id });
}

/** Uploads a picked image to the public bucket and returns its URL. */
export async function uploadImage(localUri: string): Promise<string> {
  const me = currentUserId();
  if (!me) throw new Error('Not signed in.');
  const ext = (localUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
  const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  const bytes = await (await fetch(localUri)).arrayBuffer();
  const { error } = await supabase.storage
    .from('listing-images')
    .upload(path, bytes, { contentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`, upsert: false });
  if (error) throw new Error(error.message);

  return supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
}

// ── saved listings (buyers' shortlist)

export async function fetchSavedIds(): Promise<string[]> {
  const me = currentUserId();
  if (!me) return [];
  const rows = need(await supabase.from('saved_listings').select('listing_id').eq('user_id', me)) as {
    listing_id: string;
  }[];
  return rows.map((r) => r.listing_id);
}

export async function fetchSavedListings(): Promise<ListingWithOwner[]> {
  const me = currentUserId();
  if (!me) return [];
  const rows = need(
    await supabase
      .from('saved_listings')
      .select(`created_at, listing:listings(${WITH_OWNER})`)
      .eq('user_id', me)
      .order('created_at', { ascending: false }),
  ) as unknown as { listing: ListingWithOwner | null }[];
  return rows.map((r) => r.listing).filter((l): l is ListingWithOwner => !!l);
}

export async function setSaved(listingId: string, saved: boolean): Promise<void> {
  const me = currentUserId();
  if (!me) throw new Error('Not signed in.');
  const res = saved
    ? await supabase.from('saved_listings').upsert({ user_id: me, listing_id: listingId })
    : await supabase.from('saved_listings').delete().eq('user_id', me).eq('listing_id', listingId);
  if (res.error) throw new Error(res.error.message);
}
