-- A counterparty's main contact (the owner's answer of 2026-10-30, docs/DECISIONS.md): the
-- person shown at the top of a buyer's or seller's page, with their phone and email.
--
-- At most one contact per counterparty is its main contact; the partial unique index holds
-- that even if two people choose different main contacts at the same moment. Operations and
-- org_admin members choose it, as they change contacts: updates go through the existing
-- counterparty_contacts_update_for_editors policy, now with this column granted. Removing
-- the main contact leaves the counterparty with none. The audit trigger records the change
-- like every other column. Existing contacts start as not main.

alter table app.counterparty_contacts add column is_main boolean not null default false;

create unique index counterparty_contacts_one_main
  on app.counterparty_contacts (counterparty_id) where is_main;

grant update (is_main) on app.counterparty_contacts to app_api;
