-- What the landlord said back: 1 accepted, -1 denied, 0 still waiting. And
-- secured, the one flag the whole hunt exists to set: accepted AND taken.
alter table user_listing_state add column if not exists app_result smallint not null default 0;
alter table user_listing_state add column if not exists secured boolean not null default false;
