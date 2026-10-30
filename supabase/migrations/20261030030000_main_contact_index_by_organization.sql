-- The one-main-contact index keyed by organization too (Codex's review of
-- ivanmueller/gss#78, the same gap as the commodity list's key).
--
-- A unique index is checked before the tenant-matching foreign key. Keyed by counterparty
-- alone, another organization's member could add a contact of their own organization
-- naming this organization's counterparty as main, and learn from a unique violation
-- (23505) instead of the foreign key's refusal (23503) whether that counterparty has a main
-- contact. Keyed by organization and counterparty, such a row never meets this
-- organization's, and the foreign key refuses it. Within one organization the rule is the
-- same: at most one main contact per counterparty.

drop index app.counterparty_contacts_one_main;

create unique index counterparty_contacts_one_main
  on app.counterparty_contacts (organization_id, counterparty_id) where is_main;
