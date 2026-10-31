-- Admins delete archived counterparties (the owner's request of 2026-10-31, docs/DECISIONS.md).
--
-- Until now a counterparty was never deleted, only archived (20261028010000_counterparty_editing.sql).
-- An org_admin of its organization may now delete one once it is archived, with its contacts,
-- locations, commodities and logo; the API deletes those first. One with history is kept:
-- bids and offers, freight rates (as carrier, or at one of its locations), contact log
-- entries and follow-ups (removed ones too) refer to it, and their foreign keys refuse the
-- delete; the API checks first and says so. Every delete is audited by the existing triggers:
-- who, when, which record.
--
-- Contacts, locations and commodities could already be removed by editors and members. Only
-- the two policies below are new: operations, traders and viewers still cannot delete a
-- counterparty or its logo, and nobody can delete one that is not archived.

create policy counterparties_delete_archived_for_admins on app.counterparties
  for delete to app_api
  using (app.is_org_admin(organization_id) and archived_at is not null);

create policy counterparty_logos_delete_archived_for_admins on app.counterparty_logos
  for delete to app_api
  using (
    app.is_org_admin(organization_id)
    and exists (select from app.counterparties c
                where c.id = counterparty_id and c.organization_id = counterparty_logos.organization_id
                  and c.archived_at is not null)
  );

grant delete on app.counterparties, app.counterparty_logos to app_api;

-- An archived counterparty's commodities could not change at all (GS005,
-- 20261030020000_counterparty_commodities.sql). Deleting the counterparty deletes them first,
-- so its organization's admins may now delete them; adding, verifying and every other
-- member's removal are refused as before. Otherwise unchanged.
create or replace function app.check_counterparty_commodity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.counterparty_id else new.counterparty_id end;
  organization uuid :=
    case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  archived boolean;
begin
  if not app.is_active_member(organization) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select c.archived_at is not null into archived
    from app.counterparties c where c.id = target and c.organization_id = organization
    for share;
  if archived and not (tg_op = 'DELETE' and app.is_org_admin(organization)) then
    raise exception 'an archived counterparty''s commodities cannot be changed'
      using errcode = 'GS005';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
