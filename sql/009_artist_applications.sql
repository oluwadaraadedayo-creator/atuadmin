-- A Thousand Units migration 009: artist applications
-- Run ONCE in the Supabase SQL Editor, after 002 to 008 (and your artwork and profile-limit files).
-- Adds the applications table, and updates the admin overview so it can show how many are waiting.

create table if not exists public.artist_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stage_name text not null check (char_length(trim(stage_name)) between 2 and 60),
  craft text not null check (craft in ('artist', 'producer', 'dj', 'other')),
  links text not null check (char_length(links) between 8 and 1500),     -- up to 5 links to existing music, one per line
  bio text check (bio is null or char_length(bio) <= 500),
  rights_confirmed boolean not null check (rights_confirmed),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),   -- shown to the applicant
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- One open application per person at a time. Someone who was turned down can apply again.
create unique index if not exists artist_applications_one_pending on public.artist_applications (user_id) where status = 'pending';
create index if not exists artist_applications_queue_idx on public.artist_applications (status, created_at desc);

alter table public.artist_applications enable row level security;
drop policy if exists "applicants see their own applications" on public.artist_applications;
create policy "applicants see their own applications" on public.artist_applications for select to authenticated using (user_id = auth.uid());
-- No insert, update or delete policies: applications are created and decided only by the server.
-- Applicants may read their own application, but not which administrator decided it.
revoke select on public.artist_applications from anon, authenticated;
grant select (id, user_id, stage_name, craft, links, bio, status, decision_note, created_at, decided_at) on public.artist_applications to authenticated;

create or replace function public.admin_list_applications(p_status text, p_limit integer, p_offset integer)
returns table (id uuid, created_at timestamptz, status text, user_id uuid, email text, display_name text, account_role text,
               stage_name text, craft text, links text, bio text, decision_note text, decided_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select a.id, a.created_at, a.status, a.user_id, u.email::text, p.display_name, p.role, a.stage_name, a.craft, a.links, a.bio, a.decision_note, a.decided_at
  from public.artist_applications a
  join public.profiles p on p.id = a.user_id
  join auth.users u on u.id = a.user_id
  where nullif(p_status, '') is null or a.status = p_status
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.admin_list_applications(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_applications(text, integer, integer) to service_role;

-- Same overview as before, with one more number.
create or replace function public.admin_overview() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'artists', (select count(*) from public.profiles where role = 'artist'),
    'unverifiedArtists', (select count(*) from public.profiles where role = 'artist' and not verified_artist),
    'pendingApplications', (select count(*) from public.artist_applications where status = 'pending'),
    'releasesPublished', (select count(*) from public.products where status = 'published'),
    'releasesRemoved', (select count(*) from public.products where status = 'removed'),
    'openReports', (select count(*) from public.takedown_reports where status = 'open'),
    'paidOrders', (select count(*) from public.orders where status = 'paid'),
    'unitsSold', (select coalesce(sum(quantity), 0) from public.orders where status = 'paid'),
    'grossMinor', (select coalesce(sum(amount_minor), 0) from public.orders where status = 'paid'),
    'followers', (select count(*) from public.follows),
    'activeCampaigns', (select count(*) from public.campaigns where status = 'active')
  );
$$;
