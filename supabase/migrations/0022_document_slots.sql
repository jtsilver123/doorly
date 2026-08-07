-- Which checklist requirement a packet document satisfies ("photo_id",
-- "g_tax_returns"). Empty means unfiled. A checked box is a promise; a file
-- in the slot is the thing itself.
alter table user_documents add column if not exists slot text not null default '';
