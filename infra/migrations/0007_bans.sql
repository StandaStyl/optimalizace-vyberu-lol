-- Bans from Match-V5 info.teams[].bans (SPEC-06). Older matches have no rows here.
create table match_ban (
  match_id    text not null references match(match_id) on delete cascade,
  team_id     smallint not null check (team_id in (100,200)),
  champion_id int not null,
  pick_turn   smallint not null,
  primary key (match_id, team_id, pick_turn)
);
create index match_ban_champ_idx on match_ban (champion_id);
