/* Players screen: career stats for every player (and fixed team) across all saved
   tournaments. Built from the tournaments on this device, which cloud.js keeps in
   step with the online database, so it also works offline. */
window.Players = (() => {
    const $ = id => document.getElementById(id);
    const TEAM_FORMATS = ['team-mexicano', 'team-americano', 'beat-the-box'];
    const ui = { kind: 'player', includeUnfinished: false, query: '', sort: 'rank', dir: 1, open: null };

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
            order.forEach((p, i) => {
                const key = keyOf(p.name || '');
                if (!key || seen.has(key)) return;
                seen.add(key);
                let rec = people.get(key);
                if (!rec) people.set(key, rec = { key, name: p.name.trim(), lastDate: '', events: [] });
                if ((t.date || '') >= rec.lastDate) { rec.lastDate = t.date || ''; rec.name = p.name.trim(); }
                rec.events.push({
                    id: t.id, tName: t.name, date: t.date || '', format: t.format, finished: !!t.isFinished,
                    rank: i + 1, field: order.length, points: p.points || 0, lost: p.pointsLost || 0,
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
                points: sum('points'), lost: sum('lost'), diff: show(sum('points')) - show(sum('lost')),
                best: fin.length ? Math.min(...fin.map(e => e.rank)) : null
            };
        });
        return { rows, kindsSeen };
    }

    const COLS = [
        ['rank', '#'], ['name', 'Name'], ['tournaments', 'Events'], ['titles', 'Titles'], ['podiums', 'Podiums'],
        ['played', 'Played'], ['wins', 'W'], ['ties', 'T'], ['losses', 'L'], ['winPct', 'Win %'],
        ['points', 'Pts won'], ['diff', 'Diff']
    ];
    // Official order for the table topper: most points, then best win %, then fewest losses,
    // then most ties, then most titles.
    function officialOrder(a, b) {
        return (b.points - a.points) ||
               (b.winPct - a.winPct) ||
               (a.losses - b.losses) ||
               (b.ties - a.ties) ||
               (b.titles - a.titles) ||
               a.name.localeCompare(b.name);
    }

    function sortRows(rows) {
        rows.sort(officialOrder).forEach((r, i) => { r.rank = i + 1; });
        const k = ui.sort, d = ui.dir;
        if (k === 'rank') return d > 0 ? rows : rows.reverse();
        return rows.sort((a, b) => {
            if (k === 'name') return d * a.name.localeCompare(b.name);
            return (a[k] !== b[k] ? d * (a[k] - b[k]) : 0) || (a.rank - b.rank);
        });
    }

    function detailHtml(r) {
        const items = r.events.map(e => `
            <li class="pl-event">
                <span class="pl-finish ${e.finished && e.rank === 1 ? 'gold' : ''}">${e.finished ? (e.rank === 1 ? '🏆 ' : '') + ordinal(e.rank) : 'Live · ' + ordinal(e.rank)}<small> of ${e.field}</small></span>
                <span class="pl-event-name"><strong>${esc(e.tName)}</strong><small>${esc(e.date)} · ${esc(fmtName(e.format))}</small></span>
                <span class="pl-event-stats">${cell(e.points)} pts · ${e.wins}W ${e.ties}T ${e.losses}L</span>
                <button class="action-btn btn-view-sm" data-open="${esc(e.id)}">View</button>
            </li>`).join('');
        return `<tr class="pl-detail"><td colspan="${COLS.length}"><ul class="pl-events">${items}</ul></td></tr>`;
    }

    function render() {
        const screen = $('players-screen');
        if (!screen || screen.classList.contains('hidden')) return;
        const { rows, kindsSeen } = compute();

        $('pl-kind').hidden = kindsSeen.size < 2;
        if (kindsSeen.size === 1 && !kindsSeen.has(ui.kind)) { ui.kind = [...kindsSeen][0]; return render(); }
        document.querySelectorAll('#pl-kind button').forEach(b => b.classList.toggle('active', b.dataset.kind === ui.kind));

        const q = keyOf(ui.query);
        const shown = sortRows(rows.filter(r => !q || r.key.includes(q)));
        $('pl-count').textContent = `${rows.length} ${ui.kind === 'team' ? 'team' : 'player'}${rows.length === 1 ? '' : 's'}`;

        $('pl-head').innerHTML = COLS.map(([k, label]) =>
            `<th><button class="pl-sort ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${label}${ui.sort === k ? (ui.dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`).join('');

        if (!shown.length) {
            const msg = rows.length ? 'No one matches that search.'
                : (ui.includeUnfinished ? 'No tournaments saved yet. Results appear here as soon as you play.'
                                        : 'No completed tournaments yet. Finish a tournament, or tick “Include unfinished”.');
            $('pl-body').innerHTML = `<tr><td colspan="${COLS.length}" class="pl-empty">${msg}</td></tr>`;
            return;
        }
        $('pl-body').innerHTML = shown.map(r => {
            const open = ui.open === r.key;
            return `<tr class="pl-row ${open ? 'open' : ''}" data-key="${esc(r.key)}" tabindex="0" aria-expanded="${open}">
                <td><strong>${r.rank === 1 ? '👑 ' : ''}${r.rank}</strong></td>
                <td><strong>${esc(r.name)}</strong></td>
                <td>${r.tournaments}</td>
                <td class="pl-titles">${r.titles ? '🏆 ' + r.titles : '0'}</td>
                <td>${r.podiums}</td>
                <td>${r.played}</td>
                <td style="color:#1f9d55;font-weight:600">${r.wins}</td>
                <td style="color:#b7860b;font-weight:600">${r.ties}</td>
                <td style="color:#d63a3a;font-weight:600">${r.losses}</td>
                <td><strong>${r.winPct.toFixed(0)}%</strong></td>
                <td style="font-weight:bold;color:var(--accent)">${cell(r.points)}</td>
                <td style="font-weight:600;color:${r.diff >= 0 ? '#0e7a82' : '#d63a5a'}">${r.diff > 0 ? '+' : ''}${r.diff}</td>
            </tr>${open ? detailHtml(r) : ''}`;
        }).join('');
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
        $('pl-unfinished').addEventListener('change', e => { ui.includeUnfinished = e.target.checked; render(); });
        $('pl-search').addEventListener('input', e => { ui.query = e.target.value; render(); });
        $('pl-head').addEventListener('click', e => {
            const b = e.target.closest('button[data-sort]');
            if (!b) return;
            const k = b.dataset.sort;
            ui.dir = ui.sort === k ? -ui.dir : (k === 'name' || k === 'rank' ? 1 : -1);
            ui.sort = k;
            render();
        });
        const toggle = row => { ui.open = ui.open === row.dataset.key ? null : row.dataset.key; render(); };
        $('pl-body').addEventListener('click', e => {
            const btn = e.target.closest('button[data-open]');
            if (btn) return openTournament(btn.dataset.open);
            const row = e.target.closest('tr.pl-row');
            if (row) toggle(row);
        });
        $('pl-body').addEventListener('keydown', e => {
            const row = e.target.closest('tr.pl-row');
            if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row); }
        });
        window.addEventListener('padel:data-changed', render);
    }

    init();
    return { render };
})();
