/* Players screen: career stats for every player (and fixed team) across all saved
   tournaments. Built from the tournaments on this device, which cloud.js keeps in
   step with the online database, so it also works offline. */
window.Players = (() => {
    const $ = id => document.getElementById(id);
    const TEAM_FORMATS = ['team-mexicano', 'team-americano', 'beat-the-box'];
    const ui = { from: '', to: '', kind: 'player', group: 'main', includeUnfinished: false, query: '', sort: 'rank', dir: 1, open: null };
    // The main leaderboard only lists players with at least this many matches; "All players" lists everyone.
    const minMatches = () => (typeof window.PLAYER_MIN_MATCHES === 'number' ? window.PLAYER_MIN_MATCHES : 30);

    // Exact points for sums and ranking; whole numbers (nearest) on screen, exact value on hover.
    const exact = n => Math.round((Number(n) || 0) * 10000) / 10000;
    const show = n => { const v = exact(n); return Math.sign(v) * Math.round(Math.abs(v) + 1e-9) || 0; };
    const cell = n => `<span title="Exact: ${exact(n)}">${show(n)}</span>`;
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const keyOf = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
    const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
    const fmtName = f => String(f || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Same ordering as the in-app leaderboard.
    function ranked(t) {
        // Same order as the tournament's own table (avg actual points → win % → actual diff).
        return rankStandings(t.participants || t.players || [], t.format);
    }

    function compute() {
        const people = new Map();
        const kindsSeen = new Set();
        for (const t of getSavedTournaments()) {
            const kind = TEAM_FORMATS.includes(t.format) ? 'team' : 'player';
            kindsSeen.add(kind);
            if (kind !== ui.kind || (!t.isFinished && !ui.includeUnfinished)) continue;
            if ((ui.from && (t.date || '') < ui.from) || (ui.to && (t.date || '9999') > ui.to)) continue;
            const order = ranked(t), seen = new Set();
            // 1.0x points: match points with no multipliers and no rest points. Older saves without
            // rawPoints: total points minus rest awards from the match history.
            const restPts = name => (t.matchHistory || []).reduce((n, r) =>
                n + (r.byesApplied || []).filter(b => b.name === name).reduce((m, b) => m + (b.pts || 0), 0), 0);
            const rawOf = p => (typeof p.rawPoints === 'number' ? p.rawPoints : Math.max(0, (p.points || 0) - restPts(p.name)));
            // Actual points conceded in matches (1.0x, no rests). Older saves: every match adds up to the
            // match points, so lost = matches × match points − actual points won. Recorded tables keep what was typed.
            const rawLostOf = p => typeof p.rawPointsLost === 'number' ? p.rawPointsLost
                : t.recorded ? (p.pointsLost || 0)
                : Math.max(0, (p.roundsPlayed || 0) * (t.maxPoints || 16) - rawOf(p));
            order.forEach((p, i) => {
                const key = keyOf(p.name || '');
                if (!key || seen.has(key)) return;
                seen.add(key);
                let rec = people.get(key);
                if (!rec) people.set(key, rec = { key, kind, name: titleCaseName(p.name), lastDate: '', events: [] });
                if ((t.date || '') >= rec.lastDate) { rec.lastDate = t.date || ''; rec.name = titleCaseName(p.name); }
                rec.events.push({
                    id: t.id, tName: t.name, date: t.date || '', format: t.format, finished: !!t.isFinished,
                    rank: i + 1, field: order.length, points: p.points || 0, lost: p.pointsLost || 0, raw: rawOf(p), rawLost: rawLostOf(p),
                    played: p.roundsPlayed || 0, wins: p.wins || 0, ties: p.ties || 0, losses: p.losses || 0
                });
            });
        }
        const rows = [...people.values()].map(r => {
            const sum = f => exact(r.events.reduce((n, e) => n + e[f], 0));
            const wins = sum('wins'), ties = sum('ties'), losses = sum('losses'), decided = wins + ties + losses;
            const fin = r.events.filter(e => e.finished);
            r.events.sort((a, b) => b.date.localeCompare(a.date));
            return {
                ...r,
                tournaments: r.events.length,
                titles: fin.filter(e => e.rank === 1).length,
                podiums: fin.filter(e => e.rank <= 3).length,
                played: sum('played'), wins, ties, losses,
                winPct: decided ? (100 * wins) / decided : 0,
                avg: sum('played') ? exact(sum('raw') / sum('played')) : 0,
                // Career totals use actual match points (no rest points, no multipliers). Each tournament's
                // own table still ranks by its total points.
                points: sum('raw'), lost: sum('rawLost'), diff: show(sum('raw')) - show(sum('rawLost')),
                best: fin.length ? Math.min(...fin.map(e => e.rank)) : null
            };
        });
        return { rows, kindsSeen };
    }

    // Sort options (the pills above the cards). 'rank' = official order.
    const SORTS = [['rank', 'Rank'], ['winPct', 'Win %'], ['titles', 'Titles'], ['diff', 'Diff'],
                   ['played', 'Played'], ['avg', 'Avg pts']];
    // Official order, 1st to last: best win %, then most titles, then best points difference.
    function officialOrder(a, b) {
        return (b.winPct - a.winPct) ||
               (b.titles - a.titles) ||
               (b.diff - a.diff) ||
               a.name.localeCompare(b.name);
    }

    // r.rank (rank within the current list, used for the crown) is set before any search filter.
    function sortRows(rows) {
        const k = ui.sort, d = ui.dir;
        if (k === 'rank') return rows.sort((a, b) => d * (a.rank - b.rank));
        return rows.sort((a, b) => {
            if (k === 'name') return d * a.name.localeCompare(b.name);
            return (a[k] !== b[k] ? d * (a[k] - b[k]) : 0) || (a.rank - b.rank);
        });
    }

    // "Federico Bernardeschi" → first line "Federico", bold second line "Bernardeschi".
    // Teams ("Ali & Omar") split at the "&".
    function nameLines(name) {
        const n = String(name).trim();
        const amp = n.indexOf(' & ');
        if (amp > 0) return [n.slice(0, amp) + ' &', n.slice(amp + 3)];
        const sp = n.indexOf(' ');
        return sp > 0 ? [n.slice(0, sp), n.slice(sp + 1)] : ['', n];
    }
    function initials(name) {
        const parts = String(name).replace(/&/g, ' ').trim().split(/\s+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0] || '')[1] || '')).toUpperCase();
    }
    function hueOf(key) { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
    const photoOf = r => (window.CloudSync && CloudSync.getPhoto ? CloudSync.getPhoto(r.kind, r.key) : null);
    function avatar(r, cls = '') {
        const ph = photoOf(r);
        return ph
            ? `<span class="pl-avatar has-photo ${isCutout(ph) ? 'is-cutout' : 'is-photo'} ${cls}" aria-hidden="true"><img src="${ph}" alt="" loading="lazy"></span>`
            : `<span class="pl-avatar ${cls}" style="--h:${hueOf(r.key)}" aria-hidden="true">${esc(initials(r.name))}</span>`;
    }
    const signed = n => (n > 0 ? '+' : '') + n;

    const profileOf = r => (window.CloudSync && CloudSync.getProfile ? CloudSync.getProfile(r.kind, r.key) : null);
    const SIDE_LABEL = { left: 'Left side', right: 'Right side', both: 'Both sides' };
    const SIDE_SHORT = { left: 'L', right: 'R', both: 'L/R' };

    function cardHtml(r, i, selected) {
        const prof = profileOf(r);
        const [first, last] = nameLines(r.name);
        const crown = r.rank === 1 ? '<span class="pl-crown" title="Leader">👑</span>' : '';
        return `<article class="pl-row pl-card ${selected ? 'open' : ''} ${photoOf(r) ? 'with-photo' : ''}" data-key="${esc(r.key)}" tabindex="0" role="button" aria-expanded="${selected}">
            ${avatar(r)}
            <div class="pl-card-body">
                <h3 class="pl-name">${crown}<span class="pl-first">${esc(first)}</span> <strong>${esc(last)}</strong>${prof && prof.side ? `<span class="pl-side" title="${SIDE_LABEL[prof.side]}">${SIDE_SHORT[prof.side]}</span>` : ''}</h3>
                ${prof && prof.nickname ? `<p class="pl-nick">“${esc(prof.nickname)}”</p>` : ''}
                <dl class="pl-mini">
                    <div><dt>Win %</dt><dd class="pl-win">${r.winPct.toFixed(0)}%</dd></div>
                    <div><dt>Titles</dt><dd class="pl-titles">${r.titles}</dd></div>
                    <div><dt>Diff</dt><dd>${signed(r.diff)}</dd></div>
                    <div><dt>Played</dt><dd>${r.played}</dd></div>
                    <div><dt>Avg pts</dt><dd class="pl-avg">${r.avg.toFixed(1)}</dd></div>
                </dl>
            </div>
            <span class="pl-num" aria-label="Position ${i + 1}">${i + 1}</span>
        </article>`;
    }

    function bar(label, value, pct, tone, note = '') {
        const w = Math.max(0, Math.min(100, pct));
        return `<div class="pl-bar"><div class="pl-bar-head"><span>${label}</span><b>${note}${value}</b></div>
            <div class="pl-track"><i class="tone-${tone}" style="width:${w}%"></i></div></div>`;
    }

    function detailHtml(r, list) {
        const prof = profileOf(r);
        const [first, last] = nameLines(r.name);
        const fin = r.events.filter(e => e.finished).length;
        const bestAvg = Math.max(...list.map(x => x.avg), 0.0001);
        const pointsShare = (r.points + r.lost) > 0 ? (100 * r.points) / (r.points + r.lost) : 0;
        // Trend: win % in the most recent tournament compared with the career figure.
        const last1 = r.events[0], lastDec = last1 ? last1.wins + last1.ties + last1.losses : 0;
        const lastPct = lastDec ? (100 * last1.wins) / lastDec : null;
        const trend = lastPct === null || r.events.length < 2 ? '' : lastPct > r.winPct + 0.5
            ? '<span class="pl-trend up" title="Last tournament above career win %">▲</span>'
            : lastPct < r.winPct - 0.5 ? '<span class="pl-trend down" title="Last tournament below career win %">▼</span>' : '';
        const group = ui.group === 'main' ? 'Leaderboard' : 'All players';
        return `<section class="pl-detail" aria-label="${esc(r.name)} details">
            <div class="pl-hero ${photoOf(r) ? 'with-photo' : ''}">
                <div class="pl-photo">${avatar(r, photoOf(r) ? 'pl-avatar-lg pl-portrait' : 'pl-avatar-lg')}</div>
                <div class="pl-hero-text">
                    <p class="pl-eyebrow">${r.rank === 1 ? '👑 ' : ''}#${r.rank} · ${group}</p>
                    <h3 class="pl-hero-name">${esc(first)}<strong>${esc(last)}</strong></h3>
                    ${prof && (prof.nickname || prof.side) ? `<p class="pl-hero-nick">${prof.nickname ? `“${esc(prof.nickname)}”` : ''}${prof.nickname && prof.side ? ' · ' : ''}${prof.side ? SIDE_LABEL[prof.side] : ''}</p>` : ''}
                    <dl class="pl-hero-stats">
                        <div><dt>Events</dt><dd>${r.tournaments}</dd></div>
                        <div><dt>Matches</dt><dd>${r.played}</dd></div>
                        <div><dt>Titles</dt><dd>${r.titles ? '🏆 ' + r.titles : 0}</dd></div>
                        <div><dt>Best</dt><dd>${r.best ? ordinal(r.best) : '–'}</dd></div>
                    </dl>
                </div>
                <button class="pl-close" data-close aria-label="Close"><svg><use href="#i-close"/></svg></button>
            </div>
            <div class="pl-bars">
                ${bar('Win rate', r.winPct.toFixed(0) + '%', r.winPct, 'a', trend)}
                ${bar('Avg points per match', r.avg.toFixed(1), (100 * r.avg) / bestAvg, 'b')}
                ${bar('Points won share', pointsShare.toFixed(0) + '%', pointsShare, 'c')}
                ${bar('Podium rate', fin ? Math.round((100 * r.podiums) / fin) + '%' : '–', fin ? (100 * r.podiums) / fin : 0, 'd')}
                ${bar('Title rate', fin ? Math.round((100 * r.titles) / fin) + '%' : '–', fin ? (100 * r.titles) / fin : 0, 'a')}
            </div>
            <div class="pl-record">
                <div><b class="w">${r.wins}</b><small>Won</small></div>
                <div><b class="t">${r.ties}</b><small>Tied</small></div>
                <div><b class="l">${r.losses}</b><small>Lost</small></div>
                <div><b>${cell(r.points)}</b><small>Actual pts</small></div>
                <div><b>${signed(r.diff)}</b><small>Diff</small></div>
            </div>
            ${ui.editing === r.key + ':nickname' ? `
            <form class="pl-details-form" data-details-form="nickname">
                <label>Nickname<input type="text" name="nickname" maxlength="40" value="${esc(prof ? prof.nickname : '')}" placeholder="e.g. The Wall"></label>
                <div class="pl-details-actions"><button type="button" class="btn btn-secondary btn-sm" data-details="cancel">Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save nickname</button></div>
            </form>` : ''}
            ${ui.editing === r.key + ':side' ? `
            <form class="pl-details-form" data-details-form="side">
                <fieldset><legend>Playing side</legend>
                    ${[['', 'Not set'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both']].map(([v, l]) =>
                        `<label class="pl-side-opt"><input type="radio" name="side" value="${v}" ${(prof ? prof.side : '') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
                </fieldset>
                <div class="pl-details-actions"><button type="button" class="btn btn-secondary btn-sm" data-details="cancel">Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save side</button></div>
            </form>` : ''}
            <div class="pl-photo-links">
                <button data-photo="set"><svg><use href="#i-camera"/></svg>${photoOf(r) ? 'Change photo' : 'Add photo'}</button>
                ${photoOf(r) ? '<button data-photo="remove">Remove photo</button>' : ''}
                ${ui.editing === r.key + ':nickname' ? '' : `<button data-details="nickname"><svg><use href="#i-record"/></svg>${prof && prof.nickname ? 'Edit nickname' : 'Add nickname'}</button>`}
                ${ui.editing === r.key + ':side' ? '' : `<button data-details="side"><svg><use href="#i-arrow"/></svg>${prof && prof.side ? 'Change playing side' : 'Set playing side'}</button>`}
            </div>
        </section>`;
    }

    const wide = window.matchMedia('(min-width: 1100px)');

    function render() {
        const screen = $('players-screen');
        if (!screen || screen.classList.contains('hidden')) return;
        let { rows, kindsSeen } = compute();

        $('pl-kind').hidden = kindsSeen.size < 2;
        if (kindsSeen.size === 1 && !kindsSeen.has(ui.kind)) { ui.kind = [...kindsSeen][0]; return render(); }
        document.querySelectorAll('#pl-kind button').forEach(b => b.classList.toggle('active', b.dataset.kind === ui.kind));

        const min = minMatches(), allRows = rows;
        document.querySelectorAll('#pl-group button').forEach(b => b.classList.toggle('active', b.dataset.group === ui.group));
        const unit = ui.kind === 'team' ? 'team' : 'player';
        rows = ui.group === 'main' ? allRows.filter(r => r.played >= min) : allRows;
        rows.slice().sort(officialOrder).forEach((r, i) => { r.rank = i + 1; });
        const q = keyOf(ui.query);
        const shown = sortRows(rows.filter(r => !q || r.key.includes(q) || (profileOf(r) && keyOf(profileOf(r).nickname || '').includes(q))));
        $('pl-title').textContent = ui.group === 'main' ? 'Leaderboard' : 'All players';
        const master = window.CloudSync && CloudSync.isMaster();
        $('pl-merge').disabled = !master;
        $('pl-merge').title = master ? 'Merge two names that are the same person' : 'Needs the master key';
        $('pl-count').textContent = `${rows.length} ${unit}${rows.length === 1 ? '' : 's'}`;
        $('pl-help').textContent = (ui.group === 'main'
            ? `${unit === 'team' ? 'Teams' : 'Players'} with ${min}+ matches`
            : `Everyone, whatever their number of matches`)
            + ', ranked by win %, then titles, then points difference. Points here are actual match points (no rest points or multipliers); each tournament\u2019s own table still uses its total points. Titles count completed tournaments only. Tap a card for details.'
            + (ui.from || ui.to ? ` Showing tournaments played ${periodText()}.` : '');

        $('pl-sorts').innerHTML = SORTS.map(([k, label]) =>
            `<button class="pl-sort ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${label}${ui.sort === k && k !== 'rank' ? (ui.dir < 0 ? ' ↓' : ' ↑') : ''}</button>`).join('');

        const list = $('pl-body'), aside = $('pl-aside');
        if (!shown.length) {
            const msg = rows.length ? 'No one matches that search.'
                : (allRows.length && ui.group === 'main') ? `Nobody has played ${min} matches yet. See “All players” for everyone.`
                : (ui.from || ui.to) ? `No tournaments were played ${periodText()}. Pick a wider period.`
                : (ui.includeUnfinished ? 'No tournaments saved yet. Results appear here as soon as you play.'
                                        : 'No completed tournaments yet. Finish a tournament, or tick “Include unfinished”.');
            list.innerHTML = `<p class="pl-empty">${msg}</p>`;
            aside.innerHTML = ''; aside.hidden = true;
            return;
        }
        // Wide screens: detail panel beside the list, first card selected. Phones: details open under the tapped card.
        if (wide.matches && !shown.some(r => r.key === ui.open)) ui.open = shown[0].key;
        const sel = shown.find(r => r.key === ui.open) || null;
        currentRows = shown;
        list.innerHTML = shown.map((r, i) => cardHtml(r, i, r === sel) + (!wide.matches && r === sel ? detailHtml(r, rows) : '')).join('');
        aside.hidden = !wide.matches || !sel;
        aside.innerHTML = wide.matches && sel ? detailHtml(sel, rows) : '';
    }

    // Photos are stored small. Two kinds:
    //  - a cut-out (PNG/WebP with a transparent background, e.g. iPhone "Lift subject"): the empty
    //    edges are trimmed and it is kept transparent, so it stands on the card like a player photo;
    //  - an ordinary photo: cropped to 4:5 around the upper part (faces) and saved as a ~30 KB JPEG.
    const isCutout = data => /^data:image\/(png|webp)/.test(data || '');
    async function shrinkPhoto(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const iw = img.naturalWidth, ih = img.naturalHeight;
            // Look for transparency (only PNG / WebP / GIF can have it).
            let box = null;
            if (/png|webp|gif/i.test(file.type)) {
                const sc = Math.min(1, 400 / Math.max(iw, ih));
                const t = document.createElement('canvas');
                t.width = Math.max(1, Math.round(iw * sc)); t.height = Math.max(1, Math.round(ih * sc));
                const tx = t.getContext('2d', { willReadFrequently: true });
                tx.drawImage(img, 0, 0, t.width, t.height);
                const px = tx.getImageData(0, 0, t.width, t.height).data;
                let minX = t.width, minY = t.height, maxX = -1, maxY = -1, clear = 0;
                for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
                    const a = px[(y * t.width + x) * 4 + 3];
                    if (a < 20) { clear++; continue; }
                    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
                if (maxX >= 0 && clear > t.width * t.height * 0.05) box = [minX / sc, minY / sc, (maxX - minX + 1) / sc, (maxY - minY + 1) / sc];
            }
            const c = document.createElement('canvas');
            if (box) {
                for (const maxH of [520, 420, 340]) {
                    const scale = Math.min(maxH / box[3], 420 / box[2], 1);
                    c.width = Math.round(box[2] * scale); c.height = Math.round(box[3] * scale);
                    const cx = c.getContext('2d');
                    cx.clearRect(0, 0, c.width, c.height);
                    cx.drawImage(img, box[0], box[1], box[2], box[3], 0, 0, c.width, c.height);
                    let out = c.toDataURL('image/webp', 0.85);
                    if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/png');
                    if (out.length < 380000) return out;
                }
            }
            const W = 360, H = 450, scale = Math.max(W / iw, H / ih);
            const sw = W / scale, sh = H / scale;
            const sx = (iw - sw) / 2, sy = Math.max(0, (ih - sh) * 0.3);
            c.width = W; c.height = H;
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
            return c.toDataURL('image/jpeg', 0.82);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    /* ---------- photo editor: position, zoom, rotate, brightness before saving ---------- */
    const OUT_W = 360, OUT_H = 450;           // saved size (4:5)
    const ed = { img: null, cutout: false, rot: 0, zoom: 1, x: 0, y: 0, bright: 100, base: 1 };

    // Does the picture have a transparent background (a cut-out)?
    function hasTransparency(img, type) {
        if (!/png|webp|gif/i.test(type || '')) return false;
        const sc = Math.min(1, 300 / Math.max(img.naturalWidth, img.naturalHeight));
        const t = document.createElement('canvas');
        t.width = Math.max(1, Math.round(img.naturalWidth * sc)); t.height = Math.max(1, Math.round(img.naturalHeight * sc));
        const tx = t.getContext('2d', { willReadFrequently: true });
        tx.drawImage(img, 0, 0, t.width, t.height);
        const px = tx.getImageData(0, 0, t.width, t.height).data;
        let clear = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] < 20) clear++;
        return clear > (px.length / 4) * 0.05;
    }
    const rotated = () => ed.rot % 180 !== 0;
    const srcW = () => (rotated() ? ed.img.naturalHeight : ed.img.naturalWidth);
    const srcH = () => (rotated() ? ed.img.naturalWidth : ed.img.naturalHeight);
    // Zoom 1 = the picture just fills the frame (photo) or just fits inside it (cut-out).
    function baseScale() {
        return ed.cutout ? Math.min(OUT_W / srcW(), OUT_H / srcH()) : Math.max(OUT_W / srcW(), OUT_H / srcH());
    }
    // Keep a photo covering the whole frame (no empty edges); cut-outs may move freely.
    function clampOffsets() {
        const sc = ed.base * ed.zoom, w = srcW() * sc, h = srcH() * sc;
        if (!ed.cutout) {
            const mx = Math.max(0, (w - OUT_W) / 2), my = Math.max(0, (h - OUT_H) / 2);
            ed.x = Math.max(-mx, Math.min(mx, ed.x)); ed.y = Math.max(-my, Math.min(my, ed.y));
        } else {
            ed.x = Math.max(-OUT_W / 2, Math.min(OUT_W / 2, ed.x)); ed.y = Math.max(-OUT_H / 2, Math.min(OUT_H / 2, ed.y));
        }
    }
    function drawEdit(ctx, w, h) {
        const k = w / OUT_W, sc = ed.base * ed.zoom * k;
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.filter = ed.bright !== 100 ? `brightness(${ed.bright}%)` : 'none';
        ctx.translate(w / 2 + ed.x * k, h / 2 + ed.y * k);
        ctx.rotate(ed.rot * Math.PI / 180);
        ctx.drawImage(ed.img, -ed.img.naturalWidth * sc / 2, -ed.img.naturalHeight * sc / 2, ed.img.naturalWidth * sc, ed.img.naturalHeight * sc);
        ctx.restore();
    }
    function paintPreview() {
        const cv = $('photo-canvas'), dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth || 240, h = Math.round(w * OUT_H / OUT_W);
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        drawEdit(cv.getContext('2d'), cv.width, cv.height);
    }
    function resetEdit(keepRot) {
        if (!keepRot) ed.rot = 0;
        ed.zoom = 1; ed.x = 0; ed.y = ed.cutout ? 0 : 0; ed.bright = 100;
        ed.base = baseScale();
        // ordinary photos start a little towards the top, where faces usually are
        if (!ed.cutout) { const sc = ed.base, h = srcH() * sc; ed.y = Math.max(0, (h - OUT_H) / 2) * 0.4; clampOffsets(); }
        $('photo-zoom').value = 100; $('photo-bright').value = 100;
        paintPreview();
    }
    // Final image: 360×450 JPEG for photos; for cut-outs, a transparent WebP/PNG trimmed to the person.
    function exportEdit() {
        const c = document.createElement('canvas');
        c.width = OUT_W; c.height = OUT_H;
        const cx = c.getContext('2d', { willReadFrequently: true });
        if (!ed.cutout) {
            cx.fillStyle = '#fff'; cx.fillRect(0, 0, OUT_W, OUT_H);
            drawEdit(cx, OUT_W, OUT_H);
            // drawEdit clears the canvas, so paint the white backing underneath afterwards
            cx.globalCompositeOperation = 'destination-over'; cx.fillStyle = '#fff'; cx.fillRect(0, 0, OUT_W, OUT_H);
            return c.toDataURL('image/jpeg', 0.85);
        }
        drawEdit(cx, OUT_W, OUT_H);
        const px = cx.getImageData(0, 0, OUT_W, OUT_H).data;
        let minX = OUT_W, minY = OUT_H, maxX = -1, maxY = -1;
        for (let y = 0; y < OUT_H; y++) for (let x = 0; x < OUT_W; x++) {
            if (px[(y * OUT_W + x) * 4 + 3] < 20) continue;
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (maxX < 0) return null;
        // keep the bottom of the frame (feet / chest on the card edge) and trim the sides and top
        const t = document.createElement('canvas');
        t.width = maxX - minX + 1; t.height = OUT_H - minY;
        t.getContext('2d').drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
        let out = t.toDataURL('image/webp', 0.88);
        if (!/^data:image\/webp/.test(out)) out = t.toDataURL('image/png');
        return out;
    }
    async function openPhotoEditor(file) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw e; }
        ed.img = img; ed.url = url; ed.original = null;
        ed.cutout = hasTransparency(img, file.type);
        $('photo-removebg').hidden = ed.cutout; $('photo-undo-bg').hidden = true;
        if (!ed.cutout && window.BgRemove) BgRemove.warmUp();
        $('photo-frame').classList.toggle('is-cutout-frame', ed.cutout);
        $('photo-kind').textContent = ed.cutout
            ? 'Cut-out picture (no background): it will stand on the bottom edge of the card.'
            : 'Drag to move. Use the slider or pinch to zoom.';
        $('photoDialog').showModal();
        requestAnimationFrame(() => resetEdit());
    }
    async function removeBackground() {
        if (!ed.img || !window.BgRemove) return;
        const btns = ['photo-removebg', 'photo-save', 'photo-rotate', 'photo-reset'].map(id => $(id));
        btns.forEach(b => { b.disabled = true; });
        $('photo-frame').classList.add('is-busy');
        $('photo-kind').textContent = 'Removing the background… The first time can take a few seconds.';
        try {
            const { canvas, method } = await BgRemove.remove(ed.img);
            const img = new Image();
            img.src = canvas.toDataURL('image/png');
            await img.decode();
            ed.original = { img: ed.img, cutout: ed.cutout };
            ed.img = img; ed.cutout = true;
            $('photo-frame').classList.add('is-cutout-frame');
            $('photo-removebg').hidden = true; $('photo-undo-bg').hidden = false;
            $('photo-kind').textContent = method === 'ai'
                ? 'Background removed. Check the edges, then save – or undo.'
                : 'Background removed (plain-background mode, the AI could not be loaded). Check the edges, then save – or undo.';
            resetEdit(true);
        } catch (e) {
            $('photo-kind').textContent = 'Couldn\u2019t remove the background' + (e && e.message ? ': ' + e.message : '.') + ' You can still save the photo as it is.';
        } finally {
            btns.forEach(b => { b.disabled = false; });
            $('photo-frame').classList.remove('is-busy');
        }
    }

    function closePhotoEditor() {
        $('photoDialog').close();
        if (ed.url) URL.revokeObjectURL(ed.url);
        ed.img = null; ed.url = null;
    }
    function initPhotoEditor() {
        const cv = $('photo-canvas');
        const pointers = new Map();
        let last = null, pinch = null;
        cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; });
        cv.addEventListener('pointermove', e => {
            if (!pointers.has(e.pointerId) || !ed.img) return;
            pointers.set(e.pointerId, [e.clientX, e.clientY]);
            const k = OUT_W / cv.clientWidth;
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
                if (pinch) { ed.zoom = Math.max(1, Math.min(4, ed.zoom * d / pinch)); $('photo-zoom').value = Math.round(ed.zoom * 100); }
                pinch = d;
            } else if (last) {
                ed.x += (e.clientX - last[0]) * k; ed.y += (e.clientY - last[1]) * k;
            }
            last = [e.clientX, e.clientY];
            clampOffsets(); paintPreview();
        });
        const up = e => { pointers.delete(e.pointerId); pinch = null; last = pointers.size ? [...pointers.values()][0] : null; };
        cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
        cv.addEventListener('wheel', e => { e.preventDefault(); ed.zoom = Math.max(1, Math.min(4, ed.zoom * (e.deltaY < 0 ? 1.08 : 0.92))); $('photo-zoom').value = Math.round(ed.zoom * 100); clampOffsets(); paintPreview(); }, { passive: false });
        $('photo-zoom').addEventListener('input', e => { ed.zoom = e.target.value / 100; clampOffsets(); paintPreview(); });
        $('photo-bright').addEventListener('input', e => { ed.bright = +e.target.value; paintPreview(); });
        $('photo-rotate').addEventListener('click', () => { ed.rot = (ed.rot + 90) % 360; resetEdit(true); });
        $('photo-reset').addEventListener('click', () => resetEdit());
        $('photo-removebg').addEventListener('click', removeBackground);
        $('photo-undo-bg').addEventListener('click', () => {
            if (!ed.original) return;
            ed.img = ed.original.img; ed.cutout = ed.original.cutout; ed.original = null;
            $('photo-frame').classList.toggle('is-cutout-frame', ed.cutout);
            $('photo-undo-bg').hidden = true; $('photo-removebg').hidden = false;
            $('photo-kind').textContent = 'Background restored.';
            resetEdit(true);
        });
        $('photo-cancel').addEventListener('click', () => { photoTarget = null; closePhotoEditor(); });
        $('photoDialog').addEventListener('cancel', () => { photoTarget = null; if (ed.url) URL.revokeObjectURL(ed.url); ed.img = null; });
        // arrow keys nudge the picture (keyboard users)
        cv.addEventListener('keydown', e => {
            const step = e.shiftKey ? 20 : 5, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (!d) return; e.preventDefault(); ed.x += d[0]; ed.y += d[1]; clampOffsets(); paintPreview();
        });
        $('photo-save').addEventListener('click', () => {
            if (!ed.img || !photoTarget) return closePhotoEditor();
            const data = exportEdit();
            if (!data) { alert('The picture is empty. Move it back into the frame.'); return; }
            CloudSync.setPhoto(photoTarget.kind, photoTarget.key, data);
            photoTarget = null;
            closePhotoEditor();
            render();
        });
    }

    let photoTarget = null;
    function photoAction(kind) {
        const sel = currentRows.find(r => r.key === ui.open);
        if (!sel) return;
        if (photoOf(sel) && !CloudSync.mayChangePhoto(sel.kind, sel.key)) { alert(CloudSync.MASTER_ONLY); return; }
        if (kind === 'remove') {
            if (confirm(`Remove ${sel.name}'s photo?`)) { CloudSync.setPhoto(sel.kind, sel.key, null); render(); }
            return;
        }
        photoTarget = sel;
        $('pl-photo-input').value = '';
        $('pl-photo-input').click();
    }
    let currentRows = [];

    /* ---------- period filter ---------- */
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const nice = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
    function periodText() {
        if (ui.from && ui.to) return `from ${nice(ui.from)} to ${nice(ui.to)}`;
        return ui.from ? `from ${nice(ui.from)} onwards` : `up to ${nice(ui.to)}`;
    }
    function presetRange(v) {
        const now = new Date(), y = now.getFullYear(), m = now.getMonth();
        switch (v) {
            case 'this-month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
            case 'last-month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
            case '3m': return [iso(new Date(y, m - 2, 1)), iso(now)];
            case '6m': return [iso(new Date(y, m - 5, 1)), iso(now)];
            case 'this-year': return [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31))];
            default: return ['', ''];
        }
    }
    function setPeriod(from, to, preset) {
        if (from && to && from > to) [from, to] = [to, from];
        ui.from = from; ui.to = to; ui.open = null;
        $('pl-from').value = from; $('pl-to').value = to;
        $('pl-range').value = preset || (from || to ? 'custom' : 'all');
        $('pl-date-clear').hidden = !(from || to);
        render();
    }

    /* ---------- merge two players (master key) ---------- */
    // Everyone who has played, by name key, for the merge lists (all time, finished or not).
    function allPeople(kind) {
        const people = new Map();
        for (const t of getSavedTournaments()) {
            if ((TEAM_FORMATS.includes(t.format) ? 'team' : 'player') !== kind) continue;
            for (const p of (t.participants || t.players || [])) {
                const key = keyOf(p.name || '');
                if (!key) continue;
                const rec = people.get(key) || { key, name: titleCaseName(p.name), ids: new Set() };
                rec.ids.add(t.id);
                people.set(key, rec);
            }
        }
        return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    // Replace one name with another everywhere it appears in a saved tournament.
    function renameInRecord(t, fromKey, toName) {
        const swap = n => (typeof n === 'string' && keyOf(n) === fromKey ? toName : n);
        const swapTeamText = txt => typeof txt !== 'string' ? txt
            : keyOf(txt) === fromKey ? toName : txt.split(' & ').map(swap).join(' & ');
        const swapKeys = obj => obj && typeof obj === 'object' && !Array.isArray(obj)
            ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.split(':::').map(swap).join(':::'), Array.isArray(v) ? v.map(swap) : swap(v)])) : obj;
        const swapMatch = m => { if (m) ['p1', 'p2', 'p3', 'p4'].forEach(f => { if (m[f]) m[f] = swap(m[f]); }); };
        (t.participants || t.players || []).forEach(p => { p.name = swap(p.name); });
        t.winner = swapTeamText(t.winner);
        (t.matchHistory || []).forEach(r => {
            (r.matches || []).forEach(m => { m.team1 = swapTeamText(m.team1); m.team2 = swapTeamText(m.team2); });
            (r.byesApplied || []).forEach(b => { b.name = swap(b.name); });
        });
        (t.roundActiveMatches || []).forEach(swapMatch);
        (t.sittingOutThisRound || []).forEach(x => { if (x) x.name = swap(x.name); });
        (t.fullPrecomputedSchedule || []).forEach(r => { (r.matches || []).forEach(swapMatch); (r.byes || []).forEach(x => { if (x) x.name = swap(x.name); }); });
        (t.roundSnapshots || []).forEach(sn => {
            (sn.participants || []).forEach(p => { p.name = swap(p.name); });
            (sn.roundActiveMatches || []).forEach(swapMatch);
            (sn.sittingOutThisRound || []).forEach(x => { if (x) x.name = swap(x.name); });
        });
        ['partnerCountMatrix', 'lastPartnerRound', 'teamOpponentCount', 'lastTeamOpponentRound'].forEach(f => { if (t[f]) t[f] = swapKeys(t[f]); });
        if (t.hybridState) ['lastPartner', 'lastOpponents', 'phasePartners', 'phaseOpponents'].forEach(f => { if (t.hybridState[f]) t.hybridState[f] = swapKeys(t.hybridState[f]); });
        t.updatedAt = new Date().toISOString();
        delete t._synced;
    }

    function openMerge() {
        if (!CloudSync.isMaster()) { alert('Merging players needs the master key. Enter it in Online database first.'); return; }
        const people = allPeople(ui.kind);
        if (people.length < 2) { alert('There are not enough players to merge.'); return; }
        const opts = people.map(p => `<option value="${esc(p.key)}">${esc(p.name)} (${p.ids.size} tournament${p.ids.size === 1 ? '' : 's'})</option>`).join('');
        $('merge-keep').innerHTML = opts;
        $('merge-from').innerHTML = opts;
        $('merge-from').selectedIndex = 1;
        mergePreview();
        $('mergeDialog').showModal();
    }
    function mergePreview() {
        const people = new Map(allPeople(ui.kind).map(p => [p.key, p]));
        const keep = people.get($('merge-keep').value), from = people.get($('merge-from').value);
        const both = keep && from ? [...from.ids].filter(id => keep.ids.has(id)) : [];
        let msg = '', ok = false;
        if (!keep || !from || keep === from) msg = 'Choose two different names.';
        else if (both.length) {
            const names = getSavedTournaments().filter(t => both.includes(t.id)).map(t => t.name).join(', ');
            msg = `Can't merge: both names played in the same tournament (${names}), so they must be different people.`;
        } else {
            ok = true;
            msg = `“${from.name}” (${from.ids.size} tournament${from.ids.size === 1 ? '' : 's'}) will be renamed to “${keep.name}” everywhere, and their stats combined. This can't be undone.`;
        }
        $('merge-preview').textContent = msg;
        $('merge-go').disabled = !ok;
    }
    function doMerge() {
        const people = new Map(allPeople(ui.kind).map(p => [p.key, p]));
        const keep = people.get($('merge-keep').value), from = people.get($('merge-from').value);
        if (!keep || !from || keep === from || [...from.ids].some(id => keep.ids.has(id))) return;
        if (!confirm(`Merge “${from.name}” into “${keep.name}”?`)) return;
        // The live tournament is saved first, then reloaded with the new name.
        const liveId = typeof tournamentId !== 'undefined' && participants.length && !isTournamentFinished ? tournamentId : null;
        if (liveId) autoSaveCurrentTournament();
        const list = getSavedTournaments();
        list.filter(t => from.ids.has(t.id)).forEach(t => renameInRecord(t, from.key, keep.name));
        saveTournamentsToStorage(list);
        // Photo and details follow the player if the kept name has none.
        const ph = CloudSync.getPhoto(ui.kind, from.key);
        if (ph) { if (!CloudSync.getPhoto(ui.kind, keep.key)) CloudSync.setPhoto(ui.kind, keep.key, ph); CloudSync.setPhoto(ui.kind, from.key, null); }
        const pr = CloudSync.getProfile(ui.kind, from.key);
        if (pr) { if (!CloudSync.getProfile(ui.kind, keep.key)) CloudSync.setProfile(ui.kind, keep.key, pr); CloudSync.setProfile(ui.kind, from.key, { nickname: '', side: '' }); }
        if (liveId && from.ids.has(liveId)) {
            const screens = ['setup-screen', 'tournament-screen', 'vault-screen', 'archive-view-screen', 'players-screen', 'record-screen'];
            resumeTournamentById(liveId);
            screens.forEach(id => document.getElementById(id).classList.toggle('hidden', id !== 'players-screen'));
        }
        CloudSync.queueSave();
        $('mergeDialog').close();
        ui.open = keep.key;
        render();
    }

    function openTournament(id) {
        $('players-screen').classList.add('hidden');
        viewTournamentDetails(id);
    }

    function init() {
        $('pl-kind').addEventListener('click', e => {
            const b = e.target.closest('button[data-kind]');
            if (b) { ui.kind = b.dataset.kind; ui.open = null; render(); }
        });
        $('pl-group').addEventListener('click', e => {
            const b = e.target.closest('button[data-group]');
            if (b) { ui.group = b.dataset.group; ui.open = null; render(); }
        });
        $('pl-range').addEventListener('change', e => {
            const v = e.target.value;
            if (v === 'custom') { $('pl-from').focus(); return; }
            const [f, t] = presetRange(v);
            setPeriod(f, t, v);
        });
        $('pl-from').addEventListener('change', e => setPeriod(e.target.value, ui.to));
        $('pl-to').addEventListener('change', e => setPeriod(ui.from, e.target.value));
        $('pl-date-clear').addEventListener('click', () => setPeriod('', ''));
        $('pl-merge').addEventListener('click', openMerge);
        $('merge-keep').addEventListener('change', mergePreview);
        $('merge-from').addEventListener('change', mergePreview);
        $('merge-go').addEventListener('click', doMerge);
        $('merge-cancel').addEventListener('click', () => $('mergeDialog').close());
        $('pl-unfinished').addEventListener('change', e => { ui.includeUnfinished = e.target.checked; render(); });
        $('pl-search').addEventListener('input', e => { ui.query = e.target.value; render(); });
        $('pl-sorts').addEventListener('click', e => {
            const b = e.target.closest('button[data-sort]');
            if (!b) return;
            const k = b.dataset.sort;
            ui.dir = ui.sort === k ? -ui.dir : (k === 'name' || k === 'rank' ? 1 : -1);
            ui.sort = k;
            render();
        });
        const toggle = card => { ui.open = ui.open === card.dataset.key && !wide.matches ? null : card.dataset.key; render(); };
        const onClick = e => {
            const btn = e.target.closest('button[data-open]');
            if (btn) return openTournament(btn.dataset.open);
            const ph = e.target.closest('[data-photo]');
            if (ph) return photoAction(ph.dataset.photo);
            const dt = e.target.closest('[data-details]');
            if (dt) {
                const sel = currentRows.find(r => r.key === ui.open);
                const field = dt.dataset.details;
                if ((field === 'nickname' || field === 'side') && sel) {
                    if (!CloudSync.mayChangeProfile(sel.kind, sel.key, field)) { alert(CloudSync.MASTER_ONLY); return; }
                    ui.editing = sel.key + ':' + field;
                } else ui.editing = null;
                render();
                return;
            }
            if (e.target.closest('[data-close]')) { ui.open = null; if (!wide.matches) render(); return; }
            if (e.target.closest('.pl-detail')) return;
            const card = e.target.closest('.pl-card');
            if (card) toggle(card);
        };
        const onSubmit = e => {
            const form = e.target.closest('[data-details-form]');
            if (!form) return;
            e.preventDefault();
            const sel = currentRows.find(r => r.key === ui.open);
            if (!sel) return;
            const fd = new FormData(form), cur = profileOf(sel) || { nickname: '', side: '' };
            const field = form.dataset.detailsForm;
            CloudSync.setProfile(sel.kind, sel.key, {
                nickname: field === 'nickname' ? String(fd.get('nickname') || '') : cur.nickname,
                side: field === 'side' ? String(fd.get('side') || '') : cur.side
            });
            ui.editing = null;
            render();
        };
        $('pl-body').addEventListener('submit', onSubmit);
        $('pl-aside').addEventListener('submit', onSubmit);
        $('pl-body').addEventListener('click', onClick);
        $('pl-aside').addEventListener('click', onClick);
        $('pl-body').addEventListener('keydown', e => {
            const card = e.target.closest('.pl-card');
            if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(card); }
        });
        $('pl-photo-input').addEventListener('change', async e => {
            const file = e.target.files && e.target.files[0];
            if (!file || !photoTarget) return;
            try {
                await openPhotoEditor(file);
            } catch (err) {
                alert('That picture could not be opened. Try a JPEG or PNG photo.');
                photoTarget = null;
            }
        });
        initPhotoEditor();
        wide.addEventListener('change', render);
        window.addEventListener('padel:data-changed', render);
    }

    // Career rows for the Excel backup: all time, completed tournaments, ranked like the leaderboard.
    function careerRows(kind) {
        const saved = { kind: ui.kind, from: ui.from, to: ui.to, inc: ui.includeUnfinished };
        Object.assign(ui, { kind, from: '', to: '', includeUnfinished: false });
        try {
            const rows = compute().rows.sort(officialOrder);
            rows.forEach((r, i) => { r.rank = i + 1; r.profile = profileOf(r); });
            return rows;
        } finally {
            Object.assign(ui, { kind: saved.kind, from: saved.from, to: saved.to, includeUnfinished: saved.inc });
        }
    }

    init();
    return { render, careerRows };
})();
