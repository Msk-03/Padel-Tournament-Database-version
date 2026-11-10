/* Excel backup (master key): everything in the archive as a tidy, presentation-ready workbook.
   Sheets: Overview · Player stats · Team stats (if any) · Tournaments · Final standings · Matches. */
window.Backup = (() => {
    const TEAM_FORMATS = ['team-mexicano', 'team-americano', 'beat-the-box'];
    const fmtName = f => String(f || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
    const whole = n => Math.round(Number(n) || 0);
    const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
    const SIDE = { left: 'Left', right: 'Right', both: 'Both' };
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    function ranked(t) {
        return [...(t.participants || t.players || [])].sort((a, b) => {
            if (t.format === 'beat-the-box' && a.currentBox && b.currentBox && a.currentBox !== b.currentBox) return a.currentBox - b.currentBox;
            if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
            const dA = (a.points || 0) - (a.pointsLost || 0), dB = (b.points || 0) - (b.pointsLost || 0);
            if (dB !== dA) return dB - dA;
            if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
            return (a.losses || 0) - (b.losses || 0);
        });
    }
    const status = t => t.recorded ? 'Recorded' : t.isFinished ? 'Completed' : 'In progress';

    function careerSheet(kind, title) {
        const rows = Players.careerRows(kind);
        return {
            name: title, title: `${title} – all time`,
            subtitle: 'Completed tournaments. Ranked by win %, then titles, then points difference. Points are actual match points (no rest points or multipliers).',
            columns: [
                { header: 'Rank', width: 7, type: 'int' }, { header: kind === 'team' ? 'Team' : 'Player', width: 26 },
                ...(kind === 'team' ? [] : [{ header: 'Nickname', width: 16 }, { header: 'Side', width: 8 }]),
                { header: 'Events', width: 9, type: 'int' }, { header: 'Matches', width: 10, type: 'int' },
                { header: 'Won', width: 8, type: 'int' }, { header: 'Tied', width: 8, type: 'int' }, { header: 'Lost', width: 8, type: 'int' },
                { header: 'Win %', width: 9, type: 'pct' }, { header: 'Titles', width: 8, type: 'int' }, { header: 'Podiums', width: 10, type: 'int' },
                { header: 'Actual pts won', width: 12, type: 'int' }, { header: 'Actual pts lost', width: 12, type: 'int' }, { header: 'Diff', width: 9, type: 'int' },
                { header: 'Avg pts / match', width: 14, type: 'num1' }, { header: 'Best finish', width: 11 }, { header: 'Last played', width: 13, type: 'date' }
            ],
            rows: rows.map(r => [
                r.rank, r.name,
                ...(kind === 'team' ? [] : [r.profile && r.profile.nickname || '', r.profile && SIDE[r.profile.side] || '']),
                r.tournaments, r.played, r.wins, r.ties, r.losses, Math.round(r.winPct * 10) / 1000, r.titles, r.podiums,
                whole(r.points), whole(r.lost), r.diff, r1(r.avg), r.best ? ordinal(r.best) : '', r.lastDate || ''
            ])
        };
    }

    function build() {
        const list = getSavedTournaments().slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        const hasTeams = list.some(t => TEAM_FORMATS.includes(t.format));
        const hasPlayers = list.some(t => !TEAM_FORMATS.includes(t.format));
        const generated = new Date().toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const tournaments = {
            name: 'Tournaments', title: 'Tournaments', subtitle: `${list.length} tournaments, newest first.`,
            columns: [
                { header: 'Date', width: 13, type: 'date' }, { header: 'Tournament', width: 32 }, { header: 'Format', width: 17 },
                { header: 'Status', width: 13 }, { header: 'Courts', width: 8, type: 'int' }, { header: 'Players / teams', width: 10, type: 'int' },
                { header: 'Rounds played', width: 10, type: 'int' }, { header: 'Points per match', width: 10, type: 'int' }, { header: 'Winner', width: 24 },
                { header: 'Saved online', width: 10 }, { header: 'Match history', width: 14 }
            ],
            rows: list.map(t => [
                t.date || '', t.name, fmtName(t.format), status(t), t.totalCourts || '', (t.participants || t.players || []).length,
                t.totalRoundsPlayed !== undefined ? t.totalRoundsPlayed : (t.totalRounds || 0), t.maxPoints || '',
                t.isFinished && t.winner && t.winner !== '-' ? t.winner : '', t._synced ? 'Yes' : 'No',
                t.historyPurgedAt ? 'Removed (60 days)' : t.recorded ? 'Final table only' : 'Kept'
            ])
        };

        const standingsRows = [];
        list.forEach(t => ranked(t).forEach((p, i) => standingsRows.push([
            t.date || '', t.name, fmtName(t.format), i + 1, p.name, whole(p.points), whole(p.pointsLost),
            whole(p.points) - whole(p.pointsLost), p.roundsPlayed || 0, p.wins || 0, p.ties || 0, p.losses || 0, p.byeCount || 0
        ])));
        const standings = {
            name: 'Final standings', title: 'Final standings', subtitle: 'Every tournament’s final table (in progress tournaments: current table).',
            columns: [
                { header: 'Date', width: 13, type: 'date' }, { header: 'Tournament', width: 30 }, { header: 'Format', width: 16 },
                { header: 'Rank', width: 7, type: 'int' }, { header: 'Player / team', width: 26 }, { header: 'Points won', width: 11, type: 'int' },
                { header: 'Points lost', width: 11, type: 'int' }, { header: 'Diff', width: 8, type: 'int' }, { header: 'Played', width: 8, type: 'int' },
                { header: 'Won', width: 7, type: 'int' }, { header: 'Tied', width: 7, type: 'int' }, { header: 'Lost', width: 7, type: 'int' }, { header: 'Rests', width: 7, type: 'int' }
            ],
            rows: standingsRows
        };

        const matchRows = [];
        list.forEach(t => (t.matchHistory || []).forEach(r => (r.matches || []).forEach(m => matchRows.push([
            t.date || '', t.name, r.round, r.type === 'challenge' ? 'Challenge' : r.type === 'americano' ? 'Americano mix' : '',
            m.court, m.team1, m.score1, m.score2, m.team2, Number(m.mUsed) || 1, r1(m.wScore1), r1(m.wScore2)
        ]))));
        const matches = {
            name: 'Matches', title: 'Match results', subtitle: `${matchRows.length} matches. Tournaments older than 60 days may have had their match history removed to save space.`,
            columns: [
                { header: 'Date', width: 13, type: 'date' }, { header: 'Tournament', width: 28 }, { header: 'Round', width: 8, type: 'int' },
                { header: 'Round type', width: 14 }, { header: 'Court', width: 7, type: 'int' }, { header: 'Team 1', width: 26 },
                { header: 'Score 1', width: 8, type: 'int' }, { header: 'Score 2', width: 8, type: 'int' }, { header: 'Team 2', width: 26 },
                { header: 'Multiplier', width: 10, type: 'num1' }, { header: 'Points 1', width: 9, type: 'num1' }, { header: 'Points 2', width: 9, type: 'num1' }
            ],
            rows: matchRows
        };

        const finished = list.filter(t => t.isFinished);
        const dates = list.map(t => t.date).filter(Boolean).sort();
        const playerSheet = hasPlayers ? careerSheet('player', 'Player stats') : null;
        const teamSheet = hasTeams ? careerSheet('team', 'Team stats') : null;
        const leader = playerSheet && playerSheet.rows[0];
        const overview = {
            name: 'Overview', title: 'Padel Center – backup', subtitle: `Generated ${generated}`, autoFilter: false, freezeHeader: false, zebra: true,
            columns: [{ header: 'Summary', width: 34 }, { header: 'Value', width: 30, type: 'int' }],
            rows: [
                ['Tournaments', list.length], ['Completed', finished.length], ['In progress', list.filter(t => !t.isFinished).length],
                ['Recorded from paper', list.filter(t => t.recorded).length],
                ['Players', playerSheet ? playerSheet.rows.length : 0], ['Teams', teamSheet ? teamSheet.rows.length : 0],
                ['Matches in this file', matchRows.length],
                ['First tournament', dates[0] || '–'], ['Latest tournament', dates[dates.length - 1] || '–'],
                ['Top player (win %)', leader ? `${leader[1]} – ${Math.round(leader[9] * 100)}%` : '–'],
                ['Most titles', (() => { if (!playerSheet || !playerSheet.rows.length) return '–'; const t = playerSheet.rows.slice().sort((a, b) => b[10] - a[10])[0]; return t[10] ? `${t[1]} – ${t[10]}` : '–'; })()]
            ]
        };
        return XlsxWriter.build([overview, playerSheet, teamSheet, tournaments, standings, matches].filter(Boolean));
    }

    async function download() {
        if (!window.CloudSync || !CloudSync.isMaster()) { alert('The Excel backup needs the master key. Enter it in Online database first.'); return; }
        try { if (CloudSync.state.api === 'up') await CloudSync.syncNow(); } catch (e) {}
        const blob = build();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `PadelCenter-backup-${today()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    return { build, download };
})();
