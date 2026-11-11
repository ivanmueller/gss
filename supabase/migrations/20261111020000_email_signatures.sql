-- Email through the platform, step 3: each person's title and phone for the team signature
-- (F-114; the owner's answers of 2026-11-10 in docs/FEATURES.md, 11 and 12). The signature
-- (app.email_settings) is filled with the sender's name, title, phone and email when sending;
-- admins type each person's title and phone on Team, beside their address. A person's private
-- cell (app.member_phones) is never used.

create table app.member_signature_details (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  title text check (length(title) between 1 and 100 and title !~ '[[:cntrl:]]'),
  -- The contacts' phone rule (20261027030100_counterparty_directory.sql).
  phone text check (length(phone) between 3 and 40 and phone ~ '^[0-9+(). /x-]+$'),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  -- A row with nothing in it is deleted instead.
  check (title is not null or phone is not null),
  constraint member_signature_details_member_fkey foreign key (organization_id, user_id)
    references app.organization_members (organization_id, user_id)
);

create trigger member_signature_details_touch_updated_at
  before update on app.member_signature_details
  for each row execute function app.touch_updated_at();
create trigger member_signature_details_audit
  after insert or update or delete on app.member_signature_details
  for each row execute function app.record_audit_event();

alter table app.member_signature_details enable row level security;

-- Everyone on the team sees the team's signature details, as they see the addresses.
create policy member_signature_details_select_for_members on app.member_signature_details
  for select to app_api using (app.is_active_member(organization_id));

-- Admins: a person's title and phone for the signature; both blank removes them. Locked and
-- checked in the order of app.save_member_email_address (Codex's review of F-114-2, R4-01).
create function app.save_member_signature(org uuid, member uuid, new_title text, new_phone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  wanted_title text := nullif(btrim(new_title), '');
  wanted_phone text := nullif(btrim(new_phone), '');
begin
  if uid is null or not app.is_active_member(org) then
    return 'forbidden';
  end if;
  perform 1 from app.organizations o where o.id = org for update;
  if not app.is_org_admin(org) then
    return 'forbidden';
  end if;
  if not exists (select 1 from app.organization_members m
                  where m.organization_id = org and m.user_id = member) then
    return 'not_a_member';
  end if;
  if wanted_title is null and wanted_phone is null then
    delete from app.member_signature_details d where d.organization_id = org and d.user_id = member;
    return 'saved';
  end if;
  insert into app.member_signature_details (organization_id, user_id, title, phone)
  values (org, member, wanted_title, wanted_phone)
  on conflict (organization_id, user_id) do update
    set title = excluded.title, phone = excluded.phone;
  return 'saved';
end
$$;

revoke all on app.member_signature_details from public, anon, authenticated, service_role, app_api;
revoke all on function app.save_member_signature(uuid, uuid, text, text)
  from public, anon, authenticated, service_role, app_api;
grant select on app.member_signature_details to app_api;
grant execute on function app.save_member_signature(uuid, uuid, text, text) to app_api;
