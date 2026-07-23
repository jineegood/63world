-- Narrow shared classroom reads while preserving trusted teacher administration.

grant select on table public.shared_state_v2 to anon;

drop policy if exists "authenticated users read shared state v2" on public.shared_state_v2;

drop policy if exists "public reads classroom settings v2" on public.shared_state_v2;
create policy "public reads classroom settings v2"
on public.shared_state_v2 for select to anon
using (key = 'classroom_settings');

drop policy if exists "authenticated users read fixed shared state v2" on public.shared_state_v2;
create policy "authenticated users read fixed shared state v2"
on public.shared_state_v2 for select to authenticated
using (key in ('classroom_settings', 'workbooks'));

drop policy if exists "teachers administer shared state v2" on public.shared_state_v2;
create policy "teachers administer shared state v2"
on public.shared_state_v2 for all to authenticated
using ((select public.is_teacher()))
with check ((select public.is_teacher()));
