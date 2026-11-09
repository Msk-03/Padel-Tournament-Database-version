/* Read-only standings page (view.html?t=<tournament id>). Reads the tournament from the online
   database and refreshes every 20 seconds while the page is open, so players can follow along. */
(() => {
    const $ = id => document.getElementById(id);
    const id = new URLSearchParams(location.search).get('t');
    const TEAM_FORMATS = ['team-mexicano', 'team-americano', 'beat-the-box'];
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const show = n => { const v = Math.round((Number(n) || 0) * 10000) / 10000; return Math.sign(v) * Math.round(Math.abs(v) + 1e-9) || 0; };
    const fmtName = f => String(f || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const keyOf = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
    const title = s => String(s || '').trim().replace(/(^|[\s&\-'(/])(\p{Ll})/gu, (m, a, b) => a + b.toLocaleUpperCase());
    let photos = {}, lastStamp = '', timer = null;

    function ranked(t) {
        return [...(t.participants || [])].sort((a, b) => {
            if (t.format === 'beat-the-box' && a.currentBox && b.currentBox && a.currentBox !== b.currentBox) return a.currentBox - b.currentBox;
            if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
            const dA = (a.points || 0) - (a.pointsLost || 0), dB = (b.points || 0) - (b.pointsLost || 0);
            if (dB !== dA) return dB - dA;
            if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
            return (a.losses || 0) - (b.losses || 0);
        });
    }
    function initials(name) {
        const parts = String(name).replace(/&/g, ' ').trim().split(/\s+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0] || '')[1] || '')).toUpperCase();
    }
    function hue(key) { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
    function avatar(name, kind) {
        const k = keyOf(name), ph = photos[kind + ':' + k];
        return ph ? `<span class="pl-avatar has-photo view-av"><img src="${ph}" alt=""></span>`
                  : `<span class="pl-avatar view-av" style="--h:${hue(k)}">${esc(initials(name))}</span>`;
    }

    function render(t) {
        const kind = TEAM_FORMATS.includes(t.format) ? 'team' : 'player';
        const list = ranked(t);
        const leader = list[0];
        const lastRound = (t.matchHistory || []).slice(-1)[0];
        const onCourt = !t.isFinished && (t.roundActiveMatches || []).length ? t.roundActiveMatches : [];
        const resting = !t.isFinished ? (t.sittingOutThisRound || []) : [];
        const team = TEAM_FORMATS.includes(t.format);
        const side = (a, b) => team ? esc(title(a)) : `${esc(title(a))} &amp; ${esc(title(b))}`;
        document.title = `${t.name} · standings`;
        $('view-root').innerHTML = `
        <section class="detail-card">
          <div class="spotlight view-hero">
            <div class="spot-text">
              <span class="chip chip-lime">${t.isFinished ? '🏆 COMPLETED' : `● LIVE · ROUND ${t.currentRound || 1}`}</span>
              <h1 class="view-title">${esc(t.name)}</h1>
              <p class="spot-meta"><svg><use href="#i-calendar"/></svg><span>${esc(t.date || '')}</span><span class="spot-sep">·</span><span class="fmt-chip">${esc(fmtName(t.format).toUpperCase())}</span></p>
            </div>
            ${t.isFinished && leader ? `<div class="view-champ">${avatar(leader.name, kind)}<div><small>Champion</small><b>${esc(title(leader.name))}</b></div></div>` : ''}
          </div>
          <div class="match-center">
            <h2 class="panel-title">Standings</h2>
            <div class="table-responsive"><table class="leaderboard-table view-table">
              <thead><tr><th>#</th><th>${team ? 'Team' : 'Player'}</th><th>Pts</th><th>Diff</th><th>W-T-L</th><th>Played</th></tr></thead>
              <tbody>${list.map((p, i) => {
                  const diff = show(p.points) - show(p.pointsLost || 0);
                  return `<tr class="${i === 0 ? 'view-lead' : ''}"><td><strong>${i === 0 ? '👑' : i + 1}</strong></td>
                    <td><span class="view-name">${avatar(p.name, kind)}<strong>${esc(title(p.name))}</strong></span></td>
                    <td><strong>${show(p.points)}</strong></td><td style="color:${diff >= 0 ? 'var(--c-pos)' : 'var(--c-loss)'}">${diff > 0 ? '+' : ''}${diff}</td>
                    <td>${p.wins || 0}-${p.ties || 0}-${p.losses || 0}</td><td>${p.roundsPlayed || 0}</td></tr>`;
              }).join('')}</tbody>
            </table></div>
            ${onCourt.length ? `<h2 class="panel-title gap-top">On court now · round ${t.currentRound}</h2>
              <div class="view-courts">${onCourt.map(m => `<div class="view-court"><span class="court-id"><small>COURT</small><b>${String(m.courtNum).padStart(2, '0')}</b></span>
                <span class="view-teams"><span>${side(m.p1, m.p2)}</span><em>vs</em><span>${side(m.p3, m.p4)}</span></span></div>`).join('')}</div>
              ${resting.length ? `<p class="helper-text">Resting: ${resting.map(r => esc(title(r.name))).join(', ')}</p>` : ''}` : ''}
            ${lastRound ? `<h2 class="panel-title gap-top">Last results · round ${lastRound.round}</h2>
              <div class="view-courts">${(lastRound.matches || []).map(m => `<div class="view-court"><span class="court-id"><small>COURT</small><b>${String(m.court).padStart(2, '0')}</b></span>
                <span class="view-teams"><span>${esc(title(m.team1))}</span><em class="view-score">${m.score1} – ${m.score2}</em><span>${esc(title(m.team2))}</span></span></div>`).join('')}</div>` : ''}
          </div>
        </section>`;
    }

    async function load() {
        if (!id) { $('view-root').innerHTML = '<p class="pl-empty">This link is missing the tournament. Ask the organiser for a new one.</p>'; return; }
        try {
            const res = await fetch('api/tournaments?ids=' + encodeURIComponent(id), { cache: 'no-store' });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const t = (data.tournaments || [])[0];
            if (!t) { $('view-root').innerHTML = '<p class="pl-empty">This tournament isn’t in the online database (yet). If it has just started, try again in a minute.</p>'; schedule(30000); return; }
            if (t.updatedAt !== lastStamp) { lastStamp = t.updatedAt; render(t); }
            $('view-foot').textContent = (t.isFinished ? 'Final standings.' : 'Updates automatically every 20 seconds.') + ` Last change ${new Date(t.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
            if (!t.isFinished) schedule(20000);
        } catch (e) {
            $('view-foot').textContent = 'Can’t reach the standings right now. Retrying…';
            schedule(30000);
        }
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { if (document.visibilityState === 'visible') load(); else schedule(ms); }, ms); }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

    fetch('api/photos', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
        (d && d.photos || []).forEach(p => { if (p.data) photos[p.kind + ':' + p.key] = p.data; });
        if (lastStamp) { lastStamp = ''; load(); }
    }).catch(() => {});
    load();
})();
