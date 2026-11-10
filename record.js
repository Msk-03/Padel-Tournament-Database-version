/* Record a past tournament: enter the details and the final table of a tournament that was
   played before the app was used (or on paper). It is saved like any other tournament, so it
   appears in the archive, syncs to the online database (on devices with the organiser key)
   and counts in Player stats. There is no match-by-match history for these. */
window.Recorder = (() => {
    const $ = id => document.getElementById(id);
    const TEAM_FORMATS = ['team-mexicano', 'team-americano', 'beat-the-box'];
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
    const whole = v => Math.floor(num(v));
    const show = n => Math.round(n * 100) / 100;
    let rows = [];   // { name, won, lost, w, t, l, lostManual }
    const maxPts = () => parseInt($('rec-points').value) || 16;

    // Points lost are worked out from points won: every match is played to the max points, so
    // lost = matches played (W + T + L) × max points − points won. Typing a value in "Pts lost"
    // yourself switches this off for that row (e.g. for Super Mexicano tables with multipliers).
    function autoLost(r) {
        if (r.lostManual) return;
        const played = whole(r.w) + whole(r.t) + whole(r.l);
        r.lost = r.won === '' || !played ? '' : String(show(Math.max(0, played * maxPts() - num(r.won))));
    }
    const diffOf = r => (r.won === '' || r.lost === '') ? '–' : (d => (d > 0 ? '+' : '') + d)(show(num(r.won) - num(r.lost)));

    const isTeam = () => TEAM_FORMATS.includes($('rec-format').value);
    const today = () => new Date().toISOString().slice(0, 10);

    function countRange() {
        const courts = parseInt($('rec-courts').value) || 1;
        const fmt = $('rec-format').value;
        const min = isTeam() ? courts * 2 : courts * 4;
        const max = fmt === 'hybrid' ? courts * 5 : (isTeam() ? 16 : 32);
        return [min, max];
    }

    function fillCount(keep) {
        const [min, max] = countRange();
        let val = keep ? parseInt($('rec-count').value) : rows.length || min;
        if (!val || val < min) val = min;
        if (val > max) val = max;
        const unit = isTeam() ? 'Teams' : 'Players';
        $('rec-count').innerHTML = Array.from({ length: max - min + 1 }, (_, i) => min + i)
            .map(n => `<option value="${n}" ${n === val ? 'selected' : ''}>${n} ${unit}</option>`).join('');
        $('rec-count-label').textContent = 'Number of ' + unit;
        resize(val);
    }

    function resize(n) {
        while (rows.length < n) rows.push({ name: '', won: '', lost: '', w: '', t: '', l: '', lostManual: false });
        rows.length = n;
        renderTable();
    }

    function renderTable() {
        const team = isTeam();
        $('rec-name-head').textContent = team ? 'Team (e.g. Ali & Omar)' : 'Player';
        $('rec-body').innerHTML = rows.map((r, i) => `
            <tr data-i="${i}">
                <td class="rec-n">${i + 1}</td>
                <td><input class="rec-in rec-name" data-f="name" value="${esc(r.name)}" placeholder="${team ? 'Team ' : 'Player '}${i + 1}" aria-label="Name ${i + 1}"></td>
                <td><input class="rec-in rec-sm" data-f="w" type="number" min="0" step="1" inputmode="numeric" value="${esc(r.w)}" aria-label="Wins ${i + 1}"></td>
                <td><input class="rec-in rec-sm" data-f="t" type="number" min="0" step="1" inputmode="numeric" value="${esc(r.t)}" aria-label="Ties ${i + 1}"></td>
                <td><input class="rec-in rec-sm" data-f="l" type="number" min="0" step="1" inputmode="numeric" value="${esc(r.l)}" aria-label="Losses ${i + 1}"></td>
                <td><input class="rec-in" data-f="won" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.won)}" aria-label="Points won ${i + 1}"></td>
                <td><input class="rec-in ${r.lostManual ? '' : 'rec-auto'}" data-f="lost" type="number" min="0" step="any" inputmode="decimal" value="${esc(r.lost)}" aria-label="Points lost ${i + 1}" title="Worked out from points won and matches played. Type to override."></td>
                <td class="rec-diff">${diffOf(r)}</td>
            </tr>`).join('');
        preview();
    }

    // Same ordering as every tournament table: average points per match, win %, difference.
    function standings() {
        return rows
            .map(r => ({ name: titleCaseName(r.name), points: num(r.won), pointsLost: num(r.lost), wins: whole(r.w), ties: whole(r.t), losses: whole(r.l), roundsPlayed: whole(r.w) + whole(r.t) + whole(r.l) }))
            .filter(r => r.name)
            .sort(standingsComparator('recorded'));
    }

    function preview() {
        const list = standings();
        if (!list.length) { $('rec-preview').innerHTML = '<p class="helper-text">The standings appear here as you fill in the table.</p>'; return; }
        $('rec-preview').innerHTML = `
            <p class="rec-winner">🏆 Winner: <strong>${esc(list[0].name)}</strong></p>
            <ol class="rec-standings">${list.map(p => `<li><span>${esc(p.name)}</span><span>${avgActual(p).toFixed(1)} avg · ${show(p.points)} pts · ${p.wins}W ${p.ties}T ${p.losses}L</span></li>`).join('')}</ol>`;
    }

    function save() {
        const name = $('rec-name').value.trim();
        const date = $('rec-date').value;
        const format = $('rec-format').value;
        const problems = [];
        if (!name) problems.push('Give the tournament a name.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push('Choose the date it was played.');
        else if (date > today()) problems.push('The date is in the future. This page is for tournaments already played.');
        rows.forEach(r => { r.name = titleCaseName(r.name); });
        const names = rows.map(r => r.name);
        if (names.some(n => !n)) problems.push(`Fill in every ${isTeam() ? 'team' : 'player'} name (or lower the number).`);
        const lower = names.filter(Boolean).map(n => n.toLowerCase());
        if (new Set(lower).size !== lower.length) problems.push('Every name must be different.');
        if (rows.some(r => r.won === '' || r.lost === '')) problems.push('Enter wins/ties/losses and points won for everyone (0 is fine), so points lost can be worked out.');
        if (problems.length) { alert(problems.join('\n')); return; }

        const list = standings();
        const participants = rows.map((r, i) => {
            const w = whole(r.w), t = whole(r.t), l = whole(r.l);
            return {
                id: i, name: r.name,
                points: num(r.won), pointsLost: num(r.lost),
                // No match history for recorded tournaments: the entered points are treated as 1.0x.
                rawPoints: num(r.won), rawPointsLost: num(r.lost),
                roundsPlayed: w + t + l, wins: w, ties: t, losses: l,
                byeCount: 0, lastByeRound: -999, currentBox: 0
            };
        });
        const rounds = Math.max(0, ...participants.map(p => p.roundsPlayed));
        const record = {
            id: 'tourney_' + Date.now(),
            name, date, format,
            maxPoints: parseInt($('rec-points').value) || 16,
            totalCourts: parseInt($('rec-courts').value) || 1,
            currentRound: rounds + 1,
            totalRoundsPlayed: rounds,
            winner: list[0] ? list[0].name : '-',
            isFinished: true,
            recorded: true,
            participants,
            matchHistory: [],
            updatedAt: new Date().toISOString()
        };

        const saved = getSavedTournaments();
        saved.unshift(record);
        saveTournamentsToStorage(saved);
        if (window.CloudSync) CloudSync.queueSave();

        const where = window.CloudSync && CloudSync.canWrite() ? 'It is being saved to the online database.' : 'It is saved on this device (enter the organiser key to save it to the online database).';
        alert(`"${name}" was added to the archive and Player stats. ${where}`);
        reset();
        const vaultBtn = document.querySelector('.nav-item[data-nav=vault]');
        if (vaultBtn) vaultBtn.click();
    }

    function reset() {
        rows = [];
        $('rec-name').value = '';
        $('rec-date').value = '';
        fillCount(false);
    }

    function defaultName() {
        if ($('rec-name').dataset.touched) return;
        const fmt = $('rec-format');
        const label = fmt.options[fmt.selectedIndex].text.split(' (')[0];
        const d = $('rec-date').value;
        $('rec-name').value = d ? `${label} - ${d}` : '';
    }

    function init() {
        $('rec-date').max = today();
        $('rec-format').addEventListener('change', () => { fillCount(true); defaultName(); });
        $('rec-courts').addEventListener('change', () => fillCount(true));
        $('rec-count').addEventListener('change', () => resize(parseInt($('rec-count').value)));
        $('rec-date').addEventListener('change', defaultName);
        $('rec-name').addEventListener('input', () => { $('rec-name').dataset.touched = '1'; });
        $('rec-body').addEventListener('input', e => {
            const input = e.target.closest('.rec-in');
            if (!input) return;
            const tr = input.closest('tr'), r = rows[+tr.dataset.i], f = input.dataset.f;
            r[f] = input.value;
            if (f === 'lost') { r.lostManual = input.value !== ''; input.classList.toggle('rec-auto', !r.lostManual); if (!r.lostManual) autoLost(r); }
            else if (f !== 'name') autoLost(r);
            const lostIn = tr.querySelector('[data-f=lost]');
            if (f !== 'lost' && lostIn.value !== r.lost) lostIn.value = r.lost;
            tr.querySelector('.rec-diff').textContent = diffOf(r);
            preview();
        });
        // Enter moves to the same column on the next row
        $('rec-body').addEventListener('focusout', e => {
            const input = e.target.closest('.rec-name');
            if (!input) return;
            input.value = titleCaseName(input.value);
            rows[+input.closest('tr').dataset.i].name = input.value;
            preview();
        });
        $('rec-points').addEventListener('change', () => { rows.forEach(autoLost); renderTable(); });
        $('rec-body').addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            const input = e.target.closest('.rec-in');
            if (!input) return;
            e.preventDefault();
            const next = $('rec-body').querySelector(`tr[data-i="${+input.closest('tr').dataset.i + 1}"] [data-f="${input.dataset.f}"]`);
            if (next) next.focus();
        });
        $('rec-save').addEventListener('click', save);
        fillCount(false);
    }

    init();
    return { open: () => { $('rec-date').max = today(); } };
})();
