-- Where you actually apply. Landlords send portal links (RentSpree, Funnel,
-- on-site forms) that otherwise die in a text thread — this pins the link to
-- the listing, on your own state row like notes and contacts.
alter table user_listing_state
  add column if not exists application_url text not null default '';
