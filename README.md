# 🎾 Padel Tournament Center

A free, installable web app for running padel tournaments: Americano, Mexicano, Team formats and Beat the Box. It works offline in the browser, and when it is deployed on Vercel with a free Neon Postgres database it keeps a permanent, shared record of every tournament and every player's career stats.

> **Repository description (for the GitHub "About" box):**
> Padel tournament manager PWA — Americano, Mexicano, Team and Beat the Box formats with live scoring, leaderboards, an online tournament archive and all-time player stats. Vanilla JS + Vercel + Neon Postgres.

**Suggested topics:** `padel` `tournament-manager` `americano` `mexicano` `pwa` `vanilla-js` `sports` `offline-first` `vercel` `neon` `postgres`

## Features

- **Seven formats**
  - Super Mexicano (individual; rounds 1–2 flat, then higher courts score more, see below)
  - Standard Mexicano (individual, seeded by rank)
  - Standard Americano (individual, social mix)
  - Team Mexicano (fixed duos, seeded by rank)
  - Team Americano (fixed duos, social mix)
  - Beat the Box (king of the court, Box 1 to 8 ladder)
  - Hybrid (Mexicano seeding, a new partner every match, challenge rounds, no multipliers; see below)
- **1–8 courts**, match targets of 8 / 16 / 20 / 24 / 32 points
- **Live scoring** with automatic re-ranking after each round and byes handled for you
- **Leaderboard** with points won (with multipliers), points at 1.0x, points lost, difference, played, W/T/L and byes
- **Fair rest points:** from 1.0x scores, a resting player gets the round's base score (total points scored ÷ players who played) if they haven't played yet, (base score + their score) ÷ 2 after one game, or their own average after two or more; then times the multiplier of the court their standing puts them on
- **Match history** and, for Americano formats, a full upcoming-rounds schedule
- **Archive:** every tournament auto-saves; resume, review or delete it later
- **Online database (new):** tournaments sync to Postgres, so the archive is the same on every phone and laptop and survives clearing the browser
- **Player stats:** all-time table of every player and team, ranked by average points per match (1.0x points ÷ matches played), then win %, then titles, with each player's tournament history
- **Record past tournaments:** add an old tournament from its final table (points won/lost, W/T/L per player); it goes into the archive, the database and Player stats
- **Champion celebration** with confetti when a tournament is finished
- **Responsive UI:** sidebar on desktop, icon rail on tablet, hamburger drawer on phones
- **PWA:** installable, works offline after the first visit

## Super Mexicano multipliers

Rounds 1–2 are flat 1.0x. From round 3, each court's scores are multiplied by:

| Courts | Court 1 | Court 2 | Court 3 | Court 4 | Court 5 | Court 6 | Court 7 | Court 8 |
|---|---|---|---|---|---|---|---|---|
| 1 | 1.0 | | | | | | | |
| 2 | 1.1 | 1.0 | | | | | | |
| 3 | 1.2 | 1.1 | 1.0 | | | | | |
| 4 | 1.225 | 1.15 | 1.075 | 1.0 | | | | |
| 5 | 1.3 | 1.225 | 1.15 | 1.075 | 1.0 | | | |
| 6 | 1.3 | 1.24 | 1.18 | 1.12 | 1.06 | 1.0 | | |
| 7 | 1.3 | 1.25 | 1.2 | 1.15 | 1.1 | 1.05 | 1.0 | |
| 8 | 1.3 | 1.257 | 1.214 | 1.171 | 1.129 | 1.086 | 1.043 | 1.0 |

The bottom court is always 1.0x; from 5 courts the top court is capped at 1.3x. Change the values in `SUPER_MEXICANO_COURT_MULTIPLIERS` in `app.js`.

Points are kept exact (e.g. 9 × 1.225 = 11.025) in the app and the database, and every calculation and ranking uses the exact values. Screens show whole numbers rounded to the nearest (14.8 → 15, 15.3 → 15); hover over a points value to see the exact figure.

## Hybrid mode

No multipliers, and nobody ever partners the same player twice in a row.

1. **Rounds 1–2, Americano mix:** random courts, then new partners and (as far as possible) new opponents. This builds the first leaderboard.
2. **Round 3 onwards, normal rounds:** players are ranked by the leaderboard. Extra players (up to 3: 8–11 players on 2 courts, 12–15 on 3) rest in turn: nobody rests again until everyone else has rested, and never twice in a row. The others go onto courts by rank, 4 per court, with the most balanced pairing that avoids repeating a partner (1&4 v 2&3, then 1&3 v 2&4, then 1&2 v 3&4). Rest points use the usual formula.
3. **Challenge trigger:** the leaderboard is split into one group per court, extras in the lower groups (10 players on 2 courts: places 1–5 and 6–10; 11 players: 1–5 and 6–11). If any group keeps the same core players for **2 rounds in a row**: 4 of 4, 4 of 5, or 5 of 6, shuffles inside the group don't matter, the next round is a challenge round. Resting players count in their group, so with extra players the courts can look different even though the group stayed the same. Needs 2+ courts; at least 2 normal rounds between challenges.
4. **Challenge rounds:** players are ranked by **Actual pts** frozen at the start of the challenge. Strongest partners weakest (1&8 v 2&7, 3&6 v 4&5), and every player gets a different partner and different opponents from the previous challenge round (e.g. 1&7 v 3&5, 2&8 v 4&6). Challenge points go on the leaderboard (Pts Won) straight away.
   - **Length:** at least 1 round, or 2 with extra players (so everyone plays one). After that the challenge ends if the leaderboard has moved by at least 2 places since it started; otherwise another challenge round is played, up to 3 in total.
   - **Rest points:** sitters in the first challenge round are paid later with the score they make in the next challenge round; later sitters get the average of their own challenge scores so far. If the tournament is finished before a waiting player has played, they get the last challenge round's average.
5. **Actual pts column (Hybrid tables):** points from matches actually played, never rest points. It stays frozen for the whole challenge and updates when normal rounds resume. Pts Won (matches + rest points) decides the standings and the winner. Other formats show **Pts (1.0x)** instead.

Settings in `app.js`: `HYBRID_AMERICANO_ROUNDS`, `HYBRID_STABLE_ROUNDS_TO_TRIGGER`, `HYBRID_MAX_EXTRA_PLAYERS`, `HYBRID_MAX_CHALLENGE_ROUNDS`, `HYBRID_RANK_SHIFT_TO_END`.

## Deploy to Vercel with a free database

Everything here is on free plans: Vercel Hobby for the site and API, and Neon Free (0.5 GB Postgres) for the database. No credit card is needed.

1. **Put the project on GitHub.** Create a new repository and push this folder to it.
2. **Import it into Vercel.** On [vercel.com](https://vercel.com), choose **Add New → Project**, pick the repository, leave the framework preset as **Other** with no build command, and click **Deploy**.
3. **Add the database.** In the Vercel project, open the **Storage** tab, choose **Create Database → Neon** (Serverless Postgres), select the **Free** plan and connect it to the project for all environments. Vercel adds a `DATABASE_URL` environment variable for you.
4. **Set the organiser key.** In **Settings → Environment Variables**, add `ADMIN_KEY` with a long random value (a password manager can generate one). This key is what allows a device to save to the database.
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables take effect.
6. **Connect your device.** Open the site, click **View only** at the bottom of the sidebar, enter the organiser key and click **Save key**. The status turns to **Synced** and any tournaments already saved on that device are uploaded.

The tables are created automatically on the first request, so there is no SQL to run. To see them, open the Neon console from the Vercel **Storage** tab.

> Vercel's screens change from time to time. If a button has moved, the steps are the same in spirit: add a Neon Postgres database to the project, add an `ADMIN_KEY` variable, redeploy.

### Who can do what

| | Without the key | With the organiser key |
|---|---|---|
| See the archive, standings, match logs, player stats | ✅ | ✅ |
| Run a tournament on their own device | ✅ (kept on that device) | ✅ (saved to the database) |
| Add, update or delete tournaments in the database | ❌ | ✅ |

Give the key only to people who run tournaments. Anyone else who opens the link sees a read-only view of the shared records. Deleting a tournament on a device without the key only hides it on that device.

### Running it locally

```bash
npm install
npx vercel dev        # serves the site and /api on http://localhost:3000
```

`vercel dev` reads environment variables from Vercel after `npx vercel link` and `npx vercel env pull`.

## Deploy to GitHub Pages (no database)

GitHub Pages only hosts static files, so the app runs there exactly as before: everything stays on each device and the status shows **This device only**. The included workflow (`.github/workflows/pages.yml`) publishes on every push to `main` once **Settings → Pages → Source** is set to **GitHub Actions**. If you only use Vercel you can delete that workflow file.

## How it works

- **Offline first:** every change is saved on the device straight away (`localStorage` key `padel_saved_tournaments_v5`). `cloud.js` then uploads changes to `/api/tournaments` and downloads tournaments saved from other devices. Without a connection the app keeps working and catches up when it's back online.
- **Conflicts:** each save carries a timestamp, and the database only accepts a copy that is newer than the one it holds. An old copy from another device can never overwrite newer results.
- **Engine and UI are separate:** `app.js` holds all tournament logic and does not know about the layout or the network. `ui.js` handles the shell, `cloud.js` handles storage and sync, and `players.js` builds the stats page.
- **Storage limits:** if a device runs short of browser storage, finished tournaments that are already in the database are trimmed on that device and downloaded again in full when reopened.

## The database

| Table | One row per | Main columns |
|---|---|---|
| `tournaments` | tournament | name, date, format, courts, rounds played, finished, winner, `state` (full app record as JSON) |
| `players` | player or fixed team | display name; names are matched ignoring case and extra spaces, so "Ali" and "ali " are the same person |
| `tournament_entries` | player per tournament | final rank, exact points won/lost, played, wins, ties, losses, byes |
| `matches` | match | round, court, both sides, raw and weighted scores, multiplier |

The view `player_career_stats` adds up each player's career. Example queries for the Neon SQL editor:

```sql
-- All-time table
SELECT name, tournaments, titles, podiums, matches, wins, win_pct
  FROM player_career_stats WHERE kind = 'player'
 ORDER BY titles DESC, win_pct DESC;

-- One player's results, newest first
SELECT t.date, t.name, e.final_rank, e.points, e.wins, e.losses
  FROM tournament_entries e
  JOIN tournaments t ON t.id = e.tournament_id
  JOIN players p ON p.id = e.player_id
 WHERE p.kind = 'player' AND p.name_key = 'ali'
 ORDER BY t.date DESC;
```

The full schema is in `db/schema.sql`.

### API

| Method | Path | Access | Does |
|---|---|---|---|
| GET | `/api/health` | public | database reachable, saving enabled, key valid |
| GET | `/api/tournaments` | public | summaries of all tournaments |
| GET | `/api/tournaments?ids=a,b` | public | full records (up to 25) |
| PUT | `/api/tournaments` | `x-admin-key` header | create or update a tournament |
| DELETE | `/api/tournaments?id=a` | `x-admin-key` header | delete a tournament and its results |

## Project structure

```
index.html              App shell (sidebar, screens, forms, sync dialog)
style.css               Layout, theme and responsive rules
app.js                  Tournament engine: scheduling, scoring, ranking, archive
cloud.js                Storage on the device + sync with the online database
players.js              Player stats screen
record.js               Record a past tournament (final table entry)
ui.js                   Shell: navigation, mobile drawer, summary tiles, sync status, PWA install
sw.js                   Service worker (offline support)
manifest.json           PWA manifest
api/tournaments.js      Vercel function: read/save/delete tournaments
api/health.js           Vercel function: status check
api/_lib/db.js          Database connection, organiser key check, validation
api/_lib/schema.js      Table definitions (created automatically)
db/schema.sql           Same schema as plain SQL
package.json            Declares the Neon driver for the API
vercel.json             Vercel settings (no-cache for the service worker)
```

## Customising

- **Icons:** replace `padel_app_icon.png` (192×192) and `padel_app_icon_512.png` (512×512) with your own artwork.
- **Colours:** edit the CSS variables at the top of `style.css`.
- **Cache updates:** after changing files, bump `CACHE` in `sw.js` (e.g. `padel-center-v4`) so installed copies refresh.
- **Analytics:** `index.html` includes a Google Analytics tag. Remove the `gtag` block in `<head>` or replace the ID with your own.

## Browser support

Any current version of Chrome, Edge, Safari or Firefox. Installing as an app is available in Chromium browsers and on iOS via **Share → Add to Home Screen**.

## Contributing

Issues and pull requests are welcome. Keep the front end dependency-free, and when you touch the engine, test each format with a full tournament from start to finish.

## License

Released under the [MIT License](LICENSE).
