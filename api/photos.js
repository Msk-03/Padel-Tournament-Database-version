// /api/photos — optional player photos (small JPEGs, shown on the Player stats cards).
//   GET                      → every photo: [{ kind, key, data, updated_at }] (public)
//   GET ?since=ISO-time      → only photos changed after that time (public)
//   PUT { kind, key, data, updatedAt }  → add / replace a photo; data: null removes it (organiser key)
// A removed photo stays as a row with data = NULL so other devices learn about the removal.
import { getSql, json, route, requireAuth, nameKey, HttpError } from './_lib/db.js';

const MAX_PHOTO = 400_000; // characters of the data: URL (~300 KB image); the app sends ~30 KB
const DATA_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

async function list(sql, since) {
  const rows = since
    ? await sql`SELECT kind, name_key, data, updated_at FROM player_photos WHERE updated_at > ${since}::timestamptz`
    : await sql`SELECT kind, name_key, data, updated_at FROM player_photos`;
  return rows.map(r => ({ kind: r.kind, key: r.name_key, data: r.data, updated_at: new Date(r.updated_at).toISOString() }));
}

async function save(sql, request) {
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Body must be JSON.'); }
  const kind = body && body.kind;
  const key = body && typeof body.key === 'string' ? nameKey(body.key) : '';
  const data = body ? body.data : undefined;
  const ts = body && Date.parse(body.updatedAt) ? new Date(body.updatedAt).toISOString() : new Date().toISOString();
  if (kind !== 'player' && kind !== 'team') throw new HttpError(400, 'kind must be player or team.');
  if (!key || key.length > 120) throw new HttpError(400, 'Invalid name.');
  if (data !== null && (typeof data !== 'string' || data.length > MAX_PHOTO || !DATA_RE.test(data))) {
    throw new HttpError(400, 'Photo must be a small JPEG, PNG or WebP image.');
  }
  const rows = await sql`
    INSERT INTO player_photos (kind, name_key, data, updated_at)
    VALUES (${kind}, ${key}, ${data}, ${ts}::timestamptz)
    ON CONFLICT (kind, name_key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    WHERE player_photos.updated_at <= EXCLUDED.updated_at
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
        return json({ photos: await list(await getSql(), since ? new Date(since).toISOString() : null) });
      }
      case 'PUT':
      case 'POST':
        requireAuth(request);
        return json(await save(await getSql(), request));
      default:
        return json({ error: 'Method not allowed' }, 405);
    }
  })
};
