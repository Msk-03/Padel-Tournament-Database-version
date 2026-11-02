// /api/health — lets the app see whether the database is reachable, whether
// saving is switched on, and whether the organiser key it holds is correct.
import { getSql, json, route, writeEnabled, isAuthorized } from './_lib/db.js';

export default {
  fetch: route(async request => {
    let database = false;
    let error;
    try {
      const sql = await getSql();
      await sql`SELECT 1`;
      database = true;
    } catch (err) {
      error = err.status ? err.message : 'Database is not reachable.';
      if (!err.status) console.error(err);
    }
    return json({ ok: database, database, writeEnabled: writeEnabled(), authorized: isAuthorized(request), error });
  })
};
