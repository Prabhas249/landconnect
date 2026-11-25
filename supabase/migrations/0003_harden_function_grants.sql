-- Signed-out clients may not call any function; trigger functions are not callable over the API at all.
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.handle_new_user(), public.auto_confirm_user(), public.touch_conversation(), public.touch_listing() from authenticated;
revoke execute on function public.shares_conversation(uuid, uuid) from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
