/* Storage layer + cloud sync.
 *
 * The app still saves every change to this device first (so it keeps working
 * offline). This file then copies tournaments to the online database through
 * /api/tournaments and pulls down tournaments saved from other devices.
 *
 * - Anyone can read the database. Saving to it needs the organiser key
 *   (ADMIN_KEY in Vercel), entered once per device from the sidebar.
 * - A record with `_synced: true` matches the database copy. The app rebuilds
 *   the record on every autosave without that flag, so "not synced" simply
 *   means "has changes to upload".
 * - If the host has no /api (e.g. GitHub Pages) the app behaves exactly as before.
 */
const STORAGE_KEY = "padel_saved_tournaments_v5";

// Names are shown and saved with every word capitalised: "marzouq al hassan" → "Marzouq Al Hassan",
// "ali & omar" → "Ali & Omar", "al-noor" → "Al-Noor". The rest of each word is kept as typed.
/* ---------- tournament standings order ----------
   Every tournament table (live, archive, champion, titles, backup, shared page) is ordered by:
   1. average actual points per match (match points at 1.0x – no rest points, no multipliers),
   2. win % (wins ÷ matches played),
   3. actual points difference (actual points won − actual points lost).
   Beat the Box keeps its box order first. */
function actualPts(p) { return typeof p.rawPoints === 'number' ? p.rawPoints : (p.points || 0); }
function actualLost(p) { return typeof p.rawPointsLost === 'number' ? p.rawPointsLost : (p.pointsLost || 0); }
function matchesPlayed(p) { return p.roundsPlayed || ((p.wins || 0) + (p.ties || 0) + (p.losses || 0)); }
function avgActual(p) { const n = matchesPlayed(p); return n ? actualPts(p) / n : 0; }
function winRate(p) { const n = matchesPlayed(p); return n ? (p.wins || 0) / n : 0; }
function actualDiff(p) { return Math.round((actualPts(p) - actualLost(p)) * 10000) / 10000; }
function standingsComparator(fmt) {
    return (a, b) => {
        if (fmt === 'beat-the-box' && a.currentBox && b.currentBox && a.currentBox !== b.currentBox) return a.currentBox - b.currentBox;
        const av = avgActual(b) - avgActual(a);
        if (Math.abs(av) > 1e-9) return av;
        const wr = winRate(b) - winRate(a);
        if (Math.abs(wr) > 1e-9) return wr;
        const df = actualDiff(b) - actualDiff(a);
        if (Math.abs(df) > 1e-9) return df;
        return ((b.points || 0) - (a.points || 0)) || String(a.name).localeCompare(String(b.name));
    };
}
function rankStandings(list, fmt) { return [...(list || [])].sort(standingsComparator(fmt)); }

function titleCaseName(str) {
    return String(str == null ? '' : str).trim().replace(/\s+/g, ' ')
        .replace(/(^|[\s&\-'(/])(\p{Ll})/gu, (m, a, b) => a + b.toLocaleUpperCase());
}

function getSavedTournaments() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function saveTournamentsToStorage(list) {
    window.CloudSync.writeLocal(list);
    if (typeof updateArchiveCountBadge === 'function') updateArchiveCountBadge();
}

window.CloudSync = (() => {
    const KEY_STORE = 'padel_organiser_key';
    const DELETED_STORE = 'padel_sync_deleted_v1';
    // Player photos: { "player:ali hassan": { data, updatedAt, synced } }. data null = removed.
    const PHOTO_STORE = 'padel_player_photos_v1';
    const PHOTO_SINCE = 'padel_player_photos_since_v1';
    // Player details: { "player:ali hassan": { nickname, side, updatedAt, synced } }.
    const PROFILE_STORE = 'padel_player_profiles_v1';
    const PROFILE_SINCE = 'padel_player_profiles_since_v1';
    const API = './api';
    // Fields only needed to resume play. Finished, already-uploaded tournaments
    // can drop them if the device runs out of storage; they are re-downloaded on resume.
    const HEAVY = ['fullPrecomputedSchedule', 'partnerCountMatrix', 'lastPartnerRound', 'teamOpponentCount',
                   'lastTeamOpponentRound', 'roundActiveMatches', 'sittingOutThisRound', 'beatTheBoxPositions', 'roundSnapshots'];

    const state = {
        api: 'checking',       // checking | up | none | offline | error
        writeEnabled: false,   // server has an ADMIN_KEY
        authorized: false,     // this device's key is correct
        role: (() => { try { return localStorage.getItem('padel_key_role') || null; } catch (e) { return null; } })(), // 'master' | 'organiser' | null
        masterEnabled: false,  // server has a separate MASTER_KEY
        busy: false,
        error: '',
        lastSync: 0
    };
    let running = null, again = false, flushTimer = null;

    /* ---------- local storage ---------- */
    const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
    const getDeleted = () => { try { return JSON.parse(localStorage.getItem(DELETED_STORE)) || []; } catch (e) { return []; } };
    const setDeleted = list => { try { localStorage.setItem(DELETED_STORE, JSON.stringify(list)); } catch (e) {} };

    /* ---------- player photos ---------- */
    const photoKey = (kind, name) => kind + ':' + String(name).trim().replace(/\s+/g, ' ').toLowerCase();
    const readPhotos = () => { try { return JSON.parse(localStorage.getItem(PHOTO_STORE)) || {}; } catch (e) { return {}; } };
    function writePhotos(all) {
        try { localStorage.setItem(PHOTO_STORE, JSON.stringify(all)); return true; }
        catch (e) { alert('This device is out of storage space for photos. Remove some photos or old tournaments.'); return false; }
    }
    // Deleting (tournaments, matches) and changing or removing photos needs the master key once
    // something is in the online database. Things only on this device can always be deleted.
    const isMaster = () => !!getKey() && state.role === 'master';
    const MASTER_ONLY = 'Only the master key can delete or change things saved in the online database. Ask the person who holds it.';
    function mayDeleteTournament(rec) { return !rec || !rec._synced || state.api === 'none' || isMaster(); }
    function mayChangePhoto(kind, name) {
        const p = readPhotos()[photoKey(kind, name)];
        return !p || !p.data || !p.synced || state.api === 'none' || isMaster();
    }
    function getPhoto(kind, name) { const p = readPhotos()[photoKey(kind, name)]; return p && p.data ? p.data : null; }
    // data: a data: URL, or null to remove the photo.
    function setPhoto(kind, name, data) {
        const all = readPhotos();
        all[photoKey(kind, name)] = { data: data || null, updatedAt: new Date().toISOString(), synced: false };
        if (!writePhotos(all)) return false;
        queueSave();
        return true;
    }
    async function pushPhotos() {
        const all = readPhotos();
        for (const [k, p] of Object.entries(all)) {
            if (p.synced) continue;
            const i = k.indexOf(':');
            try {
                await api('/photos', { method: 'PUT', body: JSON.stringify({ kind: k.slice(0, i), key: k.slice(i + 1), data: p.data, updatedAt: p.updatedAt }) });
            } catch (e) {
                if (e.status !== 403) throw e;
                // Refused: forget the local change and download every photo again.
                state.notice = e.message;
                const now = readPhotos(); delete now[k]; writePhotos(now);
                try { localStorage.removeItem(PHOTO_SINCE); } catch (err) {}
                continue;
            }
            const now = readPhotos();
            if (now[k] && now[k].updatedAt === p.updatedAt) { now[k].synced = true; writePhotos(now); }
        }
    }
    async function pullPhotos() {
        let since = '';
        try { since = localStorage.getItem(PHOTO_SINCE) || ''; } catch (e) {}
        let data;
        try { data = await api('/photos' + (since ? '?since=' + encodeURIComponent(since) : '')); }
        catch (e) { if (e.status === 404 || e.status === 405) return false; throw e; }
        const remote = (data && data.photos) || [];
        if (!remote.length) return false;
        const all = readPhotos();
        let latest = since, changedAny = false;
        for (const r of remote) {
            const k = r.kind + ':' + r.key, cur = all[k];
            if (!cur || cur.synced || Date.parse(r.updated_at) > Date.parse(cur.updatedAt)) {
                all[k] = { data: r.data || null, updatedAt: r.updated_at, synced: true };
                changedAny = true;
            }
            if (!latest || r.updated_at > latest) latest = r.updated_at;
        }
        if (changedAny) writePhotos(all);
        try { localStorage.setItem(PHOTO_SINCE, latest); } catch (e) {}
        return changedAny;
    }

    /* ---------- player details (nickname, preferred side) ---------- */
    const readProfiles = () => { try { return JSON.parse(localStorage.getItem(PROFILE_STORE)) || {}; } catch (e) { return {}; } };
    const writeProfiles = all => { try { localStorage.setItem(PROFILE_STORE, JSON.stringify(all)); return true; } catch (e) { return false; } };
    function getProfile(kind, name) {
        const p = readProfiles()[photoKey(kind, name)];
        return p && (p.nickname || p.side) ? { nickname: p.nickname || '', side: p.side || '' } : null;
    }
    function setProfile(kind, name, details) {
        const all = readProfiles();
        all[photoKey(kind, name)] = { nickname: (details && details.nickname || '').trim() || null, side: details && details.side || null, updatedAt: new Date().toISOString(), synced: false };
        if (!writeProfiles(all)) return false;
        queueSave();
        return true;
    }
    // field: 'nickname' or 'side' (or omitted for either). Adding is open; changing a saved value needs the master key.
    function mayChangeProfile(kind, name, field) {
        const p = readProfiles()[photoKey(kind, name)];
        const has = p && (field ? p[field] : (p.nickname || p.side));
        return !has || !p.synced || state.api === 'none' || isMaster();
    }
    async function pushProfiles() {
        const all = readProfiles();
        for (const [k, p] of Object.entries(all)) {
            if (p.synced) continue;
            const i = k.indexOf(':');
            try {
                await api('/profiles', { method: 'PUT', body: JSON.stringify({ kind: k.slice(0, i), key: k.slice(i + 1), nickname: p.nickname, side: p.side, updatedAt: p.updatedAt }) });
            } catch (e) {
                if (e.status !== 403) throw e;
                state.notice = e.message;
                const now = readProfiles(); delete now[k]; writeProfiles(now);
                try { localStorage.removeItem(PROFILE_SINCE); } catch (err) {}
                continue;
            }
            const now = readProfiles();
            if (now[k] && now[k].updatedAt === p.updatedAt) { now[k].synced = true; writeProfiles(now); }
        }
    }
    async function pullProfiles() {
        let since = '';
        try { since = localStorage.getItem(PROFILE_SINCE) || ''; } catch (e) {}
        let data;
        try { data = await api('/profiles' + (since ? '?since=' + encodeURIComponent(since) : '')); }
        catch (e) { if (e.status === 404 || e.status === 405) return false; throw e; }
        const remote = (data && data.profiles) || [];
        if (!remote.length) return false;
        const all = readProfiles();
        let latest = since, changedAny = false;
        for (const r of remote) {
            const k = r.kind + ':' + r.key, cur = all[k];
            if (!cur || cur.synced || Date.parse(r.updated_at) > Date.parse(cur.updatedAt)) {
                all[k] = { nickname: r.nickname || null, side: r.side || null, updatedAt: r.updated_at, synced: true };
                changedAny = true;
            }
            if (!latest || r.updated_at > latest) latest = r.updated_at;
        }
        if (changedAny) writeProfiles(all);
        try { localStorage.setItem(PROFILE_SINCE, latest); } catch (e) {}
        return changedAny;
    }

    function slimOne(list) {
        const candidates = list
            .filter(t => t._synced && t.isFinished && !t._slim)
            .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
        if (!candidates.length) return false;
        HEAVY.forEach(f => delete candidates[0][f]);
        candidates[0]._slim = true;
        return true;
    }

    function writeLocal(list) {
        for (;;) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
                return true;
            } catch (e) {
                if (!slimOne(list)) {
                    console.error('Could not save to this device', e);
                    alert('This device is out of storage space for tournaments. Delete some old tournaments from the archive.');
                    return false;
                }
            }
        }
    }

    function liveId() {
        const screen = document.getElementById('tournament-screen');
        const open = screen && !screen.classList.contains('hidden');
        return open && typeof tournamentId !== 'undefined' ? tournamentId : null;
    }

    const changed = () => window.dispatchEvent(new Event('padel:data-changed'));

    /* ---------- network ---------- */
    async function api(path, options = {}) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const headers = { ...(options.headers || {}) };
        const key = getKey();
        if (key) headers['x-admin-key'] = key;
        if (options.body) headers['content-type'] = 'application/json';
        try {
            const res = await fetch(API + path, { ...options, headers, signal: ctrl.signal, cache: 'no-store' });
            let data = null;
            try { data = await res.json(); } catch (e) {}
            if (!res.ok) {
                const err = new Error((data && data.error) || `Request failed (${res.status})`);
                err.status = res.status;
                throw err;
            }
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async function checkHealth() {
        if (!navigator.onLine) { state.api = 'offline'; return; }
        try {
            const h = await api('/health');
            state.api = 'up';
            state.writeEnabled = !!h.writeEnabled;
            state.authorized = !!h.authorized;
            state.masterEnabled = !!h.masterEnabled;
            state.role = h.authorized ? (h.role || 'master') : null;
            try { state.role ? localStorage.setItem('padel_key_role', state.role) : localStorage.removeItem('padel_key_role'); } catch (e) {}
            state.error = '';
        } catch (e) {
            if (e.status === 404 || e.status === 405) state.api = 'none';           // static host, no API
            else if (e.status) { state.api = 'error'; state.error = e.message; }    // API up, database not
            else state.api = navigator.onLine ? 'error' : 'offline';
            if (state.api === 'error' && !state.error) state.error = 'Could not reach the database.';
        }
    }

    const canWrite = () => state.api === 'up' && state.authorized;

    /* ---------- upload ---------- */
    async function pushDeletes() {
        for (const id of getDeleted()) {
            try {
                await api('/tournaments?id=' + encodeURIComponent(id), { method: 'DELETE' });
            } catch (e) {
                // 400 invalid id / 403 not allowed: drop it; a refused delete comes back on the next download.
                if (e.status !== 400 && e.status !== 403) throw e;
                if (e.status === 403) state.notice = e.message;
            }
            setDeleted(getDeleted().filter(x => x !== id));
        }
    }

    async function pushSaves() {
        let anyStale = false;
        const pending = getSavedTournaments().filter(t => !t._synced && !t._slim);
        for (const rec of pending) {
            let res;
            try {
                res = await api('/tournaments', { method: 'PUT', body: JSON.stringify(rec) });
            } catch (e) {
                if (e.status !== 403) throw e;
                // Refused (the change would delete matches or players): take the database copy back.
                state.notice = e.message;
                const list = getSavedTournaments(), cur = list.find(t => t.id === rec.id);
                if (cur) { cur._synced = true; cur.updatedAt = '1970-01-01T00:00:00.000Z'; writeLocal(list); }
                anyStale = true;
                continue;
            }
            if (res && res.stale) anyStale = true;
            // Mark as synced only if nothing changed locally while uploading.
            const list = getSavedTournaments();
            const cur = list.find(t => t.id === rec.id);
            if (cur && cur.updatedAt === rec.updatedAt) {
                cur._synced = true;
                writeLocal(list);
            }
        }
        return anyStale;
    }

    /* ---------- download ---------- */
    async function fetchFull(ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 25) {
            const batch = ids.slice(i, i + 25);
            const data = await api('/tournaments?ids=' + batch.map(encodeURIComponent).join(','));
            out.push(...(data.tournaments || []));
        }
        return out;
    }

    async function pull() {
        const { tournaments: remote = [] } = await api('/tournaments');
        const deleted = new Set(getDeleted());
        const open = liveId();
        let local = getSavedTournaments();
        const byId = new Map(local.map(t => [t.id, t]));
        const remoteIds = new Set(remote.map(r => r.id));

        const need = remote
            .filter(r => !deleted.has(r.id) && r.id !== open)
            .filter(r => {
                const l = byId.get(r.id);
                return !l || Date.parse(r.updated_at) > Date.parse(l.updatedAt || 0);
            })
            .map(r => r.id);

        // Uploaded before but gone from the database: deleted on another device.
        // An empty database is treated as new or reset instead, so local copies
        // are kept and uploaded again rather than wiped.
        const missing = local.filter(t => t._synced && !remoteIds.has(t.id) && t.id !== open);
        const freshDatabase = remote.length === 0;

        if (!need.length && !missing.length) return false;
        const fresh = need.length ? await fetchFull(need) : [];

        local = getSavedTournaments();
        if (freshDatabase) local.forEach(t => { if (missing.some(m => m.id === t.id)) delete t._synced; });
        else local = local.filter(t => !missing.some(m => m.id === t.id));
        for (const rec of fresh) {
            rec._synced = true;
            const i = local.findIndex(t => t.id === rec.id);
            if (i >= 0) local[i] = rec; else local.push(rec);
        }
        local.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) ||
                             String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        writeLocal(local);
        return true;
    }

    /* ---------- orchestration ---------- */
    async function syncNow() {
        if (running) { again = true; return running; }
        running = (async () => {
            state.busy = true; state.notice = ''; changed();
            try {
                await checkHealth();
                if (state.api !== 'up') return;
                if (canWrite()) await pushDeletes();
                let dataChanged = await pull();
                if (canWrite() && await pushSaves()) dataChanged = (await pull()) || dataChanged;
                if (canWrite()) { await pushPhotos(); await pushProfiles(); }
                dataChanged = (await pullPhotos()) || dataChanged;
                dataChanged = (await pullProfiles()) || dataChanged;
                state.lastSync = Date.now();
                state.error = '';
                if (dataChanged && typeof updateArchiveCountBadge === 'function') updateArchiveCountBadge();
            } catch (e) {
                console.warn('Sync failed:', e);
                if (e.status === 401) state.authorized = false;
                state.api = navigator.onLine ? 'error' : 'offline';
                state.error = e.message;
            } finally {
                state.busy = false;
                running = null;
                rerenderOpenLists();
                changed();
                if (again) { again = false; syncNow(); }
            }
        })();
        return running;
    }

    function rerenderOpenLists() {
        const vault = document.getElementById('vault-screen');
        if (vault && !vault.classList.contains('hidden') && typeof renderSavedTournamentsList === 'function') renderSavedTournamentsList();
    }

    // Called by the engine after every autosave.
    function queueSave() {
        changed();
        if (state.api !== 'up' || !getKey()) return;
        clearTimeout(flushTimer);
        flushTimer = setTimeout(syncNow, 1200);
    }

    // Called by the engine after a tournament is deleted on this device.
    function queueDelete(id) {
        if (getKey()) setDeleted([...new Set([...getDeleted(), id])]);
        queueSave();
    }

    // Re-download a tournament that was trimmed to save space, before resuming it.
    async function loadFull(id) {
        try {
            const [rec] = await fetchFull([id]);
            if (!rec) return false;
            rec._synced = true;
            const list = getSavedTournaments();
            const i = list.findIndex(t => t.id === id);
            if (i >= 0) list[i] = rec; else list.unshift(rec);
            return writeLocal(list);
        } catch (e) {
            return false;
        }
    }

    async function setKey(key) {
        try {
            if (key) localStorage.setItem(KEY_STORE, key.trim()); else localStorage.removeItem(KEY_STORE);
        } catch (e) {}
        await syncNow();
        return state.authorized;
    }

    function status() {
        const pending = getSavedTournaments().filter(t => !t._synced).length + Object.values(readPhotos()).filter(p => !p.synced).length + Object.values(readProfiles()).filter(p => !p.synced).length;
        const s = state;
        if (s.api === 'checking') return { tone: 'idle', label: 'Connecting…', detail: 'Looking for the online database.' };
        if (s.api === 'none') return { tone: 'idle', label: 'This device only', detail: 'This site has no database connected, so tournaments are saved on this device only.' };
        if (s.api === 'offline') return { tone: 'warn', label: 'Offline', detail: 'No internet connection. Everything is saved on this device and will upload when you are back online.' };
        if (s.api === 'error') return { tone: 'bad', label: 'Sync problem', detail: s.error || 'Could not reach the database. Your tournaments are still saved on this device.' };
        if (s.busy) return { tone: 'busy', label: 'Syncing…', detail: 'Exchanging tournaments with the database.' };
        if (!s.authorized) {
            return s.writeEnabled
                ? { tone: 'idle', label: 'View only', detail: 'You can see every tournament in the database. Enter the organiser key to save new tournaments to it.' }
                : { tone: 'idle', label: 'View only', detail: 'Saving to the database is switched off (no ADMIN_KEY is set on the server).' };
        }
        const keyName = s.role === 'master' ? (s.masterEnabled ? 'Master key' : 'Organiser key (full access)') : 'Organiser key';
        const rights = s.role === 'master' ? 'You can create, change and delete everything.' : 'You can create tournaments and add photos; deleting needs the master key.';
        const note = s.notice ? ' ' + s.notice : '';
        if (pending) return { tone: 'warn', label: `${pending} to upload`, detail: `${keyName}. Some changes have not reached the database yet.${note}` };
        return { tone: 'good', label: s.role === 'master' && s.masterEnabled ? 'Synced · master' : 'Synced', detail: `${keyName}: ${rights} All tournaments on this device are saved in the database.${note}` };
    }

    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => { state.api = 'offline'; changed(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - state.lastSync > 60000) syncNow();
    });
    // Start once the page is parsed; no need to wait for fonts or analytics to load.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => syncNow());
    else syncNow();

    return { getProfile, setProfile, mayChangeProfile, MASTER_ONLY, mayDeleteTournament, mayChangePhoto, isMaster, getPhoto, setPhoto, writeLocal, queueSave, queueDelete, loadFull, syncNow, setKey, status, hasKey: () => !!getKey(), canWrite, state };
})();
