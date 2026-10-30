-- A Thousand Units migration 007: admin tools
-- Run ONCE in the Supabase SQL Editor, after 002 to 006.
-- Adds an audit log and the read functions the separate admin app uses.
-- Only the server (service role) can run these. Nobody signed in through the website or the admin page can call them directly.

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_recent_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;   -- no policies: server only

create or replace function public.admin_overview() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'artists', (select count(*) from public.profiles where role = 'artist'),
    'unverifiedArtists', (select count(*) from public.profiles where role = 'artist' and not verified_artist),
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

-- Search text is escaped so % and _ in what an admin types are treated as plain characters.
create or replace function public.admin_find_users(p_q text, p_role text, p_limit integer, p_offset integer)
returns table (id uuid, email text, display_name text, role text, verified_artist boolean, featured_order integer,
               hidden_from_makers boolean, strikes integer, suspended_at timestamptz, created_at timestamptz, releases bigint)
language sql stable security definer set search_path = public, auth as $$
  select p.id, u.email::text, p.display_name, p.role, p.verified_artist, p.featured_order, p.hidden_from_makers,
         coalesce(c.strikes, 0), c.suspended_at, p.created_at,
         (select count(*) from public.products pr where pr.creator_id = p.id and pr.status = 'published')
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.creator_compliance c on c.profile_id = p.id
  where (nullif(trim(p_q), '') is null
         or u.email ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
         or p.display_name ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
    and (nullif(p_role, '') is null or p.role = p_role)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.admin_list_orders(p_q text, p_status text, p_limit integer, p_offset integer)
returns table (id uuid, created_at timestamptz, paid_at timestamptz, status text, amount_minor integer, quantity integer,
               platform_fee_minor integer, buyer_email text, payment_reference text, product_id uuid, product_title text,
               creator_id uuid, creator_name text)
language sql stable security definer set search_path = public, auth as $$
  select o.id, o.created_at, o.paid_at, o.status::text, o.amount_minor, o.quantity, o.platform_fee_minor, o.buyer_email,
         o.payment_reference, o.product_id, pr.title, o.creator_id, cp.display_name
  from public.orders o
  join public.products pr on pr.id = o.product_id
  join public.profiles cp on cp.id = o.creator_id
  where (nullif(p_status, '') is null or o.status::text = p_status)
    and (nullif(trim(p_q), '') is null
         or o.buyer_email ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
         or o.payment_reference ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
         or pr.title ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  order by o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.admin_list_reports(p_status text, p_limit integer, p_offset integer)
returns table (id uuid, created_at timestamptz, status text, reporter_name text, reporter_email text, relationship text,
               work_description text, signature text, resolution text, handled_at timestamptz, product_id uuid, product_title text,
               product_status text, creator_id uuid, creator_name text)
language sql stable security definer set search_path = public, auth as $$
  select r.id, r.created_at, r.status, r.reporter_name, r.reporter_email, r.relationship, r.work_description, r.signature,
         r.resolution, r.handled_at, r.product_id, pr.title, pr.status::text, pr.creator_id, cp.display_name
  from public.takedown_reports r
  join public.products pr on pr.id = r.product_id
  join public.profiles cp on cp.id = pr.creator_id
  where nullif(p_status, '') is null or r.status = p_status
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.admin_list_products(p_q text, p_status text, p_limit integer, p_offset integer)
returns table (id uuid, title text, status text, category text, price_minor integer, pricing_mode text, published_at timestamptz,
               creator_id uuid, creator_name text, units_sold bigint, open_reports bigint)
language sql stable security definer set search_path = public, auth as $$
  select pr.id, pr.title, pr.status::text, pr.category, pr.price_minor, pr.pricing_mode, pr.published_at, pr.creator_id, cp.display_name,
         (select coalesce(sum(o.quantity), 0) from public.orders o where o.product_id = pr.id and o.status = 'paid'),
         (select count(*) from public.takedown_reports r where r.product_id = pr.id and r.status = 'open')
  from public.products pr
  join public.profiles cp on cp.id = pr.creator_id
  where (nullif(p_status, '') is null or pr.status::text = p_status)
    and (nullif(trim(p_q), '') is null
         or pr.title ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
         or cp.display_name ilike '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
  order by pr.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_overview() from public, anon, authenticated;
revoke all on function public.admin_find_users(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_list_orders(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_list_reports(text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_list_products(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;
grant execute on function public.admin_find_users(text, text, integer, integer) to service_role;
grant execute on function public.admin_list_orders(text, text, integer, integer) to service_role;
grant execute on function public.admin_list_reports(text, integer, integer) to service_role;
grant execute on function public.admin_list_products(text, text, integer, integer) to service_role;
