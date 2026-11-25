-- Row level security decides which rows a user may update; these grants decide which columns.
-- Without them a participant could rewrite a call's callee or room, a member could move their
-- membership to another conversation, and an owner could mark their own profile or listing verified.
-- Server-side functions (security definer) and triggers are unaffected.

revoke update on public.calls from authenticated;
grant update (status, answered_at, ended_at) on public.calls to authenticated;

revoke update on public.conversation_members from authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

revoke update on public.profiles from authenticated;
grant update (
  display_name, avatar_url, city, about,
  show_real_name, show_last_seen, read_receipts, allow_calls, last_seen_at
) on public.profiles to authenticated;

revoke update on public.listings from authenticated;
grant update (
  title, description, land_type, area_value, area_unit, price_total, negotiable,
  locality, district, state, lat, lng, boundary, hide_exact_location,
  survey_number, documents, features, images, status, panorama_url
) on public.listings to authenticated;
