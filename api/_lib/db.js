import { createHash, timingSafeEqual } from 'node:crypto';
import { SCHEMA } from './schema.js';

/* ---------- connection ---------- */

let sqlPromise = null;
let schemaReady = null;

// Returns the Neon query function. Tests can swap in another driver with setSql().
export async function getSql() {
  if (!sqlPromise) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new HttpError(503, 'Database is not configured: set DATABASE_URL in your Vercel project.');
    sqlPromise = import('@neondatabase/serverless').then(({ neon }) => neon(url));
  }
  const sql = await sqlPromise;
  if (!schemaReady) {
    schemaReady = (async () => { for (const stmt of SCHEMA) await sql.query(stmt); })();
    schemaReady.catch(() => { schemaReady = null; }); // retry on the next request
  }
  await schemaReady;
  return sql;
}

export function setSql(sql) { sqlPromise = Promise.resolve(sql); schemaReady = null; }

/* ---------- HTTP helpers ---------- */

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Wraps a handler so thrown errors become JSON responses.
export function route(handler) {
  return async request => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err && (err.code === '42P01' || /relation .* does not exist/.test(err.message))) schemaReady = null; // tables dropped: recreate next time
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  };
}

/* ---------- organiser key ---------- */

const digest = s => createHash('sha256').update(String(s)).digest();

export function writeEnabled() { return Boolean(process.env.ADMIN_KEY); }

export function isAuthorized(request) {
  const expected = process.env.ADMIN_KEY;
  const given = request.headers.get('x-admin-key');
  if (!expected || !given) return false;
  return timingSafeEqual(digest(expected), digest(given));
}

export function requireAuth(request) {
  if (!writeEnabled()) throw new HttpError(503, 'Saving is turned off: set ADMIN_KEY in your Vercel project.');
  if (!isAuthorized(request)) throw new HttpError(401, 'Wrong or missing organiser key.');
}

/* ---------- record → table rows ---------- */

const FORMATS = new Set(['super-mexicano', 'mexicano', 'americano', 'team-mexicano', 'team-americano', 'beat-the-box']);
const TEAM_FORMATS = new Set(['team-mexicano', 'team-americano', 'beat-the-box']);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const isValidId = id => typeof id === 'string' && ID_RE.test(id);
export const nameKey = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

const int = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// Same ordering the app uses for its leaderboard.
export function rankParticipants(participants, format) {
  return [...participants].sort((a, b) => {
    if (format === 'beat-the-box' && a.currentBox && b.currentBox && a.currentBox !== b.currentBox) {
      return a.currentBox - b.currentBox;
    }
    if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
    const diffA = (a.points || 0) - (a.pointsLost || 0);
    const diffB = (b.points || 0) - (b.pointsLost || 0);
    if (diffB !== diffA) return diffB - diffA;
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    return (a.losses || 0) - (b.losses || 0);
  });
}

// Checks a saved tournament from the app and splits it into table rows.
export function normalizeRecord(record) {
  if (!record || typeof record !== 'object') throw new HttpError(400, 'Body must be a tournament object.');
  if (!isValidId(record.id)) throw new HttpError(400, 'Invalid tournament id.');
  if (!FORMATS.has(record.format)) throw new HttpError(400, 'Unknown tournament format.');
  const participants = record.participants;
  if (!Array.isArray(participants) || participants.length > 256) throw new HttpError(400, 'Invalid participants list.');
  if (participants.some(p => !p || typeof p.name !== 'string' || !p.name.trim())) throw new HttpError(400, 'Every participant needs a name.');

  const updatedAt = new Date(record.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) throw new HttpError(400, 'Invalid updatedAt.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ? record.date : null;
  const isTeam = TEAM_FORMATS.has(record.format);

  // Entries: one per distinct name, ranked like the app's leaderboard.
  const seen = new Set();
  const entries = [];
  rankParticipants(participants, record.format).forEach((p, i) => {
    const key = nameKey(p.name);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      key, name: text(p.name, 120), rank: i + 1,
      points: int(p.points), points_lost: int(p.pointsLost), played: int(p.roundsPlayed),
      wins: int(p.wins), ties: int(p.ties), losses: int(p.losses), byes: int(p.byeCount)
    });
  });

  // Matches: flatten the round-by-round history log.
  const matches = [];
  const matchSeen = new Set();
  for (const round of Array.isArray(record.matchHistory) ? record.matchHistory : []) {
    for (const m of Array.isArray(round?.matches) ? round.matches : []) {
      const k = `${int(round.round)}:${int(m.court)}`;
      if (matchSeen.has(k)) continue;
      matchSeen.add(k);
      matches.push({
        round: int(round.round), court: int(m.court), team1: text(m.team1, 250), team2: text(m.team2, 250),
        score1: int(m.score1), score2: int(m.score2), weighted1: int(m.wScore1), weighted2: int(m.wScore2),
        multiplier: Number(m.mUsed) || 1
      });
    }
  }

  return {
    tournament: {
      id: record.id,
      name: text(record.name) || 'Untitled tournament',
      date,
      format: record.format,
      isTeam,
      maxPoints: int(record.maxPoints),
      courts: int(record.totalCourts),
      roundsPlayed: int(record.totalRoundsPlayed),
      participantCount: participants.length,
      isFinished: Boolean(record.isFinished),
      winner: record.isFinished && entries[0] ? entries[0].name : null,
      updatedAt: updatedAt.toISOString()
    },
    kind: isTeam ? 'team' : 'player',
    entries,
    matches
  };
}
