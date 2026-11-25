-- LandConnect prototype schema
-- Roles, listings, chat, meeting rooms, calls, privacy. Every table is behind RLS.

create extension if not exists "pgcrypto";

-- ───────────────────────────── enums
create type public.user_role as enum ('buyer', 'seller', 'broker');
create type public.land_type as enum ('agricultural', 'residential', 'commercial', 'industrial', 'farmhouse');
create type public.area_unit as enum ('acre', 'gunta', 'cent', 'sqft', 'sqyd');
create type public.listing_status as enum ('draft', 'active', 'under_offer', 'sold');
create type public.conversation_kind as enum ('direct', 'room');
create type public.message_kind as enum ('text', 'image', 'listing', 'call', 'system');
create type public.call_kind as enum ('audio', 'video');
create type public.call_status as enum ('ringing', 'accepted', 'rejected', 'missed', 'cancelled', 'ended');
create type public.call_permission as enum ('everyone', 'contacts', 'nobody');

-- ───────────────────────────── profiles
-- Public-facing identity. Nothing here is a personal contact detail.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'buyer',
  display_name text not null,
  -- Anonymous handle shown instead of the name when `show_real_name` is off, e.g. "Buyer · B-2041".
  handle text not null unique,
  avatar_url text,
  city text,
  about text,
  verified boolean not null default false,
  -- privacy controls
  show_real_name boolean not null default true,
  show_last_seen boolean not null default true,
  read_receipts boolean not null default true,
  allow_calls public.call_permission not null default 'contacts',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Personal contact details live in a separate owner-only table so no query path can leak them.
create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  phone text,
  email text,
  updated_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- ───────────────────────────── listings
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  land_type public.land_type not null default 'agricultural',
  area_value numeric(12, 2) not null check (area_value > 0),
  area_unit public.area_unit not null default 'acre',
  price_total numeric(16, 2) not null check (price_total > 0), -- INR
  negotiable boolean not null default true,
  locality text not null,
  district text not null default '',
  state text not null default 'Karnataka',
  lat double precision not null,
  lng double precision not null,
  -- Parcel outline as [[lng, lat], ...]; null when only a pin was dropped.
  boundary jsonb,
  -- When true, non-participants see an approximate area instead of the exact pin.
  hide_exact_location boolean not null default false,
  survey_number text,
  documents text[] not null default '{}',
  features text[] not null default '{}',
  images text[] not null default '{}',
  status public.listing_status not null default 'active',
  verified boolean not null default false,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_owner_idx on public.listings (owner_id);
create index listings_status_idx on public.listings (status, created_at desc);

create table public.saved_listings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ───────────────────────────── conversations (direct chats + meeting rooms)
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null default 'direct',
  -- Stable key for a direct pair + listing so "Message seller" is idempotent.
  direct_key text unique,
  listing_id uuid references public.listings (id) on delete set null,
  title text,
  agenda text,
  scheduled_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  last_message_sender uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text not null default '',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

-- ───────────────────────────── calls (signalling state; media goes through LiveKit)
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id uuid not null references public.profiles (id) on delete cascade,
  -- null for meeting-room sessions, which anyone in the room may join.
  callee_id uuid references public.profiles (id) on delete cascade,
  kind public.call_kind not null default 'audio',
  status public.call_status not null default 'ringing',
  room_name text not null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index calls_callee_idx on public.calls (callee_id, created_at desc);
create index calls_caller_idx on public.calls (caller_id, created_at desc);

-- ───────────────────────────── helpers
create or replace function public.is_member(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.user_id = auth.uid()
  );
$$;

create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- Two users are "contacts" once they share any conversation.
create or replace function public.shares_conversation(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members x
    join public.conversation_members y using (conversation_id)
    where x.user_id = a and y.user_id = b
  );
$$;

-- Profile row is created from sign-up metadata, so the role is fixed server-side at registration.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.user_role := coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'buyer');
  prefix text := case r when 'buyer' then 'B' when 'seller' then 'S' else 'K' end;
  h text;
begin
  loop
    h := initcap(r::text) || ' · ' || prefix || '-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where handle = h);
  end loop;

  insert into public.profiles (id, role, display_name, handle, city)
  values (
    new.id,
    r,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    h,
    new.raw_user_meta_data ->> 'city'
  );
  insert into public.profile_private (id, email, phone)
  values (new.id, new.email, new.raw_user_meta_data ->> 'phone');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the conversation preview in sync for the chat list.
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_message_sender = new.sender_id,
      last_message_preview = case new.kind
        when 'text' then left(new.body, 120)
        when 'image' then 'Photo'
        when 'listing' then 'Shared a listing'
        when 'call' then coalesce(new.body, 'Call')
        else left(new.body, 120)
      end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger on_message_created
  after insert on public.messages
  for each row execute function public.touch_conversation();

create or replace function public.touch_listing()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger on_listing_updated
  before update on public.listings
  for each row execute function public.touch_listing();

-- Open (or reuse) a direct conversation about a listing. Enforces blocks.
create or replace function public.open_direct_conversation(other_user uuid, about_listing uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k text;
  conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user = me then raise exception 'cannot message yourself'; end if;
  if public.is_blocked(me, other_user) then raise exception 'conversation unavailable'; end if;

  k := least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);

  select id into conv from public.conversations where direct_key = k;
  if conv is null then
    insert into public.conversations (kind, direct_key, listing_id, created_by)
    values ('direct', k, about_listing, me)
    returning id into conv;
    insert into public.conversation_members (conversation_id, user_id) values (conv, me), (conv, other_user);
  elsif about_listing is not null then
    update public.conversations set listing_id = about_listing where id = conv;
  end if;
  return conv;
end;
$$;

-- Create a meeting room and add the invited members.
create or replace function public.create_room(room_title text, room_agenda text, starts_at timestamptz, member_ids uuid[], about_listing uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  conv uuid;
  m uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  insert into public.conversations (kind, title, agenda, scheduled_at, listing_id, created_by, last_message_preview)
  values ('room', room_title, room_agenda, starts_at, about_listing, me, 'Room created')
  returning id into conv;

  insert into public.conversation_members (conversation_id, user_id) values (conv, me);
  foreach m in array coalesce(member_ids, '{}') loop
    if m <> me and not public.is_blocked(me, m) then
      insert into public.conversation_members (conversation_id, user_id) values (conv, m)
      on conflict do nothing;
    end if;
  end loop;
  return conv;
end;
$$;

-- Start a 1:1 call. Enforces blocks and the callee's "who can call me" setting.
create or replace function public.start_call(conv uuid, call_kind public.call_kind)
returns public.calls language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other uuid;
  perm public.call_permission;
  c public.calls;
begin
  if not public.is_member(conv) then raise exception 'not a member of this conversation'; end if;

  select user_id into other from public.conversation_members
  where conversation_id = conv and user_id <> me limit 1;
  if other is null then raise exception 'nobody to call'; end if;
  if public.is_blocked(me, other) then raise exception 'call unavailable'; end if;

  select allow_calls into perm from public.profiles where id = other;
  if perm = 'nobody' then raise exception 'This person is not accepting calls'; end if;

  -- Expire stale ringing calls between the pair.
  update public.calls set status = 'missed', ended_at = now()
  where conversation_id = conv and status = 'ringing';

  insert into public.calls (conversation_id, caller_id, callee_id, kind, room_name)
  values (conv, me, other, call_kind, 'call-' || gen_random_uuid()::text)
  returning * into c;
  return c;
end;
$$;

create or replace function public.increment_listing_views(target uuid)
returns void language sql security definer set search_path = public as $$
  update public.listings set views = views + 1 where id = target and owner_id <> auth.uid();
$$;

-- ───────────────────────────── row level security
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.blocks enable row level security;
alter table public.listings enable row level security;
alter table public.saved_listings enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;

-- profiles: readable by signed-in users (unless blocked), editable only by the owner.
create policy "profiles readable" on public.profiles for select to authenticated
  using (not public.is_blocked(auth.uid(), id));
create policy "profiles self update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = public.my_role());

-- private contact details: owner only, always.
create policy "private self read" on public.profile_private for select to authenticated using (id = auth.uid());
create policy "private self update" on public.profile_private for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "blocks self" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- listings: everyone browses active listings; only sellers and brokers may create and manage their own.
create policy "listings browse" on public.listings for select to authenticated
  using (owner_id = auth.uid() or status <> 'draft');
create policy "listings create (seller/broker)" on public.listings for insert to authenticated
  with check (owner_id = auth.uid() and public.my_role() in ('seller', 'broker'));
create policy "listings manage own" on public.listings for update to authenticated
  using (owner_id = auth.uid() and public.my_role() in ('seller', 'broker'))
  with check (owner_id = auth.uid());
create policy "listings delete own" on public.listings for delete to authenticated
  using (owner_id = auth.uid() and public.my_role() in ('seller', 'broker'));

create policy "saved self" on public.saved_listings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- conversations and messages: members only.
create policy "conversations members" on public.conversations for select to authenticated
  using (public.is_member(id));
create policy "conversations members update" on public.conversations for update to authenticated
  using (public.is_member(id)) with check (public.is_member(id));

create policy "members visible to members" on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id));
create policy "members update own read state" on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members leave" on public.conversation_members for delete to authenticated
  using (user_id = auth.uid());

create policy "messages read" on public.messages for select to authenticated
  using (public.is_member(conversation_id));
create policy "messages send" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));

-- calls: visible to participants (and room members); only participants may change status.
create policy "calls read" on public.calls for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid() or (callee_id is null and public.is_member(conversation_id)));
create policy "calls room start" on public.calls for insert to authenticated
  with check (caller_id = auth.uid() and callee_id is null and public.is_member(conversation_id));
create policy "calls update" on public.calls for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid() or (callee_id is null and public.is_member(conversation_id)));

-- ───────────────────────────── realtime
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.conversation_members;
alter table public.calls replica identity full;

-- ───────────────────────────── storage: listing and chat images
insert into storage.buckets (id, name, public) values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

create policy "listing images public read" on storage.objects for select
  using (bucket_id = 'listing-images');
create policy "listing images upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "listing images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);
