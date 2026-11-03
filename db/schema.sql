-- Padel Tournament Center database schema (PostgreSQL / Neon).
-- The API runs these automatically on first use; this file is for reference
-- or for running by hand in the Neon SQL editor. Generated from api/_lib/schema.js.

CREATE TABLE IF NOT EXISTS tournaments (
  id                TEXT PRIMARY KEY,
  name              TEXT        NOT NULL,
  date              DATE,
  format            TEXT        NOT NULL,
  is_team           BOOLEAN     NOT NULL DEFAULT false,
  max_points        INT,
  courts            INT,
  rounds_played     INT         NOT NULL DEFAULT 0,
  participant_count INT         NOT NULL DEFAULT 0,
  is_finished       BOOLEAN     NOT NULL DEFAULT false,
  winner            TEXT,
  state             JSONB       NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS tournaments_date_idx ON tournaments (date DESC);

CREATE TABLE IF NOT EXISTS players (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('player', 'team')),
  name_key     TEXT NOT NULL,
  display_name TEXT NOT NULL,
  UNIQUE (kind, name_key)
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     INT  NOT NULL REFERENCES players(id),
  name          TEXT NOT NULL,
  final_rank    INT  NOT NULL,
  points        NUMERIC NOT NULL DEFAULT 0,
  points_lost   NUMERIC NOT NULL DEFAULT 0,
  played        INT  NOT NULL DEFAULT 0,
  wins          INT  NOT NULL DEFAULT 0,
  ties          INT  NOT NULL DEFAULT 0,
  losses        INT  NOT NULL DEFAULT 0,
  byes          INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS tournament_entries_player_idx ON tournament_entries (player_id);

CREATE TABLE IF NOT EXISTS matches (
  tournament_id TEXT    NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         INT     NOT NULL,
  court         INT     NOT NULL,
  team1         TEXT    NOT NULL,
  team2         TEXT    NOT NULL,
  score1        INT     NOT NULL,
  score2        INT     NOT NULL,
  weighted1     NUMERIC NOT NULL,
  weighted2     NUMERIC NOT NULL,
  multiplier    NUMERIC NOT NULL DEFAULT 1,
  PRIMARY KEY (tournament_id, round, court)
);

DO $$
 BEGIN
   IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'tournament_entries' AND column_name = 'points'
                 AND (data_type = 'integer' OR numeric_scale IS NOT NULL)) THEN
     DROP VIEW IF EXISTS player_career_stats;
     ALTER TABLE tournament_entries
       ALTER COLUMN points      TYPE NUMERIC,
       ALTER COLUMN points_lost TYPE NUMERIC;
   END IF;
   IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'matches' AND column_name = 'weighted1'
                 AND (data_type = 'integer' OR numeric_scale IS NOT NULL)) THEN
     ALTER TABLE matches
       ALTER COLUMN weighted1 TYPE NUMERIC,
       ALTER COLUMN weighted2 TYPE NUMERIC;
   END IF;
 END $$;

CREATE OR REPLACE VIEW player_career_stats AS
  SELECT p.id,
         p.kind,
         p.display_name                                              AS name,
         count(*)                                                    AS tournaments,
         count(*) FILTER (WHERE t.is_finished AND e.final_rank = 1)  AS titles,
         count(*) FILTER (WHERE t.is_finished AND e.final_rank <= 3) AS podiums,
         sum(e.played)                                               AS matches,
         sum(e.wins)                                                 AS wins,
         sum(e.ties)                                                 AS ties,
         sum(e.losses)                                               AS losses,
         round(100.0 * sum(e.wins) / nullif(sum(e.wins + e.ties + e.losses), 0), 1) AS win_pct,
         sum(e.points)                                               AS points_won,
         sum(e.points_lost)                                          AS points_lost,
         max(t.date)                                                 AS last_played
    FROM players p
    JOIN tournament_entries e ON e.player_id = p.id
    JOIN tournaments t        ON t.id = e.tournament_id
   GROUP BY p.id, p.kind, p.display_name;
