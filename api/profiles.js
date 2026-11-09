// /api/profiles — optional player details: nickname and preferred side.
//   GET                 → every profile: [{ kind, key, nickname, side, updated_at }] (public)
//   GET ?since=ISO-time → only profiles changed after that time
//   PUT { kind, key, nickname, side, updatedAt }
//       → add details for a player who has none (organiser key); changing or clearing existing
//         details needs the master key.
import { getSql, json, route, requireAuth, nameKey, HttpError } from './_lib/db.js';

const SIDES = new Set(['left', 'right', 'both']);

async function list(sql, since) {
  const rows = since
    ? await sql`SELECT kind, name_key, nickname, side, updated_at FROM player_profiles WHERE updated_at > ${since}::timestamptz`
    : await sql`SELECT kind, name_key, nickname, side, updated_at FROM player_profiles`;
  return rows.map(r => ({ kind: r.kind, key: r.name_key, nickname: r.nickname, side: r.side, updated_at: new Date(r.updated_at).toISOString() }));
}

async function save(sql, request, role) {
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Body must be JSON.'); }
  const kind = body && body.kind;
  const key = body && typeof body.key === 'string' ? nameKey(body.key) : '';
  const nickname = body && typeof body.nickname === 'string' && body.nickname.trim() ? body.nickname.trim().replace(/\s+/g, ' ').slice(0, 40) : null;
  const side = body && SIDES.has(body.side) ? body.side : null;
  const ts = body && Date.parse(body.updatedAt) ? new Date(body.updatedAt).toISOString() : new Date().toISOString();
  if (kind !== 'player' && kind !== 'team') throw new HttpError(400, 'kind must be player or team.');
  if (!key || key.length > 120) throw new HttpError(400, 'Invalid name.');
  if (role !== 'master') {
    const [cur] = await sql`SELECT nickname, side FROM player_profiles WHERE kind = ${kind} AND name_key = ${key}`;
    if (cur && ((cur.nickname && cur.nickname !== nickname) || (cur.side && cur.side !== side))) {
      throw new HttpError(403, 'Only the master key can change or remove player details.');
    }
  }
  const rows = await sql`
    INSERT INTO player_profiles (kind, name_key, nickname, side, updated_at)
    VALUES (${kind}, ${key}, ${nickname}, ${side}, ${ts}::timestamptz)
    ON CONFLICT (kind, name_key) DO UPDATE SET nickname = EXCLUDED.nickname, side = EXCLUDED.side, updated_at = EXCLUDED.updated_at
    WHERE player_profiles.updated_at <= EXCLUDED.updated_at
    RETURNING name_key`;
  return { ok: true, stale: rows.length === 0 };
}

export default {
  fetch: route(async request => {
    const url = new URL(request.url);
    switch (request.method) {
      case 'GET': {
        const since = url.searchParams.get('since');
        if (since && !Date.parse(since)) throw new HttpError(400, 'Invalid since.');
        return json({ profiles: await list(await getSql(), since ? new Date(since).toISOString() : null) });
      }
      case 'PUT':
      case 'POST':
        return json(await save(await getSql(), request, requireAuth(request)));
      default:
        return json({ error: 'Method not allowed' }, 405);
    }
  })
};
