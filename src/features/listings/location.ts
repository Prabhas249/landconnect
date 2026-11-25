import { fuzzLocation } from '@/lib/format';
import type { Listing } from '@/lib/types';

/** Vidhana Soudha — the conventional "Bengaluru centre" for distances quoted in land listings. */
export const BENGALURU_CENTRE = { lat: 12.9796, lng: 77.5906 };

/**
 * The only point a viewer may see. Non-owners of a hidden-location listing get the fuzzed
 * point; everything downstream (map, distance, directions) must use this, never `listing.lat`.
 */
export function publicPoint(listing: Pick<Listing, 'id' | 'lat' | 'lng' | 'hide_exact_location'>, isOwner: boolean) {
  const approximate = listing.hide_exact_location && !isOwner;
  const point = approximate ? fuzzLocation(listing.id, listing.lat, listing.lng) : { lat: listing.lat, lng: listing.lng };
  return { ...point, approximate };
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "8.4 km", "34 km" — whole km past 10 so a fuzzed point never implies false precision. */
export function formatKm(km: number) {
  if (km < 1) return '< 1 km';
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
