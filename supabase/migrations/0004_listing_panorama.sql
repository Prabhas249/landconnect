-- Optional 360-degree site photo (equirectangular, 2:1) shown in the listing's look-around viewer.
alter table public.listings add column if not exists panorama_url text;
comment on column public.listings.panorama_url is 'Optional equirectangular (2:1) 360-degree site photo.';
