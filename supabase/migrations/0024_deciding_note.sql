-- What a post-tour "still deciding" is waiting on, next to the check-back
-- day that already lives in follow_up_at.
alter table user_listing_state add column if not exists follow_up_note text not null default '';
