// /api/tournaments
//   GET                → summaries of every saved tournament (public)
//   GET ?ids=a,b,c     → full saved records for up to 25 tournaments (public)
//   PUT  {record}      → create or update one tournament (organiser key; removing matches or
//                        players from a saved tournament needs the master key)
//   DELETE ?id=x       → delete one tournament and its results (master key)
import { getSql, json, route, requireAuth, requireMaster, normalizeRecord, isValidId, nameKey, HttpError } from './_lib/db.js';

const MAX_BODY = 3_000_000;
const LOCAL_FIELDS = ['_synced', '_slim'];

async function list(sql) {
  const rows = await sql`
    SELECT id, name, to_char(date, 'YYYY-MM-DD') AS date, format, is_finished, winner,
           rounds_played, participant_count, updated_at
      FROM tournaments
     ORDER BY date DESC NULLS LAST, updated_at DESC`;
  return rows.map(r => ({ ...r, updated_at: new Date(r.updated_at).toISOString() }));
}

async function getMany(sql, idsParam) {
  const ids = [...new Set(idsParam.split(',').map(s => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 25 || !ids.every(isValidId)) throw new HttpError(400, 'Pass 1–25 valid ids.');
  const rows = await sql`
    SELECT state FROM tournaments
     WHERE id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
  return rows.map(r => (typeof r.state === 'string' ? JSON.parse(r.state) : r.state));
}

async function save(sql, request, role) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw new HttpError(413, 'Tournament is too large to save.');
  let record;
  try { record = await request.json(); } catch { throw new HttpError(400, 'Body must be JSON.'); }

  const { tournament: t, kind, entries, matches } = normalizeRecord(record);

  // The organiser key may add to a saved tournament but not take anything away.
  if (role !== 'master') {
    const [cur] = await sql`
      SELECT (SELECT count(*)::int FROM matches WHERE tournament_id = ${t.id}) AS match_count,
             state->'participants' AS participants, coalesce((state->>'editLockRound')::int, 0) AS lock_round, is_finished, updated_at
        FROM tournaments WHERE id = ${t.id}`;
    if (cur && new Date(cur.updated_at) <= new Date(t.updatedAt)) {
      const before = (typeof cur.participants === 'string' ? JSON.parse(cur.participants) : cur.participants) || [];
      const now = new Set(entries.map(e => e.key));
      if (matches.length < cur.match_count) throw new HttpError(403, 'Only the master key can delete matches from a saved tournament.');
      if (before.some(p => p && p.name && !now.has(nameKey(p.name)))) throw new HttpError(403, 'Only the master key can remove or rename players in a saved tournament.');
      // Scores of locked rounds (saved and resumed later, or finished) can't be changed.
      if ((Number(record.editLockRound) || 0) < cur.lock_round) throw new HttpError(403, 'Only the master key can unlock saved scores.');
      const lock = cur.is_finished ? 1e6 : cur.lock_round;   // a finished tournament's scores are all locked
      if (lock > 0) {
        const saved = await sql`SELECT round, court, score1, score2 FROM matches WHERE tournament_id = ${t.id} AND round <= ${lock}`;
        const incoming = new Map(matches.map(m => [`${m.round}:${m.court}`, m]));
        if (saved.some(m => { const n = incoming.get(`${m.round}:${m.court}`); return !n || n.score1 !== m.score1 || n.score2 !== m.score2; })) {
          throw new HttpError(403, 'Saved scores are locked. Only the master key can change them.');
        }
      }
    }
  }
  const state = { ...record };
  LOCAL_FIELDS.forEach(f => delete state[f]);

  const entriesJson = JSON.stringify(entries);
  const matchesJson = JSON.stringify(matches);
  const ts = t.updatedAt;

  // One atomic transaction. The upsert only wins if this copy is at least as new
  // as the stored one; every later statement checks that it did, so an old copy
  // from another device can never overwrite newer results.
  const [upserted] = await sql.transaction([
    sql`
      INSERT INTO tournaments (id, name, date, format, is_team, max_points, courts, rounds_played,
                               participant_count, is_finished, winner, state, updated_at)
      VALUES (${t.id}, ${t.name}, ${t.date}, ${t.format}, ${t.isTeam}, ${t.maxPoints}, ${t.courts},
              ${t.roundsPlayed}, ${t.participantCount}, ${t.isFinished}, ${t.winner},
              ${JSON.stringify(state)}::jsonb, ${ts}::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, date = EXCLUDED.date, format = EXCLUDED.format, is_team = EXCLUDED.is_team,
        max_points = EXCLUDED.max_points, courts = EXCLUDED.courts, rounds_played = EXCLUDED.rounds_played,
        participant_count = EXCLUDED.participant_count, is_finished = EXCLUDED.is_finished,
        winner = EXCLUDED.winner, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
      WHERE tournaments.updated_at <= EXCLUDED.updated_at
      RETURNING id`,
    sql`
      INSERT INTO players (kind, name_key, display_name)
      SELECT ${kind}, e.key, e.name
        FROM jsonb_to_recordset(${entriesJson}::jsonb) AS e(key text, name text)
       WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ${t.id} AND updated_at = ${ts}::timestamptz)
      ON CONFLICT (kind, name_key) DO UPDATE SET display_name = EXCLUDED.display_name`,
    sql`
      DELETE FROM tournament_entries
       WHERE tournament_id = ${t.id}
         AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${t.id} AND updated_at = ${ts}::timestamptz)`,
    sql`
      INSERT INTO tournament_entries (tournament_id, player_id, name, final_rank, points, points_lost,
                                      played, wins, ties, losses, byes)
      SELECT ${t.id}, p.id, e.name, e.rank, e.points, e.points_lost, e.played, e.wins, e.ties, e.losses, e.byes
        FROM jsonb_to_recordset(${entriesJson}::jsonb)
             AS e(key text, name text, rank int, points numeric, points_lost numeric, played int,
                  wins int, ties int, losses int, byes int)
        JOIN players p ON p.kind = ${kind} AND p.name_key = e.key
       WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ${t.id} AND updated_at = ${ts}::timestamptz)`,
    sql`
      DELETE FROM matches
       WHERE tournament_id = ${t.id}
         AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${t.id} AND updated_at = ${ts}::timestamptz)`,
    sql`
      INSERT INTO matches (tournament_id, round, court, team1, team2, score1, score2, weighted1, weighted2, multiplier)
      SELECT ${t.id}, m.round, m.court, m.team1, m.team2, m.score1, m.score2, m.weighted1, m.weighted2, m.multiplier
        FROM jsonb_to_recordset(${matchesJson}::jsonb)
             AS m(round int, court int, team1 text, team2 text, score1 int, score2 int,
                  weighted1 numeric, weighted2 numeric, multiplier numeric)
       WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ${t.id} AND updated_at = ${ts}::timestamptz)`
  ]);

  // `stale: true` means the database already holds a newer copy; the app will
  // download that copy on its next sync instead.
  return { ok: true, id: t.id, stale: upserted.length === 0 };
}

async function remove(sql, url) {
  const id = url.searchParams.get('id');
  if (!isValidId(id)) throw new HttpError(400, 'Invalid tournament id.');
  const rows = await sql`DELETE FROM tournaments WHERE id = ${id} RETURNING id`;
  return { ok: true, deleted: rows.length > 0 };
}

export default {
  fetch: route(async request => {
    const url = new URL(request.url);
    switch (request.method) {
      case 'GET': {
        const sql = await getSql();
        const ids = url.searchParams.get('ids');
        return json(ids ? { tournaments: await getMany(sql, ids) } : { tournaments: await list(sql) });
      }
      case 'PUT':
      case 'POST':
        return json(await save(await getSql(), request, requireAuth(request)));
      case 'DELETE':
        requireMaster(request);
        return json(await remove(await getSql(), url));
      default:
        return json({ error: 'Method not allowed' }, 405);
    }
  })
};
