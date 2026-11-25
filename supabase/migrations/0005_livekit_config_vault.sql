-- The livekit-token edge function reads its LiveKit credentials from Supabase Vault when they are not
-- set as function secrets. Only the service role (used inside the edge function) may call this.
-- Store the values once with:
--   select vault.create_secret('wss://<project>.livekit.cloud', 'livekit_url');
--   select vault.create_secret('<api key>', 'livekit_api_key');
--   select vault.create_secret('<api secret>', 'livekit_api_secret');
create or replace function public.livekit_config()
returns table (url text, api_key text, api_secret text)
language sql stable security definer set search_path = '' as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'livekit_url'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'livekit_api_key'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'livekit_api_secret');
$$;
revoke all on function public.livekit_config() from public, anon, authenticated;
grant execute on function public.livekit_config() to service_role;
