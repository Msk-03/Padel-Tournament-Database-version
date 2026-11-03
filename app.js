/* Padel Tournament Center – engine (logic unchanged; colours tuned for the light theme).
   Saving and loading lives in cloud.js (this device + online database). */

    // POINTS: exact values are stored and used for every calculation and for ranking
    // (e.g. 14.8, then + 0.5 = 15.3). Only the screen shows whole numbers, rounded to the
    // nearest (14.8 → 15, 15.3 → 15). exactPts keeps 4 decimal places so floating-point noise
    // like 22.999999999999996 never builds up.
    const exactPts = n => Math.round((Number(n) || 0) * 10000) / 10000;
    // Whole number for display, rounded to nearest (halves round away from zero: 6.5 → 7, -6.5 → -7).
    const showPts = n => { const v = exactPts(n); return Math.sign(v) * Math.round(Math.abs(v) + 1e-9) || 0; };
    const fmtPts = n => String(showPts(n));
    // Table cell: whole number, with the exact value on hover.
    const ptsCell = n => `<span title="Exact: ${exactPts(n)}">${fmtPts(n)}</span>`;
    // Difference shown as (shown won − shown lost) so the columns always add up on screen.
    const shownDiff = (won, lost) => showPts(won) - showPts(lost);

    let participants = [];
    let currentRound = 1;
    let maxPoints = 16;
    let totalCourts = 2;
    let format = 'super-mexicano';
    let tournamentName = "";
    let tournamentDate = "";
    let tournamentId = "";
    let isTournamentFinished = false;

    let beatTheBoxPositions = {};
    let roundActiveMatches = [];
    let matchHistoryLog = [];
    let sittingOutThisRound = [];

    let partnerCountMatrix = {};
    let lastPartnerRound = {};
    let teamOpponentCount = {};
    let lastTeamOpponentRound = {};
    let fullPrecomputedSchedule = [];

    let currentlyViewingArchiveId = null;

    // Start with clean blank participant rosters
    const defaultIndividualArray = [];
    const defaultTeamArray = [];

    function getOrdinalSuffix(day) {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1:  return "st";
            case 2:  return "nd";
            case 3:  return "rd";
            default: return "th";
        }
    }

    function formatDisplayDate(dateObj) {
        const day = dateObj.getDate();
        const suffix = getOrdinalSuffix(day);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const month = months[dateObj.getMonth()];
        const year = dateObj.getFullYear();
        return `${day}${suffix} ${month} ${year}`;
    }

    function formatTitleName(fmtVal) {
        switch(fmtVal) {
            case 'super-mexicano': return 'Super Mexicano';
            case 'mexicano': return 'Mexicano';
            case 'americano': return 'Americano';
            case 'team-mexicano': return 'Team Mexicano';
            case 'team-americano': return 'Team Americano';
            case 'beat-the-box': return 'Beat the Box';
            default: return 'Padel Tournament';
        }
    }

    function updateDefaultTournamentName() {
        const dateInput = document.getElementById('tournament-date').value;
        const fmt = document.getElementById('tournament-type').value;
        
        let d;
        if (dateInput) {
            const parts = dateInput.split('-');
            d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else {
            d = new Date();
        }
        
        const formattedDate = formatDisplayDate(d);
        const formatTitle = formatTitleName(fmt);
        document.getElementById('tournament-name').value = `${formatTitle} - ${formattedDate}`;
    }

    window.addEventListener('DOMContentLoaded', () => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('tournament-date').value = `${yyyy}-${mm}-${dd}`;
        
        updateDefaultTournamentName();
        updateArchiveCountBadge();
        onFormatChange();
    });

    function onDateChange() {
        updateDefaultTournamentName();
    }

    function isTeamFormat(fmt = format) {
        return fmt === 'team-mexicano' || fmt === 'team-americano' || fmt === 'beat-the-box';
    }

    function toggleFormatBubble(e) {
        if (e) e.stopPropagation();
        const bubble = document.getElementById('format-bubble');
        const partBubble = document.getElementById('participant-bubble');
        if (partBubble) partBubble.classList.add('hidden');
        bubble.classList.toggle('hidden');
    }

    function toggleParticipantBubble(e) {
        if (e) e.stopPropagation();
        const bubble = document.getElementById('participant-bubble');
        const fmtBubble = document.getElementById('format-bubble');
        if (fmtBubble) fmtBubble.classList.add('hidden');
        bubble.classList.toggle('hidden');
    }

    document.addEventListener('click', (e) => {
        const fmtBubble = document.getElementById('format-bubble');
        const fmtIcon = document.getElementById('info-icon');
        if (fmtBubble && !fmtBubble.classList.contains('hidden')) {
            if (!fmtBubble.contains(e.target) && e.target !== fmtIcon) {
                fmtBubble.classList.add('hidden');
            }
        }

        const partBubble = document.getElementById('participant-bubble');
        const partIcon = document.getElementById('participant-info-icon');
        if (partBubble && !partBubble.classList.contains('hidden')) {
            if (!partBubble.contains(e.target) && e.target !== partIcon) {
                partBubble.classList.add('hidden');
            }
        }
    });

    function populateParticipantCountDropdown(desiredCount = null) {
        const fmt = document.getElementById('tournament-type').value;
        const courtCount = parseInt(document.getElementById('court-count').value) || 2;
        const countSelect = document.getElementById('participant-count');
        const isTeam = isTeamFormat(fmt);

        const minRequired = isTeam ? (courtCount * 2) : (courtCount * 4);
        const maxRange = isTeam ? 16 : 32;

        let currentVal = desiredCount !== null ? desiredCount : parseInt(countSelect.value);
        if (isNaN(currentVal) || currentVal < minRequired) {
            currentVal = minRequired;
        }

        let optionsHtml = '';
        for (let i = minRequired; i <= maxRange; i++) {
            const unit = isTeam ? (i === 1 ? 'Team' : 'Teams') : (i === 1 ? 'Player' : 'Players');
            const selected = (i === currentVal) ? 'selected' : '';
            optionsHtml += `<option value="${i}" ${selected}>${i} ${unit}</option>`;
        }
        countSelect.innerHTML = optionsHtml;
        return currentVal;
    }

    function getCurrentInputNames() {
        const inputs = document.querySelectorAll('.pill-input');
        const list = [];
        inputs.forEach(inp => {
            const v = inp.value.trim();
            if (v.length > 0) list.push(v);
        });
        return list;
    }

    function renderParticipantGrid(count, preserveValues = true) {
        const grid = document.getElementById('participant-grid');
        const fmt = document.getElementById('tournament-type').value;
        const isTeam = isTeamFormat(fmt);
        const existing = preserveValues ? getCurrentInputNames() : [];

        let html = '';
        for (let i = 1; i <= count; i++) {
            let val = existing[i - 1] || '';
            const placeholder = isTeam ? `Team ${i} (P1 & P2)` : `Player ${i}`;
            html += `
                <div class="participant-pill">
                    <span class="pill-badge">#${i}</span>
                    <input type="text" id="participant-pill-${i}" class="pill-input" value="${val}" placeholder="${placeholder}" onkeydown="handlePillKeydown(event, ${i})">
                </div>
            `;
        }
        grid.innerHTML = html;
    }

    function handlePillKeydown(event, index) {
        if (event.key === 'Enter') {
            event.preventDefault();
            const countSelect = document.getElementById('participant-count');
            const total = parseInt(countSelect.value);
            
            if (index < total) {
                const nextInput = document.getElementById(`participant-pill-${index + 1}`);
                if (nextInput) {
                    nextInput.focus();
                    nextInput.select();
                }
            } else {
                const maxAllowed = isTeamFormat() ? 16 : 32;
                if (total < maxAllowed) {
                    const newCount = total + 1;
                    populateParticipantCountDropdown(newCount);
                    renderParticipantGrid(newCount, true);
                    const newlyAddedInput = document.getElementById(`participant-pill-${newCount}`);
                    if (newlyAddedInput) {
                        newlyAddedInput.focus();
                        newlyAddedInput.select();
                    }
                }
            }
        }
    }

    function onParticipantCountChange() {
        const count = parseInt(document.getElementById('participant-count').value);
        renderParticipantGrid(count, true);
    }

    function onFormatChange() {
        const fmt = document.getElementById('tournament-type').value;
        const courtCount = parseInt(document.getElementById('court-count').value) || 2;
        const pLabel = document.getElementById('participant-label');
        const pHint = document.getElementById('participant-bubble-text');
        const fDesc = document.getElementById('format-bubble-text');
        const countLabel = document.getElementById('count-label');

        updateDefaultTournamentName();

        if (fmt === 'team-mexicano' || fmt === 'team-americano') {
            pLabel.innerText = "Enter Teams";
            countLabel.innerText = "Number of Teams";
            pHint.innerText = `Requires at least ${courtCount * 2} teams (2 teams per court) for ${courtCount} court(s). Enter partners in each box (e.g. 'Partner 1 & Partner 2'). Press Enter to advance.`;
            fDesc.innerText = fmt === 'team-mexicano' 
                ? "Fixed Duos: Teams stay together all tournament. Matchups seeded by leaderboard standings."
                : "Fixed Duos: Teams stay together all tournament. Full schedule generated with zero repeat matches until everyone plays each other.";
        } else if (fmt === 'beat-the-box') {
            pLabel.innerText = "Enter Teams";
            countLabel.innerText = "Number of Teams";
            pHint.innerText = `Beat the Box (King of Court): Box 1 is Top Court. Winners move UP a box, Losers move DOWN. Min ${courtCount * 2} teams for ${courtCount} court(s). Press Enter to advance.`;
            fDesc.innerText = "King of the Court ladder: Court 1 is Box 1 (Top). Winners move UP, Losers move DOWN. Finish whenever your group decides!";
        } else {
            pLabel.innerText = "Enter Player Names";
            countLabel.innerText = "Number of Players";
            pHint.innerText = `Requires at least ${courtCount * 4} individual players (${courtCount} courts × 4 players). Press Enter to advance.`;
            fDesc.innerText = fmt === 'super-mexicano'
                ? "Individual Super Mexicano: Rotating partners. Rounds 1-2 flat 1.0x; from round 3 higher courts score more (2 courts: 1.1/1.0, 3 courts: 1.2/1.1/1.0, 4 courts: 1.225/1.15/1.075/1.0 ...). One court = no multipliers."
                : (fmt === 'mexicano' 
                    ? "Individual Mexicano: Rotating partners. Seeded by rank with flat 1.0x scoring." 
                    : "Individual Americano: Rotating partners. Full rotation generated with zero partner repeats until everyone partners with each other.");
        }

        const count = populateParticipantCountDropdown();
        renderParticipantGrid(count, false);
    }

    function onCourtCountChange() {
        const fmt = document.getElementById('tournament-type').value;
        const courtCount = parseInt(document.getElementById('court-count').value) || 2;
        const pHint = document.getElementById('participant-bubble-text');
        
        if (isTeamFormat(fmt)) {
            pHint.innerText = `Requires at least ${courtCount * 2} teams (2 teams per court) for ${courtCount} court(s). Press Enter to advance.`;
        } else {
            pHint.innerText = `Requires at least ${courtCount * 4} individual players (${courtCount} courts × 4 players). Press Enter to advance.`;
        }

        const count = populateParticipantCountDropdown();
        renderParticipantGrid(count, true);
    }

    function updateArchiveCountBadge() {
        const list = getSavedTournaments();
        const badge = document.getElementById('archive-count-badge');
        if (badge) badge.innerText = list.length;
    }

    function getWinnerObject() {
        if (!participants || participants.length === 0) return null;
        let displayList = [...participants].sort((a, b) => {
            if (format === 'beat-the-box') {
                if (a.currentBox !== b.currentBox) return a.currentBox - b.currentBox;
            }
            if (b.points !== a.points) return b.points - a.points;
            const diffA = exactPts(a.points - (a.pointsLost || 0));
            const diffB = exactPts(b.points - (b.pointsLost || 0));
            if (diffB !== diffA) return diffB - diffA;
            if (b.wins !== a.wins) return b.wins - a.wins;
            return a.losses - b.losses;
        });
        return displayList[0];
    }

    function autoSaveCurrentTournament() {
        if (!tournamentId) return;
        let list = getSavedTournaments();
        const winner = getWinnerObject();

        const record = {
            id: tournamentId,
            name: tournamentName,
            date: tournamentDate,
            format: format,
            maxPoints: maxPoints,
            totalCourts: totalCourts,
            currentRound: currentRound,
            totalRoundsPlayed: currentRound > 1 ? currentRound - 1 : 0,
            winner: winner ? winner.name : "-",
            isFinished: isTournamentFinished,
            participants: participants,
            beatTheBoxPositions: beatTheBoxPositions,
            roundActiveMatches: roundActiveMatches,
            sittingOutThisRound: sittingOutThisRound,
            matchHistory: matchHistoryLog,
            fullPrecomputedSchedule: fullPrecomputedSchedule,
            partnerCountMatrix: partnerCountMatrix,
            lastPartnerRound: lastPartnerRound,
            teamOpponentCount: teamOpponentCount,
            lastTeamOpponentRound: lastTeamOpponentRound,
            updatedAt: new Date().toISOString()
        };

        const existingIdx = list.findIndex(t => t.id === tournamentId);
        if (existingIdx >= 0) {
            list[existingIdx] = record;
        } else {
            list.unshift(record);
        }

        saveTournamentsToStorage(list);
        if (window.CloudSync) CloudSync.queueSave();
    }

    function cleanParticipantName(str) {
        return str.replace(/^[#\d]+[\.\)\-\:\s]+\s*/, '').trim();
    }

    function calculateTotalAmericanoRounds() {
        const count = participants.length;
        if (format === 'team-americano' || format === 'americano') {
            return (count % 2 === 0) ? (count - 1) : count;
        }
        return 9999;
    }

    /* 1. Team Americano: Deterministic Round-Robin Circle Method (ZERO repeat matchups) */
    function buildTeamAmericanoSchedule() {
        const teams = [...participants];
        let n = teams.length;
        let tList = [...teams];
        if (n % 2 !== 0) {
            tList.push(null); // Dummy element for fair single byes
            n++;
        }

        const totalRounds = n - 1;
        let curr = [...tList];
        fullPrecomputedSchedule = [];

        for (let r = 0; r < totalRounds; r++) {
            let roundPairs = [];
            let roundByes = [];

            for (let i = 0; i < n / 2; i++) {
                let t1 = curr[i];
                let t2 = curr[n - 1 - i];
                if (!t1) { if (t2) roundByes.push(t2); }
                else if (!t2) { if (t1) roundByes.push(t1); }
                else { roundPairs.push([t1, t2]); }
            }

            let matches = [];
            for (let c = 0; c < totalCourts && c < roundPairs.length; c++) {
                matches.push({
                    courtNum: c + 1,
                    team1Id: roundPairs[c][0].id,
                    team2Id: roundPairs[c][1].id,
                    p1: roundPairs[c][0].name,
                    p2: "",
                    p3: roundPairs[c][1].name,
                    p4: ""
                });
            }

            let extraByes = [];
            for (let c = totalCourts; c < roundPairs.length; c++) {
                extraByes.push(roundPairs[c][0]);
                extraByes.push(roundPairs[c][1]);
            }

            fullPrecomputedSchedule.push({
                round: r + 1,
                matches: matches,
                byes: [...roundByes, ...extraByes]
            });

            // Circle rotation: keep index 0 fixed, rotate others
            curr = [curr[0], curr[curr.length - 1], ...curr.slice(1, curr.length - 1)];
        }
    }

    /* 2. Standard Americano: Zero-Repeat Partner Optimization across all rounds */
    function buildStandardAmericanoSchedule() {
        const N = participants.length;
        const activePerRound = Math.min(N - (N % 4), totalCourts * 4);
        const totalRounds = calculateTotalAmericanoRounds();
        const pCounts = {};
        const byeCounts = {};
        const lastBye = {};

        participants.forEach(p => {
            byeCounts[p.id] = 0;
            lastBye[p.id] = -99;
        });

        fullPrecomputedSchedule = [];

        for (let r = 1; r <= totalRounds; r++) {
            const numByes = N - activePerRound;
            let sitting = [];
            if (numByes > 0) {
                let candidates = [...participants].sort((a, b) => {
                    const aConsecutive = (lastBye[a.id] === r - 1) ? 1000 : 0;
                    const bConsecutive = (lastBye[b.id] === r - 1) ? 1000 : 0;
                    if (aConsecutive !== bConsecutive) return aConsecutive - bConsecutive;
                    return byeCounts[a.id] - byeCounts[b.id];
                });
                sitting = candidates.slice(0, numByes);
            }
            const sittingIds = new Set(sitting.map(s => s.id));
            const active = participants.filter(p => !sittingIds.has(p.id));

            let bestMatches = null;
            let bestCost = Infinity;

            for (let trial = 0; trial < 150; trial++) {
                let shuffled = [...active].sort(() => Math.random() - 0.5);
                let trialMatches = [];
                let cost = 0;

                for (let c = 0; c < activePerRound / 4; c++) {
                    let c4 = shuffled.slice(c * 4, (c + 1) * 4);
                    let opts = [
                        [c4[0], c4[1], c4[2], c4[3]],
                        [c4[0], c4[2], c4[1], c4[3]],
                        [c4[0], c4[3], c4[1], c4[2]]
                    ];

                    let bestOpt = null;
                    let bestOptCost = Infinity;

                    for (let opt of opts) {
                        let k1 = [opt[0].id, opt[1].id].sort().join('-');
                        let k2 = [opt[2].id, opt[3].id].sort().join('-');
                        let optCost = ((pCounts[k1] || 0) ** 2) * 8000 + ((pCounts[k2] || 0) ** 2) * 8000;
                        if (optCost < bestOptCost) {
                            bestOptCost = optCost;
                            bestOpt = opt;
                        }
                    }

                    trialMatches.push({
                        courtNum: c + 1,
                        p1: bestOpt[0].name,
                        p2: bestOpt[1].name,
                        p3: bestOpt[2].name,
                        p4: bestOpt[3].name,
                        ids: [bestOpt[0].id, bestOpt[1].id, bestOpt[2].id, bestOpt[3].id]
                    });
                    cost += bestOptCost;
                }

                if (cost < bestCost) {
                    bestCost = cost;
                    bestMatches = trialMatches;
                    if (cost === 0) break;
                }
            }

            bestMatches.forEach(m => {
                let k1 = [m.ids[0], m.ids[1]].sort().join('-');
                let k2 = [m.ids[2], m.ids[3]].sort().join('-');
                pCounts[k1] = (pCounts[k1] || 0) + 1;
                pCounts[k2] = (pCounts[k2] || 0) + 1;
            });

            sitting.forEach(s => {
                byeCounts[s.id] = (byeCounts[s.id] || 0) + 1;
                lastBye[s.id] = r;
            });

            fullPrecomputedSchedule.push({
                round: r,
                matches: bestMatches,
                byes: sitting
            });
        }
    }

    function startTournament() {
        const rawNames = getCurrentInputNames();
        const names = rawNames
            .map(n => cleanParticipantName(n))
            .filter(n => n.length > 0);
        
        format = document.getElementById('tournament-type').value;
        maxPoints = parseInt(document.getElementById('match-points').value);
        totalCourts = parseInt(document.getElementById('court-count').value);
        tournamentName = document.getElementById('tournament-name').value.trim() || (`${formatTitleName(format)} - ${formatDisplayDate(new Date())}`);
        tournamentDate = document.getElementById('tournament-date').value || new Date().toISOString().split('T')[0];
        tournamentId = "tourney_" + Date.now();
        isTournamentFinished = false;

        const isTeam = isTeamFormat(format);
        const minRequired = isTeam ? (totalCourts * 2) : (totalCourts * 4);

        if (names.length < minRequired) {
            const unit = isTeam ? "teams" : "players";
            alert(`Configuration requires at least ${minRequired} ${unit} for ${totalCourts} court(s)!`);
            return;
        }

        participants = names.map((name, idx) => ({ 
            id: idx,
            name: name, 
            points: 0, 
            pointsLost: 0,
            rawPoints: 0,
            rawPointsLost: 0,
            roundsPlayed: 0, 
            wins: 0,
            ties: 0,
            losses: 0,
            byeCount: 0, 
            lastByeRound: -999,
            currentBox: 0
        }));
        
        partnerCountMatrix = {};
        lastPartnerRound = {};
        teamOpponentCount = {};
        lastTeamOpponentRound = {};
        matchHistoryLog = [];
        currentRound = 1;
        beatTheBoxPositions = {};

        participants.sort(() => Math.random() - 0.5);

        if (format === 'beat-the-box') {
            participants.forEach((p, idx) => {
                const box = Math.floor(idx / 2) + 1;
                p.currentBox = Math.min(box, totalCourts + 1);
                beatTheBoxPositions[p.id] = p.currentBox;
            });
        }

        // Build exact schedules with zero repeats
        if (format === 'team-americano') {
            buildTeamAmericanoSchedule();
        } else if (format === 'americano') {
            buildStandardAmericanoSchedule();
        }

        launchTournamentScreen();
        generateRound();
        autoSaveCurrentTournament();
    }

    function launchTournamentScreen() {
        document.getElementById('active-tourney-display-title').innerText = tournamentName;
        document.getElementById('active-tourney-display-format').innerText = format.toUpperCase().replace(/-/g, ' ');
        document.getElementById('active-tourney-display-date').innerText = tournamentDate;

        document.getElementById('th-name-label').innerText = isTeamFormat() ? "Team Name" : "Player";

        const finishActionBtn = document.getElementById('btn-finish-crown-action');
        if (finishActionBtn) {
            if (format === 'americano' || format === 'team-americano') {
                finishActionBtn.classList.add('hidden');
            } else {
                finishActionBtn.classList.remove('hidden');
            }
        }

        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('vault-screen').classList.add('hidden');
        document.getElementById('archive-view-screen').classList.add('hidden');
        document.getElementById('tournament-screen').classList.remove('hidden');

        const podium = document.getElementById('leaderboard-champion-podium');
        if (isTournamentFinished) {
            displayTournamentFinishedState();
            switchTab('leaderboard');
        } else {
            if (podium) {
                podium.classList.add('hidden');
                podium.innerHTML = '';
            }
            document.getElementById('tournament-completed-banner').classList.add('hidden');
            document.getElementById('round-active-container').classList.remove('hidden');
            switchTab('active');
        }
    }

    function switchTab(tabId) {
        document.querySelectorAll('#tournament-screen .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#tournament-screen .tab-content').forEach(c => c.classList.add('hidden'));
        
        document.getElementById('tab-' + tabId).classList.add('active');
        document.getElementById('content-' + tabId).classList.remove('hidden');

        if (tabId === 'history') {
            appendHistoryView();
        }
    }

    // Super Mexicano court multipliers by number of courts in use, listed Court 1 (top) first.
    // The bottom court is always 1.0x and each court above it earns a little more; from 5 courts
    // the top court is capped at 1.3x and the steps get smaller so the spread stays fair.
    // Used from round SUPER_MEXICANO_FROM_ROUND onwards; earlier rounds are flat 1.0x while
    // players are first sorted onto courts.
    const SUPER_MEXICANO_COURT_MULTIPLIERS = {
        1: [1.0],
        2: [1.1, 1.0],
        3: [1.2, 1.1, 1.0],
        4: [1.225, 1.15, 1.075, 1.0],
        5: [1.3, 1.225, 1.15, 1.075, 1.0],
        6: [1.3, 1.24, 1.18, 1.12, 1.06, 1.0],
        7: [1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1.0],
        8: [1.3, 1.257, 1.214, 1.171, 1.129, 1.086, 1.043, 1.0]
    };
    const SUPER_MEXICANO_FROM_ROUND = 3;

    function getCourtMultiplier(courtNum, roundNum = currentRound) {
        if (format !== 'super-mexicano' || roundNum < SUPER_MEXICANO_FROM_ROUND) return 1.0;
        const row = SUPER_MEXICANO_COURT_MULTIPLIERS[totalCourts] || [1.0];
        return row[courtNum - 1] ?? 1.0;
    }

    function multiplierSummary(roundNum = currentRound) {
        const parts = [];
        for (let c = 1; c <= totalCourts; c++) parts.push(`Court ${c} = ${getCourtMultiplier(c, roundNum)}x`);
        return parts.join(' | ');
    }

    // Points scored in matches at 1.0x (no multipliers, no rest awards). Shown in the tables and
    // used only to work out rest averages; standings and the winner use the multiplied points.
    function getRawPoints(p, history = matchHistoryLog) {
        if (typeof p.rawPoints === 'number') return p.rawPoints;
        // Older saves: total points minus earlier rest awards.
        const restPts = (history || []).reduce((sum, r) =>
            sum + (r.byesApplied || []).filter(b => b.name === p.name).reduce((n, b) => n + (b.pts || 0), 0), 0);
        return Math.max(0, exactPts((p.points || 0) - restPts));
    }

    // Court a resting player/team would have been seeded on, from their current standing
    // (same order the round is seeded by: points, then difference, then wins).
    function getStandingCourt(participantId) {
        if (format === 'beat-the-box') {
            const p = participants.find(x => x.id === participantId);
            return Math.min(Math.max(1, (p && p.currentBox) || 1), totalCourts);
        }
        const ranked = [...participants].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const diffA = exactPts(a.points - a.pointsLost);
            const diffB = exactPts(b.points - b.pointsLost);
            if (diffB !== diffA) return diffB - diffA;
            return b.wins - a.wins;
        });
        const idx = ranked.findIndex(x => x.id === participantId);
        const perCourt = isTeamFormat() ? 2 : 4;
        return Math.min(Math.floor(Math.max(0, idx) / perCourt) + 1, totalCourts);
    }

    // Base score for this round: the 1.0x points scored by everyone who played it, divided by
    // the number of players who played. Each match adds both sides' scores for 2 × (side size)
    // players, so this is Σ(score1 + score2) / (2 × matches).
    function computeRoundBaseScore(scores) {
        if (!scores.length) return maxPoints / 2;
        const total = scores.reduce((n, [a, b]) => n + a + b, 0);
        return total / (2 * scores.length);
    }

    // Points a resting player/team receives, times the multiplier of the court their standing puts them on:
    //  - no matches played yet (e.g. resting in round 1): the round's base score above
    //  - exactly one match played:  (round base score + their score) / 2
    //    e.g. base 8, scored 5 → (8 + 5) / 2 = 6.5, so one low or high game doesn't decide it alone
    //  - two or more matches played: their own average 1.0x score per match
    // 1.0x scores are used so earlier multipliers and earlier rest awards don't inflate the average.
    // Pass roundBase = null to preview before the round's scores exist.
    function computeByeAward(p, roundBase = null) {
        const court = getStandingCourt(p.id);
        const mult = getCourtMultiplier(court);
        const played = p.roundsPlayed || 0;
        const own = played > 0 ? getRawPoints(p) / played : null;
        const fmtNum = n => Math.round(n * 100) / 100;
        const multTxt = mult !== 1 ? ` × ${mult} (Court ${court} standing)` : '';

        let raw, source;
        if (played >= 2) {
            raw = own;
            source = `avg ${fmtNum(own)} pts`;
        } else if (roundBase === null) {
            const pending = played === 0 ? 'round base score' : `(round base + ${fmtNum(own)}) / 2`;
            return { court, mult, base: null, awarded: null, conceded: null, note: pending + multTxt };
        } else if (played === 1) {
            raw = (roundBase + own) / 2;
            source = `(base ${fmtNum(roundBase)} + ${fmtNum(own)}) / 2 = ${fmtNum(raw)} pts`;
        } else {
            raw = roundBase;
            source = `round base ${fmtNum(raw)} pts`;
        }
        const awarded = exactPts(raw * mult);
        const conceded = exactPts(Math.max(0, maxPoints - raw) * mult);
        return { court, mult, base: fmtNum(raw), awarded, conceded, note: source + multTxt };
    }

    function varCourtColor(num) {
        const colors = [
            "var(--court1-color)", "var(--court2-color)", "var(--court3-color)", "var(--court4-color)",
            "var(--court5-color)", "var(--court6-color)", "var(--court7-color)", "var(--court8-color)"
        ];
        return colors[(num - 1) % colors.length] || "var(--court-other-color)";
    }

    function chooseBestPairingOnCourt(c4) {
        const options = [
            { p1: c4[0], p2: c4[3], p3: c4[1], p4: c4[2], optIdx: 0 },
            { p1: c4[0], p2: c4[2], p3: c4[1], p4: c4[3], optIdx: 1 },
            { p1: c4[0], p2: c4[1], p3: c4[2], p4: c4[3], optIdx: 2 }
        ];

        let scored = options.map(opt => {
            let kA = [opt.p1.name, opt.p2.name].sort().join(':::');
            let kB = [opt.p3.name, opt.p4.name].sort().join(':::');
            let penalty = ((partnerCountMatrix[kA] || 0) * 50) + ((partnerCountMatrix[kB] || 0) * 50);
            return { opt, penalty };
        });

        scored.sort((a, b) => a.penalty - b.penalty);
        return scored[0].opt;
    }

    function generateRound() {
        if (isTournamentFinished) return;

        const maxAmericanoRounds = calculateTotalAmericanoRounds();
        let americanoInfoExtra = "";
        if (format === 'americano' || format === 'team-americano') {
            americanoInfoExtra = ` (Round ${currentRound} of ${maxAmericanoRounds})`;
        }

        document.getElementById('round-title').innerText = 'Round ' + currentRound;
        
        let infoStr = "";
        if (format === 'super-mexicano' && totalCourts < 2) {
            infoStr = "Single court: no multipliers, every match counts 1.0x.";
        } else if (format === 'super-mexicano') {
            if (currentRound < SUPER_MEXICANO_FROM_ROUND) infoStr = "Round " + currentRound + ": Flat 1.0x baseline evaluation on all courts.";
            else infoStr = "Round " + currentRound + ": " + multiplierSummary();
        } else if (format === 'mexicano') {
            infoStr = "Standard Mexicano: Individual rank-seeded courts with dynamic partner shuffle.";
        } else if (format === 'americano') {
            infoStr = "Standard Americano: Social random partner rotation across all courts." + americanoInfoExtra;
        } else if (format === 'team-mexicano') {
            infoStr = "Team Mexicano: Fixed partner duos seeded onto courts strictly by team leaderboard rank.";
        } else if (format === 'team-americano') {
            infoStr = "Team Americano: Fixed partner duos matched up with balanced opponent rotation." + americanoInfoExtra;
        } else if (format === 'beat-the-box') {
            infoStr = "Beat the Box: Box 1 is the Top Court. Match winners move UP (towards Box 1), losers move DOWN!";
        }
        document.getElementById('multiplier-info').innerText = infoStr;

        const isTeam = isTeamFormat();

        // Load precomputed pairings for Americano formats (guaranteeing zero repeats)
        if ((format === 'team-americano' || format === 'americano') && fullPrecomputedSchedule.length >= currentRound) {
            const planned = fullPrecomputedSchedule[currentRound - 1];
            roundActiveMatches = planned.matches;
            sittingOutThisRound = planned.byes || [];
            renderRoundLayout();
            renderLeaderboard();
            appendHistoryView();
            return;
        }

        const activeUnitsNeeded = isTeam ? (totalCourts * 2) : (totalCourts * 4);
        const sittingCount = participants.length - activeUnitsNeeded;

        if (sittingCount <= 0) {
            sittingOutThisRound = [];
        } else {
            let eligibleToSit = participants.filter(p => p.lastByeRound !== currentRound - 1);
            if (eligibleToSit.length < sittingCount) {
                eligibleToSit = [...participants];
            }

            eligibleToSit.sort((a, b) => {
                if (a.byeCount !== b.byeCount) return a.byeCount - b.byeCount;
                if (a.roundsPlayed !== b.roundsPlayed) return b.roundsPlayed - a.roundsPlayed;
                if (a.lastByeRound !== b.lastByeRound) return a.lastByeRound - b.lastByeRound;
                return Math.random() - 0.5;
            });

            sittingOutThisRound = eligibleToSit.slice(0, sittingCount);
        }

        const sittingIds = new Set(sittingOutThisRound.map(p => p.id));
        let active = participants.filter(p => !sittingIds.has(p.id));

        roundActiveMatches = [];

        if (format === 'beat-the-box') {
            active.sort((a, b) => (a.currentBox || 1) - (b.currentBox || 1));
            
            for (let i = 0; i < totalCourts; i++) {
                const startIdx = i * 2;
                const t1 = active[startIdx];
                const t2 = active[startIdx + 1];

                roundActiveMatches.push({
                    courtNum: i + 1,
                    boxNum: i + 1,
                    team1Id: t1 ? t1.id : null,
                    team2Id: t2 ? t2.id : null,
                    p1: t1 ? t1.name : "Bye",
                    p2: "",
                    p3: t2 ? t2.name : "Bye",
                    p4: ""
                });
            }
        } else if (format === 'team-mexicano') {
            active.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                const diffA = exactPts(a.points - a.pointsLost);
                const diffB = exactPts(b.points - b.pointsLost);
                if (diffB !== diffA) return diffB - diffA;
                return b.wins - a.wins;
            });

            for (let i = 0; i < totalCourts; i++) {
                const startIdx = i * 2;
                const t1 = active[startIdx];
                const t2 = active[startIdx + 1];

                roundActiveMatches.push({
                    courtNum: i + 1,
                    team1Id: t1.id,
                    team2Id: t2.id,
                    p1: t1.name,
                    p2: "",
                    p3: t2.name,
                    p4: ""
                });
            }
        } else {
            active.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                const diffA = exactPts(a.points - a.pointsLost);
                const diffB = exactPts(b.points - b.pointsLost);
                if (diffB !== diffA) return diffB - diffA;
                return b.wins - a.wins;
            });

            for (let i = 0; i < totalCourts; i++) {
                const startIdx = i * 4;
                const c4 = active.slice(startIdx, startIdx + 4);
                const best = chooseBestPairingOnCourt(c4);

                roundActiveMatches.push({
                    courtNum: i + 1,
                    p1: best.p1.name,
                    p2: best.p2.name,
                    p3: best.p3.name,
                    p4: best.p4.name
                });
            }
        }

        renderRoundLayout();
        renderLeaderboard();
        appendHistoryView();
    }

    function renderRoundLayout() {
        const container = document.getElementById('courts-container');
        let html = '';
        const isTeam = isTeamFormat();

        roundActiveMatches.forEach((match, idx) => {
            let label = "1.0x Multiplier";
            let color = varCourtColor(match.courtNum);
            
            if (format === 'super-mexicano') {
                label = getCourtMultiplier(match.courtNum) + 'x Multiplier';
            } else if (format === 'beat-the-box') {
                label = match.courtNum === 1 ? '👑 Top Box 1' : `Box ${match.courtNum}`;
            }

            const team1Display = isTeam ? `<span><strong>${match.p1}</strong></span>` : `<span>${match.p1}</span><span>${match.p2}</span>`;
            const team2Display = isTeam ? `<span><strong>${match.p3}</strong></span>` : `<span>${match.p3}</span><span>${match.p4}</span>`;

            html += `<div class="court-block" style="border-left-color: ${color}">
                <div class="court-header">
                    <span>${format === 'beat-the-box' ? ('Box Court ' + match.courtNum) : ('Court ' + match.courtNum)}</span>
                    <span class="badge" style="background: ${color}">${label}</span>
                </div>
                <div class="match-grid">
                    <div class="team-names team-left">${team1Display}</div>
                    <div class="score-box">
                        <input type="number" id="score-${idx}-t1" class="score-input" min="0" max="${maxPoints}" oninput="syncScores(${idx}, 1)" placeholder="0">
                        <span class="vs-text">vs</span>
                        <input type="number" id="score-${idx}-t2" class="score-input" min="0" max="${maxPoints}" oninput="syncScores(${idx}, 2)" placeholder="0">
                    </div>
                    <div class="team-names team-right">${team2Display}</div>
                </div>
            </div>`;
        });

        if (sittingOutThisRound.length > 0) {
            const unit = isTeam ? "Team(s)" : "Player(s)";
            const restLines = sittingOutThisRound.map(s => {
                const p = participants.find(x => x.id === s.id) || s;
                const a = computeByeAward(p);
                return `${p.name} <small style="color:var(--text-muted)">(${a.awarded === null ? '' : '+' + a.awarded + ': '}${a.note})</small>`;
            }).join(', ');
            html += `<div class="bye-list">
                <strong>Resting This Round (${unit} on Bye):</strong> ${restLines}<br>
                <small style="color:var(--text-muted)">Guaranteed to play next round. Rest points (1.0x scores): no games yet = this round's base score (total points scored ÷ players who played); 1 game = (base score + their score) ÷ 2; 2+ games = their average. Then times the multiplier of the court their current standing puts them on.</small>
            </div>`;
        }

        container.innerHTML = html;
    }

    function syncScores(matchIdx, teamNum) {
        const t1Input = document.getElementById('score-' + matchIdx + '-t1');
        const t2Input = document.getElementById('score-' + matchIdx + '-t2');
        
        let t1Val = parseInt(t1Input.value);
        let t2Val = parseInt(t2Input.value);

        if (teamNum === 1) {
            if (isNaN(t1Val)) { t2Input.value = ''; return; }
            if (t1Val > maxPoints) { t1Val = maxPoints; t1Input.value = maxPoints; }
            if (t1Val < 0) { t1Val = 0; t1Input.value = 0; }
            t2Input.value = maxPoints - t1Val;
        } else {
            if (isNaN(t2Val)) { t1Input.value = ''; return; }
            if (t2Val > maxPoints) { t2Val = maxPoints; t2Input.value = maxPoints; }
            if (t2Val < 0) { t2Val = 0; t2Input.value = 0; }
            t1Input.value = maxPoints - t2Val;
        }
    }

    function manualFinishTournament() {
        if (confirm("End this tournament and crown the champion based on current standings?")) {
            triggerTournamentFinish(false);
        }
    }

    function triggerTournamentFinish(isAutoCompleted = false) {
        isTournamentFinished = true;
        autoSaveCurrentTournament();
        renderLeaderboard();
        displayTournamentFinishedState();
        switchTab('leaderboard');
        triggerVictoryCelebration();
    }

    function displayTournamentFinishedState() {
        document.getElementById('tournament-completed-banner').classList.remove('hidden');
        document.getElementById('round-active-container').classList.add('hidden');
        
        const winner = getWinnerObject();
        const podium = document.getElementById('leaderboard-champion-podium');
        if (winner && podium) {
            podium.classList.remove('hidden');
            const diff = shownDiff(winner.points, winner.pointsLost || 0);
            const diffSign = diff > 0 ? '+' : '';
            podium.innerHTML = `
                <div class="champion-banner">
                    <h3>🏆 TOURNAMENT CHAMPION 🏆</h3>
                    <div class="champ-name">${winner.name}</div>
                    <div class="champ-stats">${fmtPts(winner.points)} Pts Won &nbsp;|&nbsp; Diff: ${diffSign}${diff} &nbsp;|&nbsp; Matches: ${winner.wins}W - ${winner.ties}T - ${winner.losses}L</div>
                </div>
            `;
        }
    }

    function triggerVictoryCelebration() {
        const canvas = document.getElementById('confetti-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const pieces = [];
        const numPieces = 150;
        const colors = ['#f59e0b', '#1f9d55', '#3b82f6', '#ec4899', '#8b5cf6', '#ffffff'];

        for (let i = 0; i < numPieces; i++) {
            pieces.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                size: Math.random() * 8 + 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                speedY: Math.random() * 3 + 2,
                speedX: Math.random() * 2 - 1,
                rotation: Math.random() * 360,
                rotationSpeed: Math.random() * 4 - 2
            });
        }

        const startTime = Date.now();
        function drawConfetti() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            pieces.forEach(p => {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                ctx.restore();

                p.y += p.speedY;
                p.x += p.speedX;
                p.rotation += p.rotationSpeed;
            });

            if (Date.now() - startTime < 4500) {
                requestAnimationFrame(drawConfetti);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
        drawConfetti();
    }

    function submitRound() {
        for (let i = 0; i < roundActiveMatches.length; i++) {
            const t1 = parseInt(document.getElementById('score-' + i + '-t1').value);
            const t2 = parseInt(document.getElementById('score-' + i + '-t2').value);
            if (isNaN(t1) || isNaN(t2)) {
                alert("Please fully enter match scores for all active courts!");
                return;
            }
        }

        let roundLogItem = { round: currentRound, matches: [], byesApplied: [] };
        const isTeam = isTeamFormat();

        // Rest awards use standings as they were when this round was drawn, so work them out first.
        const roundScores = roundActiveMatches.map((m, i) => [
            parseInt(document.getElementById('score-' + i + '-t1').value),
            parseInt(document.getElementById('score-' + i + '-t2').value)
        ]);
        const roundBase = computeRoundBaseScore(roundScores);
        const byeAwards = sittingOutThisRound.map(s => {
            const original = participants.find(x => x.id === s.id);
            return { original, award: original ? computeByeAward(original, roundBase) : null };
        });

        roundActiveMatches.forEach((match, i) => {
            const t1 = parseInt(document.getElementById('score-' + i + '-t1').value);
            const t2 = parseInt(document.getElementById('score-' + i + '-t2').value);

            const mult = getCourtMultiplier(match.courtNum);

            const weightedT1 = exactPts(t1 * mult);
            const weightedT2 = exactPts(t2 * mult);

            let t1Outcome = 'tie';
            let t2Outcome = 'tie';
            if (t1 > t2) { t1Outcome = 'win'; t2Outcome = 'loss'; }
            else if (t2 > t1) { t1Outcome = 'loss'; t2Outcome = 'win'; }

            if (isTeam) {
                updateParticipant(match.p1, weightedT1, weightedT2, t1Outcome, t1, t2);
                updateParticipant(match.p3, weightedT2, weightedT1, t2Outcome, t2, t1);

                if (format === 'beat-the-box') {
                    const team1Obj = participants.find(x => x.id === match.team1Id);
                    const team2Obj = participants.find(x => x.id === match.team2Id);
                    const currentBox = match.boxNum || match.courtNum;

                    if (team1Obj && team2Obj) {
                        if (t1 > t2) {
                            team1Obj.currentBox = Math.max(1, currentBox - 1);
                            team2Obj.currentBox = Math.min(totalCourts, currentBox + 1);
                        } else if (t2 > t1) {
                            team2Obj.currentBox = Math.max(1, currentBox - 1);
                            team1Obj.currentBox = Math.min(totalCourts, currentBox + 1);
                        } else {
                            team1Obj.currentBox = currentBox;
                            team2Obj.currentBox = currentBox;
                        }
                        beatTheBoxPositions[team1Obj.id] = team1Obj.currentBox;
                        beatTheBoxPositions[team2Obj.id] = team2Obj.currentBox;
                    }
                }

                roundLogItem.matches.push({
                    court: match.courtNum,
                    team1: match.p1,
                    team2: match.p3,
                    score1: t1,
                    score2: t2,
                    wScore1: weightedT1,
                    wScore2: weightedT2,
                    mUsed: mult
                });
            } else {
                let kA = [match.p1, match.p2].sort().join(':::');
                let kB = [match.p3, match.p4].sort().join(':::');
                partnerCountMatrix[kA] = (partnerCountMatrix[kA] || 0) + 1;
                partnerCountMatrix[kB] = (partnerCountMatrix[kB] || 0) + 1;

                updateParticipant(match.p1, weightedT1, weightedT2, t1Outcome, t1, t2);
                updateParticipant(match.p2, weightedT1, weightedT2, t1Outcome, t1, t2);
                updateParticipant(match.p3, weightedT2, weightedT1, t2Outcome, t2, t1);
                updateParticipant(match.p4, weightedT2, weightedT1, t2Outcome, t2, t1);

                roundLogItem.matches.push({
                    court: match.courtNum,
                    team1: match.p1 + " & " + match.p2,
                    team2: match.p3 + " & " + match.p4,
                    score1: t1,
                    score2: t2,
                    wScore1: weightedT1,
                    wScore2: weightedT2,
                    mUsed: mult
                });
            }
        });

        byeAwards.forEach(({ original, award }) => {
            if (!original) return;
            original.byeCount++;
            original.lastByeRound = currentRound;
            original.points = exactPts(original.points + award.awarded);
            original.pointsLost = exactPts(original.pointsLost + award.conceded);

            roundLogItem.byesApplied.push({
                name: original.name, pts: award.awarded, calculation: award.note,
                base: award.base, court: award.court, mult: award.mult
            });
        });

        matchHistoryLog.push(roundLogItem);

        // Check if Americano formats have completed their full round-robin
        const maxAmericanoRounds = calculateTotalAmericanoRounds();
        if ((format === 'americano' || format === 'team-americano') && currentRound >= maxAmericanoRounds) {
            triggerTournamentFinish(true);
            return;
        }

        currentRound++;
        generateRound();
        autoSaveCurrentTournament();
    }

    function updateParticipant(name, ptsWon, ptsLost, outcome, rawWon = ptsWon, rawLost = ptsLost) {
        let p = participants.find(x => x.name === name);
        if (p) {
            p.points = exactPts(p.points + ptsWon);
            p.pointsLost = exactPts(p.pointsLost + ptsLost);
            p.rawPoints = (p.rawPoints || 0) + rawWon;   // unmultiplied match points, used for rest averages
            p.rawPointsLost = (p.rawPointsLost || 0) + rawLost;
            p.roundsPlayed++;
            if (outcome === 'win') p.wins++;
            else if (outcome === 'loss') p.losses++;
            else if (outcome === 'tie') p.ties++;
        }
    }

    function renderLeaderboard() {
        let displayList = [...participants].sort((a, b) => {
            if (format === 'beat-the-box') {
                if (a.currentBox !== b.currentBox) return a.currentBox - b.currentBox;
            }
            if (b.points !== a.points) return b.points - a.points;
            const diffA = exactPts(a.points - a.pointsLost);
            const diffB = exactPts(b.points - b.pointsLost);
            if (diffB !== diffA) return diffB - diffA;
            if (b.wins !== a.wins) return b.wins - a.wins;
            return a.losses - b.losses;
        });

        const tbody = document.getElementById('leaderboard-body');
        tbody.innerHTML = displayList.map((p, idx) => {
            const diff = shownDiff(p.points, p.pointsLost);
            const diffSign = diff > 0 ? '+' : '';
            const boxBadge = format === 'beat-the-box' ? `<span class="badge" style="background:#3b82f6; margin-left:6px;">Box ${p.currentBox || '-'}</span>` : '';
            
            const isCrown = isTournamentFinished && idx === 0;
            const rankBadge = isCrown ? '👑 #1' : `#${idx + 1}`;
            const rowStyle = isCrown ? 'background: rgba(245, 158, 11, 0.12);' : '';

            return `
                <tr style="${rowStyle}">
                    <td><strong>${rankBadge}</strong></td>
                    <td><strong>${p.name}</strong>${boxBadge}</td>
                    <td style="font-weight:bold; color:var(--accent);">${ptsCell(p.points)}</td>
                    <td class="raw-col" title="Points scored in matches at 1.0x. Used only for rest averages.">${fmtPts(getRawPoints(p))}</td>
                    <td style="font-weight:bold; color:#d63a5a;">${ptsCell(p.pointsLost)}</td>
                    <td style="font-weight:600; color:${diff >= 0 ? '#0e7a82' : '#d63a5a'};">${diffSign}${diff}</td>
                    <td>${p.roundsPlayed}</td>
                    <td style="color:#1f9d55; font-weight:600;">${p.wins}</td>
                    <td style="color:#b7860b; font-weight:600;">${p.ties}</td>
                    <td style="color:#d63a3a; font-weight:600;">${p.losses}</td>
                    <td style="color:var(--text-muted); font-weight:600;">${p.byeCount}</td>
                </tr>
            `;
        }).join('');
    }

    function appendHistoryView() {
        const histContainer = document.getElementById('history-container');
        if (!matchHistoryLog || matchHistoryLog.length === 0) {
            histContainer.innerHTML = '<p style="color:var(--text-muted); text-align:center; font-style:italic;">No matches played yet.</p>';
        } else {
            let html = '';
            [...matchHistoryLog].reverse().forEach(r => {
                html += `<div class="history-item">
                    <div class="history-round-title">Round ${r.round} Results</div>`;
                
                r.matches.forEach(m => {
                    html += `<div style="margin-bottom: 8px; border-bottom: 1px solid rgba(15,128,137,.18); padding-bottom: 4px;">
                        <div class="history-court-line">
                            <strong>Court ${m.court}:</strong>
                            <span>${m.team1} <strong>(${m.score1})</strong> vs <strong>(${m.score2})</strong> ${m.team2}</span>
                        </div>
                        <div class="history-points-breakdown">
                            Multiplier ${m.mUsed}x: Team 1 = +${fmtPts(m.wScore1)} | Team 2 = +${fmtPts(m.wScore2)}
                        </div>
                    </div>`;
                });

                if (r.byesApplied && r.byesApplied.length > 0) {
                    html += `<div style="margin-top: 5px; font-size: 13px; color: var(--text-muted)">
                        <strong>Rests Awarded:</strong> ${r.byesApplied.map(b => b.name + ' (+' + fmtPts(b.pts) + ' via ' + b.calculation + ')').join(', ')}
                    </div>`;
                }
                
                html += '</div>';
            });
            histContainer.innerHTML = html;
        }

        // Render upcoming rounds schedule for Americano & Team Americano
        const schedContainer = document.getElementById('upcoming-schedule-container');
        const schedList = document.getElementById('upcoming-schedule-list');
        if ((format === 'americano' || format === 'team-americano') && fullPrecomputedSchedule && fullPrecomputedSchedule.length > 0 && !isTournamentFinished) {
            schedContainer.classList.remove('hidden');
            let futureHtml = '';
            const isTeam = isTeamFormat();

            fullPrecomputedSchedule.forEach(rnd => {
                if (rnd.round >= currentRound) {
                    const isNext = rnd.round === currentRound;
                    futureHtml += `
                        <div class="history-item" style="${isNext ? 'border: 1px solid var(--accent);' : 'opacity: 0.85;'}">
                            <div class="history-round-title" style="display:flex; justify-content:space-between;">
                                <span>Round ${rnd.round} Schedule</span>
                                ${isNext ? '<span class="badge" style="background:var(--accent);">Current Round</span>' : ''}
                            </div>
                    `;
                    rnd.matches.forEach(m => {
                        const t1 = isTeam ? m.p1 : `${m.p1} & ${m.p2}`;
                        const t2 = isTeam ? m.p3 : `${m.p3} & ${m.p4}`;
                        futureHtml += `
                            <div class="history-court-line" style="padding: 3px 0;">
                                <strong>Court ${m.courtNum}:</strong>
                                <span>${t1} <span style="color:var(--text-muted); font-size:12px;">vs</span> ${t2}</span>
                            </div>
                        `;
                    });
                    if (rnd.byes && rnd.byes.length > 0) {
                        const byeNames = rnd.byes.map(b => (b ? b.name : '')).filter(n => n.length > 0).join(', ');
                        if (byeNames.length > 0) {
                            futureHtml += `<div style="margin-top: 4px; font-size: 12px; color: var(--text-muted)"><em>Sitting Out: ${byeNames}</em></div>`;
                        }
                    }
                    futureHtml += `</div>`;
                }
            });
            schedList.innerHTML = futureHtml || '<p style="color:var(--text-muted); text-align:center;">No upcoming rounds remaining.</p>';
        } else if (schedContainer) {
            schedContainer.classList.add('hidden');
        }
    }

    function finishAndSaveTournament() {
        autoSaveCurrentTournament();
        document.getElementById('tournament-screen').classList.add('hidden');
        document.getElementById('setup-screen').classList.remove('hidden');
        updateArchiveCountBadge();
    }

    function resetTournament() {
        if (confirm("Return to main menu? (The tournament will stay saved in your archives and can be resumed anytime).")) {
            autoSaveCurrentTournament();
            document.getElementById('tournament-screen').classList.add('hidden');
            document.getElementById('setup-screen').classList.remove('hidden');
            updateArchiveCountBadge();
        }
    }

    // ---------------- ARCHIVE VAULT & RESUME LOGIC ----------------
    function openVaultScreen() {
        document.getElementById('setup-screen').classList.add('hidden');
        document.getElementById('archive-view-screen').classList.add('hidden');
        document.getElementById('vault-screen').classList.remove('hidden');
        renderSavedTournamentsList();
    }

    function closeVaultScreen() {
        document.getElementById('vault-screen').classList.add('hidden');
        document.getElementById('setup-screen').classList.remove('hidden');
        updateArchiveCountBadge();
    }

    function renderSavedTournamentsList() {
        const list = getSavedTournaments();
        const container = document.getElementById('saved-tournaments-list');

        if (list.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:30px 0;">No tournaments saved yet. Run a tournament and it will automatically be stored here.</p>';
            return;
        }

        container.innerHTML = list.map((t, idx) => {
            const roundsPlayed = t.totalRoundsPlayed !== undefined ? t.totalRoundsPlayed : (t.totalRounds || 0);
            const currentRnd = t.currentRound || (roundsPlayed + 1);
            const unit = isTeamFormat(t.format) ? "Teams" : "Players";
            const statusBadge = t.isFinished ? `<span class="badge" style="background:#1f9d55;">Completed</span>` : `<span class="badge-status">Rd ${currentRnd}</span>`;
            return `
                <div class="archive-card">
                    <div class="archive-info">
                        <h4>${t.name} ${statusBadge} <span class="badge-winner">Winner: ${t.winner || 'None'}</span>${t._synced ? ' <span class="badge-cloud" title="Saved in the online database">☁ Saved online</span>' : ''}</h4>
                        <div class="archive-meta">
                            📅 ${t.date} &nbsp;|&nbsp; 🎾 ${t.format.toUpperCase().replace(/-/g, ' ')} &nbsp;|&nbsp; 🏅 ${roundsPlayed} Completed Rounds &nbsp;|&nbsp; 👥 ${t.participants ? t.participants.length : (t.players ? t.players.length : 0)} ${unit} &nbsp;|&nbsp; 🏟️ ${t.totalCourts} Courts
                        </div>
                    </div>
                    <div class="archive-actions">
                        <button class="action-btn btn-resume-sm" onclick="resumeTournamentById('${t.id}')">${t.isFinished ? 'View / Reopen' : 'Resume'}</button>
                        <button class="action-btn btn-view-sm" onclick="viewTournamentDetails('${t.id}')">View</button>
                        <button class="action-btn btn-delete-sm" onclick="deleteTournamentRecord('${t.id}')">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function resumeTournamentById(id) {
        const list = getSavedTournaments();
        const t = list.find(x => x.id === id);
        if (!t) return;

        // Finished tournaments may be trimmed on this device to save space; fetch the full copy first.
        if (t._slim) {
            if (!window.CloudSync) return;
            CloudSync.loadFull(id).then(ok => ok
                ? resumeTournamentById(id)
                : alert("This tournament's full data is in the online database. Connect to the internet to reopen it."));
            return;
        }

        tournamentId = t.id;
        tournamentName = t.name;
        tournamentDate = t.date;
        format = t.format || 'super-mexicano';
        maxPoints = t.maxPoints || 16;
        totalCourts = t.totalCourts || 2;
        currentRound = t.currentRound || ((t.totalRoundsPlayed || 0) + 1);
        isTournamentFinished = !!t.isFinished;
        participants = t.participants || t.players || [];
        beatTheBoxPositions = t.beatTheBoxPositions || {};
        matchHistoryLog = t.matchHistory || [];
        fullPrecomputedSchedule = t.fullPrecomputedSchedule || [];
        partnerCountMatrix = t.partnerCountMatrix || {};
        lastPartnerRound = t.lastPartnerRound || {};
        teamOpponentCount = t.teamOpponentCount || {};
        lastTeamOpponentRound = t.lastTeamOpponentRound || {};

        // Tournaments saved before raw scores were tracked: rebuild them as points minus earlier rest awards.
        participants.forEach(p => { p.rawPoints = getRawPoints(p, matchHistoryLog); });

        launchTournamentScreen();

        if (isTournamentFinished) {
            renderLeaderboard();
            displayTournamentFinishedState();
            switchTab('leaderboard');
        } else {
            if (t.roundActiveMatches && t.roundActiveMatches.length > 0) {
                roundActiveMatches = t.roundActiveMatches;
                sittingOutThisRound = t.sittingOutThisRound || [];
                document.getElementById('round-title').innerText = 'Round ' + currentRound;
                renderRoundLayout();
                renderLeaderboard();
            } else {
                generateRound();
            }
        }

        appendHistoryView();
    }

    function deleteTournamentRecord(id) {
        const everywhere = window.CloudSync && CloudSync.hasKey();
        const msg = everywhere
            ? "Permanently delete this tournament? It will also be removed from the online database and its results from player stats."
            : "Are you sure you want to permanently delete this tournament from your archives?";
        if (!confirm(msg)) return;
        let list = getSavedTournaments();
        list = list.filter(t => t.id !== id);
        saveTournamentsToStorage(list);
        if (window.CloudSync) CloudSync.queueDelete(id);
        renderSavedTournamentsList();
    }

    function viewTournamentDetails(id) {
        const list = getSavedTournaments();
        const t = list.find(x => x.id === id);
        if (!t) return;

        currentlyViewingArchiveId = id;
        document.getElementById('vault-screen').classList.add('hidden');
        document.getElementById('archive-view-screen').classList.remove('hidden');

        document.getElementById('view-archive-title').innerText = t.name;
        const roundsPlayed = t.totalRoundsPlayed !== undefined ? t.totalRoundsPlayed : (t.totalRounds || 0);
        document.getElementById('view-archive-meta').innerText = `${t.format.toUpperCase().replace(/-/g, ' ')} | Date: ${t.date} | Target: ${t.maxPoints} pts | Courts: ${t.totalCourts} | Completed Rounds: ${roundsPlayed}`;

        let displayList = [...(t.participants || t.players || [])].sort((a, b) => {
            if (t.format === 'beat-the-box' && a.currentBox && b.currentBox && a.currentBox !== b.currentBox) {
                return a.currentBox - b.currentBox;
            }
            if (b.points !== a.points) return b.points - a.points;
            const diffA = exactPts(a.points - (a.pointsLost || 0));
            const diffB = exactPts(b.points - (b.pointsLost || 0));
            if (diffB !== diffA) return diffB - diffA;
            if (b.wins !== a.wins) return b.wins - a.wins;
            return a.losses - b.losses;
        });

        document.getElementById('view-archive-leaderboard').innerHTML = displayList.map((p, idx) => {
            const diff = shownDiff(p.points, p.pointsLost || 0);
            const diffSign = diff > 0 ? '+' : '';
            const boxBadge = t.format === 'beat-the-box' ? `<span class="badge" style="background:#3b82f6; margin-left:6px;">Box ${p.currentBox || '-'}</span>` : '';
            const isWinner = t.isFinished && idx === 0;
            return `
                <tr style="${isWinner ? 'background: rgba(245, 158, 11, 0.12);' : ''}">
                    <td><strong>${isWinner ? '👑 #1' : `#${idx + 1}`}</strong></td>
                    <td><strong>${p.name}</strong>${boxBadge}</td>
                    <td style="font-weight:bold; color:var(--accent);">${ptsCell(p.points)}</td>
                    <td class="raw-col" title="Points scored in matches at 1.0x. Used only for rest averages.">${fmtPts(getRawPoints(p, t.matchHistory))}</td>
                    <td style="font-weight:bold; color:#d63a5a;">${ptsCell(p.pointsLost)}</td>
                    <td style="font-weight:600; color:${diff >= 0 ? '#0e7a82' : '#d63a5a'};">${diffSign}${diff}</td>
                    <td>${p.roundsPlayed}</td>
                    <td style="color:#1f9d55; font-weight:600;">${p.wins || 0}</td>
                    <td style="color:#b7860b; font-weight:600;">${p.ties || 0}</td>
                    <td style="color:#d63a3a; font-weight:600;">${p.losses || 0}</td>
                    <td style="color:var(--text-muted); font-weight:600;">${p.byeCount || 0}</td>
                </tr>
            `;
        }).join('');

        const histContainer = document.getElementById('view-archive-history');
        if (!t.matchHistory || t.matchHistory.length === 0) {
            histContainer.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No match logs recorded.</p>';
            return;
        }

        let html = '';
        [...t.matchHistory].reverse().forEach(r => {
            html += `<div class="history-item">
                <div class="history-round-title">Round ${r.round} Results</div>`;
            
            r.matches.forEach(m => {
                html += `<div style="margin-bottom: 8px; border-bottom: 1px solid rgba(15,128,137,.18); padding-bottom: 4px;">
                    <div class="history-court-line">
                        <strong>Court ${m.court}:</strong>
                        <span>${m.team1} <strong>(${m.score1})</strong> vs <strong>(${m.score2})</strong> ${m.team2}</span>
                    </div>
                    <div class="history-points-breakdown">
                        Multiplier ${m.mUsed}x: Team 1 = +${fmtPts(m.wScore1)} | Team 2 = +${fmtPts(m.wScore2)}
                    </div>
                </div>`;
            });

            if (r.byesApplied && r.byesApplied.length > 0) {
                html += `<div style="margin-top: 5px; font-size: 13px; color: var(--text-muted)">
                    <strong>Rests Awarded:</strong> ${r.byesApplied.map(b => b.name + ' (+' + fmtPts(b.pts) + ' via ' + b.calculation + ')').join(', ')}
                </div>`;
            }
            
            html += '</div>';
        });
        histContainer.innerHTML = html;
    }

    function resumeFromViewModal() {
        if (!currentlyViewingArchiveId) return;
        resumeTournamentById(currentlyViewingArchiveId);
    }

    function closeArchiveViewer() {
        currentlyViewingArchiveId = null;
        document.getElementById('archive-view-screen').classList.add('hidden');
        document.getElementById('vault-screen').classList.remove('hidden');
    }
