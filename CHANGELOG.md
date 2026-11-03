# Changelog

## 1.2.5 – 2026-11-03

- Exact points: multiplied scores and rest points are stored with their decimals (4 places) and every calculation, ranking and the winner use the exact values. A total of 14.8 shows as 15, the next round adds to 14.8 (not 15), and 15.3 shows as 15.
- Screens round to the nearest whole number (halves round up); hover over a points value to see the exact figure. The Diff column is shown as shown-won minus shown-lost so the columns add up.
- Database: point columns become exact NUMERIC (from whole numbers or 2 decimal places). The upgrade runs automatically on the next request and keeps existing values.

## 1.2.4 – 2026-11-03

- Points are whole numbers again: multiplied scores and rest points are rounded down (14.2 and 14.6 both become 14; rest 6.5 becomes 6). Tournaments that already recorded decimal points keep them; new rounds add whole numbers. No database change is needed.

## 1.2.0 – 2026-11-03

- Super Mexicano multipliers now depend on how many courts are in use: the bottom court is always 1.0x and higher courts earn more (2 courts 1.1/1.0, 3 courts 1.2/1.1/1.0, 4 courts 1.225/1.15/1.075/1.0, up to a 1.3x cap). Rounds 1–2 stay flat 1.0x; one court has no multipliers. Full table in the README; values in `SUPER_MEXICANO_COURT_MULTIPLIERS` in `app.js`.
- New **Pts (1.0x)** column in the live leaderboard and archive standings: points scored in matches with no multipliers and no rest points. It is used only to work out rest averages, never for ranking or the winner.
- Rest points before a player's first match (e.g. resting in round 1) are now the round's base score: total points scored that round ÷ players who played (previously half the match target).
- Rest points after exactly one game are (round base score + that game's score) ÷ 2, e.g. (8 + 5) ÷ 2 = 6.5; from two games on, the player's own average is used.
- Points now keep decimals (2 places) instead of rounding to whole numbers, so multiplied scores and rest points are exact (16 × 1.075 = 17.2, rest 6.5). The database upgrades itself on the next request: point columns change from whole numbers to NUMERIC(10,2) and existing values are kept.
- Player stats now rank by points won, then win %, then fewest losses, then most ties, then titles; the topper gets a crown. Click **#** to return to this order after sorting by another column.

## 1.1.1 – 2026-11-03

- Super Mexicano with a single court no longer applies multipliers (every match counts 1.0x).
- Rest (bye) points are now the player's average raw match score, multiplied by the multiplier of the court their current standing puts them on. Earlier multipliers and earlier rest awards no longer inflate the average. The resting box shows each player's award before the round is submitted.
- Fixed: reopening a finished tournament from the archive showed the champion but an empty leaderboard table.

## 1.1.0 – 2026-11-02

- Online database: tournaments sync to Postgres (Neon) through Vercel functions in `api/`, so the archive is shared across devices and survives clearing the browser.
- Organiser key (`ADMIN_KEY`): anyone can view; only devices with the key can save or delete. Status and key entry live at the bottom of the sidebar.
- New **Player stats** screen: all-time table for players and teams with titles, podiums, W/T/L, win %, points and per-player tournament history.
- Tournaments already saved on a device upload automatically when the key is added; "☁ Saved online" badge in the archive.
- Archive is no longer capped at 25 tournaments.
- Storage moved from `app.js` to `cloud.js`; service worker cache bumped to v3 and never caches `/api/` calls.

## 1.0.0 – 2026-11-02

- New responsive interface: sidebar on desktop, icon rail on tablet, hamburger drawer on mobile.
- Summary tiles for saved, in-progress and completed tournaments and the live round.
- Tournament engine moved to `app.js`; scheduling, scoring and archive logic unchanged.
- PWA: updated manifest with 192/512px icons, offline-capable service worker, install button.
- Added README, LICENSE, `.gitignore` and a GitHub Pages workflow.
