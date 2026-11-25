-- Prototype convenience: confirm new accounts immediately so sign-up needs no email round trip.
-- Remove this (and enable email confirmation) before any real launch.
create or replace function public.auto_confirm_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is null then new.email_confirmed_at := now(); end if;
  return new;
end; $$;

drop trigger if exists auto_confirm_user on auth.users;
create trigger auto_confirm_user before insert on auth.users
  for each row execute function public.auto_confirm_user();
