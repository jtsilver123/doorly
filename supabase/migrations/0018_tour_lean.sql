-- A soft read on a toured place: leaning yes (1), leaning no (-1), or
-- undecided (0). Deliberately not a stage and not feedback — thumbs after a
-- tour are a gut impression you want recorded before it fades, without the
-- commitment of passing or applying, and without teaching the ranker anything.
alter table user_listing_state add column if not exists lean smallint not null default 0;
