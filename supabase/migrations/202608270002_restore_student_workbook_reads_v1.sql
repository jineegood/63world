-- Restore the workbook read boundary required by the recovered local PvE client.
--
-- 202607260004 removed authenticated workbook reads while preparing a fully
-- server-authoritative PvE client. The deployed recovery branch intentionally
-- keeps ordinary PvE local, so that policy left students seeing zero rows and
-- silently falling back to the bundled 63-village questions.

grant select on table public.shared_state_v2 to authenticated;

drop policy if exists "authenticated users read shared state v2"
  on public.shared_state_v2;
drop policy if exists "authenticated users read fixed shared state v2"
  on public.shared_state_v2;
drop policy if exists "authenticated users read classroom settings v3"
  on public.shared_state_v2;

create policy "authenticated users read fixed shared state v2"
on public.shared_state_v2
for select
to authenticated
using (key in ('classroom_settings', 'workbooks'));

-- Writes remain covered only by the existing trusted-teacher policy. Anonymous
-- users still read classroom_settings only and never receive workbook answers.
