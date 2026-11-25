-- Demo media for the LandConnect demo database (idempotent: plain UPDATEs keyed by id).
-- Listing photos: Unsplash (Unsplash License). Avatars: Unsplash (Unsplash License).
-- 360 panoramas: Poly Haven HDRI previews (CC0), served by cdn.polyhaven.com (1920x960 equirectangular).

begin;

-- Ramanagara farmhouse
update public.listings set images = array[
    'https://images.unsplash.com/photo-1763816589196-45607083c4f9?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1611129080186-5d0940f9ab83?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1558963235-eff20c9f7d99?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1609226511778-60c277756b6e?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1641188721985-a090d0577e24?auto=format&fit=crop&w=1600&q=80&h=1067'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/rosendal_plains_2.png?width=2048&format=jpg'
where id = '3a4aecee-c1bd-4684-93e3-649299edf0f1';

-- Kadugodi commercial
update public.listings set images = array[
    'https://images.unsplash.com/photo-1709625215458-69e36584c9f1?auto=format&fit=crop&w=1600&q=80&h=1067',
    'https://images.unsplash.com/photo-1749028006596-840665bf70b4?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586777144620-4869a8bc0f84?auto=format&fit=crop&w=1600&q=80&h=1067',
    'https://images.unsplash.com/photo-1586859821397-c81e4971ca82?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1709735133497-bbead76953a9?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = null
where id = 'c4dee38f-378b-440f-a360-611facd29233';

-- Narsapura industrial
update public.listings set images = array[
    'https://images.unsplash.com/photo-1662958656945-746c5758f62d?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1654143487566-d5487d255562?auto=format&fit=crop&w=1600&q=80&h=1067',
    'https://images.unsplash.com/photo-1663001822575-a2b7f831491e?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1749028006596-840665bf70b4?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586859821397-c81e4971ca82?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/quarry_02.png?width=2048&format=jpg'
where id = '06dcaa5a-8f45-4f63-95cf-0013afa000fd';

-- Magadi coconut
update public.listings set images = array[
    'https://images.unsplash.com/photo-1724060507960-729010a461ba?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1581595556643-cddeca792ae5?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1665202839133-2ed694720107?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1698070010730-6e0b7483a78b?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1657302157898-eda546941dde?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1749026314459-3fb459710f01?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/dry_orchard_meadow.png?width=2048&format=jpg'
where id = '7c23beaf-9522-4555-9333-532aec1cd2e3';

-- Anekal residential
update public.listings set images = array[
    'https://images.unsplash.com/photo-1785300674642-52ff0f3bd20a?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1689113690645-108964df3f56?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586777144620-4869a8bc0f84?auto=format&fit=crop&w=1600&q=80&h=1067',
    'https://images.unsplash.com/photo-1641701212196-dec15e3bdf59?auto=format&fit=crop&w=1600&q=80&h=1067',
    'https://images.unsplash.com/photo-1586859821397-c81e4971ca82?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = null
where id = 'fc81d0b2-3eda-4a02-850a-527454f2e5b5';

-- Nelamangala warehousing
update public.listings set images = array[
    'https://images.unsplash.com/photo-1787063757757-6609756ad14f?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1655575900119-2f19ba5718d0?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1709735133497-bbead76953a9?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1596829568009-bc436aac1b63?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1774013603237-fcb40a354104?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = null
where id = '3538b431-b77a-4d33-8ab5-5a167514cfef';

-- Doddaballapura grape/veg
update public.listings set images = array[
    'https://images.unsplash.com/photo-1560493676-04071c5f467b?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1721980537549-ceddce56ea5d?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586771107445-d3ca888129ff?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1666545743813-e692fb2b2430?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/waterkloof_farm.png?width=2048&format=jpg'
where id = 'ba177216-0900-486e-9abe-58ac7b255753';

-- Sarjapur residential
update public.listings set images = array[
    'https://images.unsplash.com/photo-1747854805840-9be7d5e360e6?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1773299567657-a4bf83503ce5?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1774697443203-0f54409d1613?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1689113690645-108964df3f56?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586859821397-c81e4971ca82?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = null
where id = '6020fca4-1cee-40b7-932d-50c2384ca922';

-- Devanahalli red soil
update public.listings set images = array[
    'https://images.unsplash.com/photo-1611129080186-5d0940f9ab83?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1609226511778-60c277756b6e?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586771107445-d3ca888129ff?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1560493676-04071c5f467b?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1676356352238-c24e3367a978?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1581595556643-cddeca792ae5?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/farm_field.png?width=2048&format=jpg'
where id = 'cd762929-a485-4c97-8831-a33f2204f416';

-- Kanakapura farmhouse
update public.listings set images = array[
    'https://images.unsplash.com/photo-1652820330042-92a30b18abc5?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1626924924891-5d225d628e4e?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1698150098242-cc61d0df20eb?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1710440453600-6e358005befd?auto=format&fit=crop&w=1600&q=80&h=1067',
    'https://images.unsplash.com/photo-1749026314459-3fb459710f01?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/rural_crossroads.png?width=2048&format=jpg'
where id = '24b697ff-e6fc-4234-990c-7db3844306ac';

-- Hoskote commercial
update public.listings set images = array[
    'https://images.unsplash.com/photo-1709625215434-4de54b5f532a?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1663001822575-a2b7f831491e?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1596829568009-bc436aac1b63?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1709735133497-bbead76953a9?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1586859821397-c81e4971ca82?auto=format&fit=crop&w=1600&q=80'
  ]::text[],
  panorama_url = 'https://cdn.polyhaven.com/asset_img/primary/hochsal_field.png?width=2048&format=jpg'
where id = '81c355a0-2fc5-43d5-9a37-2ea21334f276';

-- Avatars
update public.profiles set avatar_url = 'https://images.unsplash.com/photo-1712425718137-491250cfde88?auto=format&w=400&h=400&fit=crop&crop=focalpoint&fp-x=.5&fp-y=.38&fp-z=1.3&q=80' where id = 'b596b07c-96c0-4c2f-b959-abb752e6bd98'; -- Arjun Rao
update public.profiles set avatar_url = 'https://images.unsplash.com/photo-1670110531916-41045e83cb0a?auto=format&w=400&h=400&fit=crop&crop=focalpoint&fp-x=.5&fp-y=.4&fp-z=2&q=80' where id = '7b003703-913a-4c03-9cc9-3900760df4f0'; -- Imran Sheikh
update public.profiles set avatar_url = 'https://images.unsplash.com/photo-1742981365880-698cfb84492d?auto=format&w=400&h=400&fit=crop&crop=focalpoint&fp-x=.5&fp-y=.38&fp-z=1.9&q=80' where id = '31817908-4c9b-4820-be7d-f53c9dac837a'; -- Kiran Reddy
update public.profiles set avatar_url = 'https://images.unsplash.com/photo-1628477116196-48afe0d209e0?auto=format&w=400&h=400&fit=crop&crop=focalpoint&fp-x=.5&fp-y=.45&fp-z=1.4&q=80' where id = '619833d6-9932-4ac0-955b-b2ee7ed4c5fc'; -- Lakshmi Gowda
update public.profiles set avatar_url = 'https://images.unsplash.com/photo-1758518729459-235dcaadc611?auto=format&w=400&h=400&fit=crop&crop=focalpoint&fp-x=.58&fp-y=.38&fp-z=1.5&q=80' where id = '6be8d444-8ba8-4d2e-a793-1aab57633c4b'; -- Meera Iyer
update public.profiles set avatar_url = 'https://images.unsplash.com/photo-1758518729466-827cd8293992?auto=format&w=400&h=400&fit=crop&crop=focalpoint&fp-x=.69&fp-y=.3&fp-z=2.2&q=80' where id = 'd84de724-c42d-4781-94a1-f61a554a5626'; -- Nandini Hegde

commit;
