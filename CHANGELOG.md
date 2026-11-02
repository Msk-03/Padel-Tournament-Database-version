# Changelog

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
