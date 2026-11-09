// /api/maintenance — keeps the free database small.
// Runs once a day from the Vercel cron in vercel.json (or by hand with the master key).
// When the database is bigger than PURGE_AT_MB (default 300 MB of Neon's free 512 MB), the
// match-by-match history of finished tournaments played more than HISTORY_DAYS (default 60)
// days ago is removed. Final scores, standings and player stats are always kept.
//   GET              → purge if over the size limit
//   GET ?force=1     → purge now whatever the size (master key only)
//   GET ?dry=1       → only report what would be removed
import { getSql, json, route, roleOf, HttpError } from './_lib/db.js';

const HEAVY = ['matchHistory', 'fullPrecomputedSchedule', 'partnerCountMatrix', 'lastPartnerRound', 'teamOpponentCount',
               'lastTeamOpponentRound', 'roundActiveMatches', 'sittingOutThisRound', 'beatTheBoxPositions'];

function allowed(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  if (secret && auth === `Bearer ${secret}`) return 'cron';
  if (roleOf(request) === 'master') return 'master';
  // Without CRON_SECRET, accept Vercel's cron caller. The worst anyone can do is trigger the
  // same clean-up the schedule would run anyway.
  if (!secret && /vercel-cron/i.test(request.headers.get('user-agent') || '')) return 'cron';
  return null;
}

export default {
  fetch: route(async request => {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const who = allowed(request);
    if (!who) throw new HttpError(401, 'Master key required.');
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1' && who === 'master';
    const dry = url.searchParams.get('dry') === '1';
    const days = Math.max(7, parseInt(process.env.HISTORY_DAYS, 10) || 60);
    const limitMb = Math.max(10, parseInt(process.env.PURGE_AT_MB, 10) || 300);

    const sql = await getSql();
    const [{ bytes }] = await sql`SELECT pg_database_size(current_database())::bigint AS bytes`;
    const sizeMb = Math.round(Number(bytes) / 1048576);
    const over = sizeMb >= limitMb;

    const candidates = await sql`
      SELECT id FROM tournaments
       WHERE is_finished
         AND coalesce(date, updated_at::date) < current_date - ${days}::int
         AND (jsonb_array_length(coalesce(state->'matchHistory', '[]'::jsonb)) > 0
              OR EXISTS (SELECT 1 FROM matches m WHERE m.tournament_id = tournaments.id))`;
    const ids = candidates.map(r => r.id);

    if (dry || (!over && !force) || ids.length === 0) {
      return json({ ok: true, sizeMb, limitMb, days, wouldPurge: ids.length, purged: 0, reason: dry ? 'dry run' : (!over && !force) ? 'under the size limit' : 'nothing to purge' });
    }

    const idsJson = JSON.stringify(ids);
    // updated_at moves forward so devices download the trimmed copy (and an old full copy can't be re-uploaded over it).
    await sql.transaction([
      sql`DELETE FROM matches WHERE tournament_id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`,
      sql`UPDATE tournaments
             SET state = (state - ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(HEAVY)}::jsonb))) || jsonb_build_object('matchHistory', '[]'::jsonb, 'historyPurgedAt', now()),
                 updated_at = now()
           WHERE id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))`
    ]);
    return json({ ok: true, sizeMb, limitMb, days, purged: ids.length });
  })
};
