/* Players screen: career stats for every player (and fixed team) across all saved
   tournaments. Built from the tournaments on this device, which cloud.js keeps in
   step with the online database, so it also works offline. */
window.Players = (() => {
    const $ = id => document.getElementById(id);
    const TEAM_FORMATS = ['team-mexicano', 'team-americano', 'beat-the-box'];
    const ui = { kind: 'player', group: 'main', includeUnfinished: false, query: '', sort: 'rank', dir: 1, open: null };
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
        return [...(t.participants || t.players || [])].sort((a, b) => {
            if (t.format === 'beat-the-box' && a.currentBox && b.currentBox && a.currentBox !== b.currentBox) return a.currentBox - b.currentBox;
            if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
            const dA = exact((a.points || 0) - (a.pointsLost || 0)), dB = exact((b.points || 0) - (b.pointsLost || 0));
            if (dB !== dA) return dB - dA;
            if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
            return (a.losses || 0) - (b.losses || 0);
        });
    }

    function compute() {
        const people = new Map();
        const kindsSeen = new Set();
        for (const t of getSavedTournaments()) {
            const kind = TEAM_FORMATS.includes(t.format) ? 'team' : 'player';
            kindsSeen.add(kind);
            if (kind !== ui.kind || (!t.isFinished && !ui.includeUnfinished)) continue;
            const order = ranked(t), seen = new Set();
            // 1.0x points: match points with no multipliers and no rest points. Older saves without
            // rawPoints: total points minus rest awards from the match history.
            const restPts = name => (t.matchHistory || []).reduce((n, r) =>
                n + (r.byesApplied || []).filter(b => b.name === name).reduce((m, b) => m + (b.pts || 0), 0), 0);
            const rawOf = p => (typeof p.rawPoints === 'number' ? p.rawPoints : Math.max(0, (p.points || 0) - restPts(p.name)));
            order.forEach((p, i) => {
                const key = keyOf(p.name || '');
                if (!key || seen.has(key)) return;
                seen.add(key);
                let rec = people.get(key);
                if (!rec) people.set(key, rec = { key, kind, name: titleCaseName(p.name), lastDate: '', events: [] });
                if ((t.date || '') >= rec.lastDate) { rec.lastDate = t.date || ''; rec.name = titleCaseName(p.name); }
                rec.events.push({
                    id: t.id, tName: t.name, date: t.date || '', format: t.format, finished: !!t.isFinished,
                    rank: i + 1, field: order.length, points: p.points || 0, lost: p.pointsLost || 0, raw: rawOf(p),
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
                points: sum('points'), lost: sum('lost'), diff: show(sum('points')) - show(sum('lost')),
                best: fin.length ? Math.min(...fin.map(e => e.rank)) : null
            };
        });
        return { rows, kindsSeen };
    }

    // Sort options (the pills above the cards). 'rank' = official order.
    const SORTS = [['rank', 'Rank'], ['winPct', 'Win %'], ['titles', 'Titles'], ['diff', 'Diff'],
                   ['played', 'Played'], ['avg', 'Avg pts'], ['name', 'Name']];
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
            ? `<span class="pl-avatar has-photo ${cls}" aria-hidden="true"><img src="${ph}" alt="" loading="lazy"></span>`
            : `<span class="pl-avatar ${cls}" style="--h:${hueOf(r.key)}" aria-hidden="true">${esc(initials(r.name))}</span>`;
    }
    const signed = n => (n > 0 ? '+' : '') + n;

    function cardHtml(r, i, selected) {
        const [first, last] = nameLines(r.name);
        const crown = r.rank === 1 ? '<span class="pl-crown" title="Leader">👑</span>' : '';
        return `<article class="pl-row pl-card ${selected ? 'open' : ''}" data-key="${esc(r.key)}" tabindex="0" role="button" aria-expanded="${selected}">
            ${avatar(r)}
            <div class="pl-card-body">
                <h3 class="pl-name">${crown}<span class="pl-first">${esc(first)}</span> <strong>${esc(last)}</strong></h3>
                <dl class="pl-mini">
                    <div><dt>Win %</dt><dd class="pl-win">${r.winPct.toFixed(0)}%</dd></div>
                    <div><dt>Titles</dt><dd class="pl-titles">${r.titles}</dd></div>
                    <div><dt>Diff</dt><dd>${signed(r.diff)}</dd></div>
                    <div><dt>Played</dt><dd>${r.played}</dd></div>
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
            <div class="pl-hero">
                <div class="pl-photo">
                    ${avatar(r, 'pl-avatar-lg')}
                    <div class="pl-photo-actions">
                        <button class="pl-photo-btn" data-photo="set" title="${photoOf(r) ? 'Change photo' : 'Add photo'}"><svg><use href="#i-camera"/></svg><span>${photoOf(r) ? 'Change' : 'Add photo'}</span></button>
                        ${photoOf(r) ? '<button class="pl-photo-btn pl-photo-del" data-photo="remove" title="Remove photo" aria-label="Remove photo"><svg><use href="#i-trash"/></svg></button>' : ''}
                    </div>
                </div>
                <div class="pl-hero-text">
                    <p class="pl-eyebrow">${r.rank === 1 ? '👑 ' : ''}#${r.rank} · ${group}</p>
                    <h3 class="pl-hero-name">${esc(first)}<strong>${esc(last)}</strong></h3>
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
                <div><b>${cell(r.points)}</b><small>Pts won</small></div>
                <div><b>${signed(r.diff)}</b><small>Diff</small></div>
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
        const shown = sortRows(rows.filter(r => !q || r.key.includes(q)));
        $('pl-title').textContent = ui.group === 'main' ? 'Leaderboard' : 'All players';
        $('pl-count').textContent = `${rows.length} ${unit}${rows.length === 1 ? '' : 's'}`;
        $('pl-help').textContent = (ui.group === 'main'
            ? `${unit === 'team' ? 'Teams' : 'Players'} with ${min}+ matches`
            : `Everyone, whatever their number of matches`)
            + ', ranked by win %, then titles, then points difference. Titles count completed tournaments only. Tap a card for details.';

        $('pl-sorts').innerHTML = SORTS.map(([k, label]) =>
            `<button class="pl-sort ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${label}${ui.sort === k && k !== 'rank' ? (ui.dir < 0 ? ' ↓' : ' ↑') : ''}</button>`).join('');

        const list = $('pl-body'), aside = $('pl-aside');
        if (!shown.length) {
            const msg = rows.length ? 'No one matches that search.'
                : (allRows.length && ui.group === 'main') ? `Nobody has played ${min} matches yet. See “All players” for everyone.`
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

    // Resize a chosen picture to a 360×450 JPEG (~30 KB): cropped to fill, keeping the upper
    // part (faces) in view. Small enough to keep on the device and in the database.
    async function shrinkPhoto(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const W = 360, H = 450, scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
            const sw = W / scale, sh = H / scale;
            const sx = (img.naturalWidth - sw) / 2, sy = Math.max(0, (img.naturalHeight - sh) * 0.3);
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
            return c.toDataURL('image/jpeg', 0.82);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    let photoTarget = null;
    function photoAction(kind) {
        const sel = currentRows.find(r => r.key === ui.open);
        if (!sel) return;
        if (kind === 'remove') {
            if (confirm(`Remove ${sel.name}'s photo?`)) { CloudSync.setPhoto(sel.kind, sel.key, null); render(); }
            return;
        }
        photoTarget = sel;
        $('pl-photo-input').value = '';
        $('pl-photo-input').click();
    }
    let currentRows = [];

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
            if (e.target.closest('[data-close]')) { ui.open = null; if (!wide.matches) render(); return; }
            if (e.target.closest('.pl-detail')) return;
            const card = e.target.closest('.pl-card');
            if (card) toggle(card);
        };
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
                const data = await shrinkPhoto(file);
                CloudSync.setPhoto(photoTarget.kind, photoTarget.key, data);
            } catch (err) {
                alert('That picture could not be opened. Try a JPEG or PNG photo.');
            }
            photoTarget = null;
            render();
        });
        wide.addEventListener('change', render);
        window.addEventListener('padel:data-changed', render);
    }

    init();
    return { render };
})();
