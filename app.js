/* Padel Tournament Center – engine (logic unchanged; colours come from the theme variables in style.css).
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
    let hybridState = null;   // Hybrid mode only: phase, last court groups, challenge progress, last partners

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
            case 'hybrid': return 'Hybrid';
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
        const nameInput = document.getElementById('tournament-name');
        // Only replace the name if it is empty or still the one we generated; a typed name is kept.
        if (!nameInput.value.trim() || nameInput.value === lastAutoTournamentName) {
            lastAutoTournamentName = `${formatTitle} - ${formattedDate}`;
            nameInput.value = lastAutoTournamentName;
        }
    }
    let lastAutoTournamentName = '';
    // Americano formats end by themselves after the full rotation; once reopened they keep going
    // (extra rounds seeded by standings) until you finish them by hand.
    let playingExtraRounds = false;
    // Score editing. Before each round is scored, the engine state is copied (roundSnapshots) so a past
    // round can be corrected: the tournament is replayed from that round with the same pairings.
    // Rounds up to editLockRound can no longer be edited (the tournament was saved and resumed more
    // than 15 minutes later, or finished). savedAt: when "Save & exit" was last pressed.
    let roundSnapshots = [];
    let editLockRound = 0;
    let savedAt = null;
    let editingRound = null;
    const EDIT_WINDOW_MS = 15 * 60 * 1000;

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
        // Hybrid: 4 or 5 players per court (the 5th rests in turn), so at most 5 per court.
        const maxRange = fmt === 'hybrid' ? courtCount * 4 + 3 : (isTeam ? 16 : 32);

        let currentVal = desiredCount !== null ? desiredCount : parseInt(countSelect.value);
        if (isNaN(currentVal) || currentVal < minRequired) {
            currentVal = minRequired;
        }
        if (currentVal > maxRange) currentVal = maxRange;

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

    // Names typed on the setup screen, by box number. Kept when the format, courts or number of
    // players change, so boxes that disappear get their names back if they reappear.
    let typedParticipantNames = [];
    function stashTypedNames() {
        document.querySelectorAll('#participant-grid .pill-input').forEach((inp, i) => { typedParticipantNames[i] = inp.value; });
    }

    function renderParticipantGrid(count, preserveValues = true) {
        const grid = document.getElementById('participant-grid');
        const fmt = document.getElementById('tournament-type').value;
        const isTeam = isTeamFormat(fmt);
        if (preserveValues) stashTypedNames(); else typedParticipantNames = [];
        const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

        let html = '';
        for (let i = 1; i <= count; i++) {
            let val = esc(typedParticipantNames[i - 1] || '');
            const placeholder = isTeam ? `Team ${i} (P1 & P2)` : `Player ${i}`;
            html += `
                <div class="participant-pill">
                    <span class="pill-badge">#${i}</span>
                    <input type="text" id="participant-pill-${i}" class="pill-input" value="${val}" placeholder="${placeholder}" onkeydown="handlePillKeydown(event, ${i})" onblur="this.value = titleCaseName(this.value)" autocapitalize="words">
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
            if (fmt === 'hybrid') {
                pHint.innerText = `Hybrid: ${courtCount * 4}–${courtCount * 4 + 3} players for ${courtCount} court(s). Extra players rest in turn (nobody rests again until everyone has rested). Press Enter to advance.`;
            }
            fDesc.innerText = fmt === 'hybrid'
                ? "Hybrid: 2 Americano rounds to build the leaderboard, then Mexicano seeding with no multipliers. You never partner the same player twice in a row. If the same players stay together in a leaderboard group for 2 rounds, everyone plays a challenge round (strongest with weakest: 1&8 vs 2&7, 3&6 vs 4&5)."
                : fmt === 'super-mexicano'
                ? "Individual Super Mexicano: Rotating partners. Rounds 1-2 flat 1.0x; from round 3 higher courts score more (2 courts: 1.1/1.0, 3 courts: 1.2/1.1/1.0, 4 courts: 1.225/1.15/1.075/1.0 ...). One court = no multipliers."
                : (fmt === 'mexicano' 
                    ? "Individual Mexicano: Rotating partners. Seeded by rank with flat 1.0x scoring." 
                    : "Individual Americano: Rotating partners. Full rotation generated with zero partner repeats until everyone partners with each other.");
        }

        const count = populateParticipantCountDropdown();
        renderParticipantGrid(count, true);
    }

    function onCourtCountChange() {
        const fmt = document.getElementById('tournament-type').value;
        const courtCount = parseInt(document.getElementById('court-count').value) || 2;
        const pHint = document.getElementById('participant-bubble-text');
        
        if (isTeamFormat(fmt)) {
            pHint.innerText = `Requires at least ${courtCount * 2} teams (2 teams per court) for ${courtCount} court(s). Press Enter to advance.`;
        } else if (fmt === 'hybrid') {
            pHint.innerText = `Hybrid: ${courtCount * 4}–${courtCount * 4 + 3} players for ${courtCount} court(s). Extra players rest in turn (nobody rests again until everyone has rested). Press Enter to advance.`;
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
            hybridState: hybridState,
            playingExtraRounds: playingExtraRounds,
            roundSnapshots: roundSnapshots,
            editLockRound: editLockRound,
            savedAt: savedAt,
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
        return titleCaseName(str.replace(/^[#\d]+[\.\)\-\:\s]+\s*/, '').trim());
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
        playingExtraRounds = false;
        roundSnapshots = []; editLockRound = 0; savedAt = null; editingRound = null;
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
        if (format === 'hybrid' && names.length > totalCourts * 4 + 3) {
            alert(`Hybrid allows up to 3 extra players: ${totalCourts * 4}–${totalCourts * 4 + 3} players for ${totalCourts} court(s).`);
            return;
        }
        if (new Set(names.map(n => n.toLowerCase())).size !== names.length) {
            alert("Every player or team needs a different name.");
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
        hybridState = format === 'hybrid' ? newHybridState() : null;

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
            if ((format === 'americano' || format === 'team-americano') && !playingExtraRounds) {
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

    // Hybrid "Actual pts": points from matches actually played (rest points never count). During a
    // challenge it stays frozen at its value from when the challenge started, so challenge pairing
    // can't be thrown off; it updates once the last challenge round is scored.
    function getActualPoints(p, state = hybridState, history = matchHistoryLog) {
        const frozen = state && state.phase === 'challenge' && state.frozenPoints;
        return frozen && frozen[p.id] !== undefined ? frozen[p.id] : getRawPoints(p, history);
    }

    // Third column of the standings tables: "Actual pts" for Hybrid, "Pts (1.0x)" for the other formats.
    function setThirdColumnHeader(fmt) {
        document.querySelectorAll('.th-raw').forEach(th => {
            if (fmt === 'hybrid') {
                th.textContent = 'Actual pts';
                th.title = 'Points from matches actually played (no rest points). Used to pair challenge rounds; frozen during a challenge and updated after its last round.';
            } else {
                th.textContent = 'Pts (1.0x)';
                th.title = 'Points scored in matches at 1.0x (no multipliers, no rest points). Only used to work out rest averages; not used for ranking.';
            }
        });
    }
    function thirdColumnCell(p, fmt, history, state) {
        if (fmt === 'hybrid') return `<td class="raw-col" title="Match points only (no rest points)">${fmtPts(getActualPoints(p, state, history))}</td>`;
        return `<td class="raw-col" title="Points scored in matches at 1.0x. Used only for rest averages.">${fmtPts(getRawPoints(p, history))}</td>`;
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

    /* ===================== HYBRID MODE =====================
       Rounds 1–2  AMERICANO MIX: random courts, new partners and (as far as possible) new
                   opponents in round 2. Builds the first leaderboard.
       Round 3+    NORMAL: rank by leaderboard; extra players (up to 3) rest by fair rotation
                   (nobody rests again until everyone else has rested; never twice in a row);
                   the rest are seeded onto courts by rank, 4 per court; on each court the most
                   balanced pairing in which nobody repeats their last partner (1&4 v 2&3,
                   1&3 v 2&4, 1&2 v 3&4).
       TRIGGER     The leaderboard is split into one group per court (extras in the lower groups:
                   10 players on 2 courts = 1–5 and 6–10). If a group keeps the same core players
                   (4 of a group of 4–5, 5 of a group of 6+) for 2 rounds in a row, the next round
                   is a CHALLENGE. Needs 2+ courts; also means 2+ normal rounds between challenges.
       ACTUAL PTS  Points from matches actually played (no rest points of any kind). Shown in the
                   Hybrid tables and used to rank players for challenge pairing.
       CHALLENGE   Pairing uses Actual pts, frozen when the challenge starts and updated only after
                   the last challenge round (round B with extra players). Top half partners
                   bottom half, strongest with weakest (1&8 v 2&7, 3&6 v 4&5); every player gets a
                   different partner and different opponents from the previous challenge round.
                   Length: at least 1 challenge round (2 with extra players, so everyone plays one);
                   after that it ends once EVERY leaderboard group has changed since the challenge
                   started (at least one player promoted into or demoted out of each court's group);
                   otherwise another one is played, up to HYBRID_MAX_CHALLENGE_ROUNDS (4).
                   Pairing never puts two strong players together, prefers strongest with weakest,
                   and avoids every teammate and opponent from earlier rounds of the same challenge.
                   Rest points: sitters in the first challenge round are paid later (the score they
                   make in the next challenge round); sitters in the second get the score they made
                   in the first. Then normal rounds resume with the full totals.
       No multipliers. Normal/Americano rest points use the usual formula. */

    const HYBRID_AMERICANO_ROUNDS = 2;
    const HYBRID_STABLE_ROUNDS_TO_TRIGGER = 2;
    const HYBRID_MAX_EXTRA_PLAYERS = 3;
    const HYBRID_MAX_CHALLENGE_ROUNDS = 4;     // safety limit (e.g. if every game is a draw, no group changes)
    const hybridChallengeLimit = () => HYBRID_MAX_CHALLENGE_ROUNDS;

    function newHybridState() {
        return {
            phase: 'normal',        // 'normal' or 'challenge': what round 3+ will be
            roundType: 'americano', // type of the round currently on court
            cores: null,            // per leaderboard group: ids still together since the baseline
            streaks: null,          // per group: rounds the core has stayed together
            snapshot: null,         // ranking by Actual pts (ids), frozen for challenge pairing
            groupsAtStart: null,    // leaderboard groups (ids) when the challenge started
            phasePartners: {},      // name -> partners in this challenge so far
            phaseOpponents: {},     // name -> opponents in this challenge so far
            challengeRound: 0,      // challenge rounds completed in this challenge phase
            challengePlayed: [],    // ids who have played a challenge match in this phase
            challengeScores: {},    // id -> [{ won, lost }] own 1.0x scores in this phase's challenge matches
            pendingRest: [],        // ids who sat the first challenge round, paid after the next one
            prevChallenge: null,    // { partners, opponents } of the most recent challenge round
            frozenPoints: null,     // id -> Actual pts (match points only) frozen at the start of a challenge
            lastPartner: {},        // name -> partner in their last match
            lastOpponents: {}       // name -> opponents in their last match
        };
    }

    function rankForSeeding(list = participants) {
        return [...list].sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const diffA = exactPts(a.points - a.pointsLost);
            const diffB = exactPts(b.points - b.pointsLost);
            if (diffB !== diffA) return diffB - diffA;
            return b.wins - a.wins;
        });
    }

    // Ranking used for challenge pairing: Actual pts (match points only), then difference, then wins.
    function rankByActual() {
        const won = p => getRawPoints(p), lost = p => (typeof p.rawPointsLost === 'number' ? p.rawPointsLost : p.pointsLost);
        return [...participants].sort((a, b) =>
            (won(b) - won(a)) || (exactPts(won(b) - lost(b)) - exactPts(won(a) - lost(a))) || (b.wins - a.wins));
    }

    // Leaderboard groups for the challenge trigger: 4 per court, extras added from the bottom group up.
    function hybridGroupSizes(n, courts) {
        const sizes = Array(courts).fill(4);
        let extra = Math.max(0, n - courts * 4), c = courts - 1;
        while (extra > 0) { sizes[c]++; extra--; c = c === 0 ? courts - 1 : c - 1; }
        return sizes;
    }
    const hybridCoreNeeded = size => (size <= 5 ? 4 : size - 1);

    function hybridGroups(rankedIds) {
        const out = [];
        let i = 0;
        hybridGroupSizes(rankedIds.length, totalCourts).forEach(size => { out.push(rankedIds.slice(i, i + size)); i += size; });
        return out;
    }

    // Who rests first: fewest rests so far; did not rest last round; rested longest ago; lowest rank.
    // In a challenge phase, players who have already played a challenge match sit first.
    function hybridRestOrder(rankIdx, challenge) {
        const played = new Set((hybridState && hybridState.challengePlayed) || []);
        return (a, b) => {
            if (challenge) {
                const pA = played.has(a.id) ? 0 : 1, pB = played.has(b.id) ? 0 : 1;
                if (pA !== pB) return pA - pB;
            }
            if ((a.byeCount || 0) !== (b.byeCount || 0)) return (a.byeCount || 0) - (b.byeCount || 0);
            const lastA = a.lastByeRound === currentRound - 1 ? 1 : 0, lastB = b.lastByeRound === currentRound - 1 ? 1 : 0;
            if (lastA !== lastB) return lastA - lastB;
            if ((a.lastByeRound ?? -999) !== (b.lastByeRound ?? -999)) return (a.lastByeRound ?? -999) - (b.lastByeRound ?? -999);
            return rankIdx.get(b.id) - rankIdx.get(a.id);
        };
    }

    function pickResters(rankIdx, challenge) {
        const count = Math.max(0, participants.length - totalCourts * 4);
        return [...participants].sort(hybridRestOrder(rankIdx, challenge)).slice(0, count);
    }

    const hybridLastPartnerRepeats = pairs => {
        const last = hybridState.lastPartner || {};
        return pairs.reduce((n, [x, y]) => n + ((last[x.name] === y.name || last[y.name] === x.name) ? 1 : 0), 0);
    };
    const hybridPairUses = pairs => pairs.reduce((n, [x, y]) => n + (partnerCountMatrix[[x.name, y.name].sort().join(':::')] || 0), 0);

    // Four players in rank order → most balanced pairing without repeating anyone's last partner.
    function chooseHybridPairing(four) {
        const [a, b, c, d] = four;
        const options = [[[a, d], [b, c]], [[a, c], [b, d]], [[a, b], [c, d]]];
        let best = null;
        options.forEach((pairs, order) => {
            const score = hybridLastPartnerRepeats(pairs) * 1000 + hybridPairUses(pairs) * 10 + order;
            if (!best || score < best.score) best = { pairs, score };
        });
        return best.pairs;
    }

    // Small deterministic random generator so a round can be rebuilt identically when tested.
    function seededRandom(seed) {
        let s = seed % 2147483647; if (s <= 0) s += 2147483646;
        return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }

    // Americano mix: try many shuffles, keep the one with no repeated partners, fewest repeated opponents,
    // and no court that lines up with a block of the standings (that would be Mexicano seeding).
    function hybridMixedMatches(active) {
        const rnd = seededRandom(currentRound * 7919 + active.length * 104729 + (tournamentId ? tournamentId.length : 0));
        const lastOpp = hybridState.lastOpponents || {};
        const byRank = rankForSeeding(active).map(p => p.id);
        const rankBlocks = new Set();
        if (matchHistoryLog.length) for (let c = 0; c + 4 <= byRank.length; c += 4) rankBlocks.add(byRank.slice(c, c + 4).sort((a, b) => a - b).join(','));
        let best = null;
        for (let attempt = 0; attempt < 3000; attempt++) {
            const order = active.slice();
            if (attempt > 0 || currentRound > 1) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
            const courts = [];
            for (let c = 0; c < totalCourts; c++) courts.push(order.slice(c * 4, c * 4 + 4));
            let score = 0;
            courts.forEach(([a, b, c, d]) => {
                score += hybridLastPartnerRepeats([[a, b], [c, d]]) * 1000 + hybridPairUses([[a, b], [c, d]]) * 50;
                if (rankBlocks.has([a.id, b.id, c.id, d.id].sort((x, y) => x - y).join(','))) score += 40;
                [[a, c], [a, d], [b, c], [b, d]].forEach(([x, y]) => { if ((lastOpp[x.name] || []).includes(y.name)) score += 10; });
            });
            if (!best || score < best.score) best = { courts, score };
            if (score === 0) break;
        }
        return best.courts.map(([a, b, c, d], i) => ({ courtNum: i + 1, p1: a.name, p2: b.name, p3: c.name, p4: d.name, mixed: true }));
    }

    // All orderings of 0..n-1 in lexicographic order (identity first). n ≤ 6 here (≤ 720).
    function permutations(n) {
        const out = [];
        (function rec(prefix, rest) {
            if (!rest.length) { out.push(prefix); return; }
            rest.forEach((x, i) => rec([...prefix, x], rest.filter((_, j) => j !== i)));
        })([], [...Array(n).keys()]);
        return out;
    }

    // All ways to split m pairs into courts (adjacent first: (0,1)(2,3) before (0,2)(1,3)).
    function courtSplits(m) {
        const out = [];
        (function rec(left, acc) {
            if (!left.length) { out.push(acc.slice()); return; }
            const [first, ...rest] = left;
            rest.forEach((other, i) => rec(rest.filter((_, j) => j !== i), [...acc, [first, other]]));
        })([...Array(m).keys()], []);
        return out;
    }

    // Challenge pairing on the frozen standings. Scores every strong+weak option and keeps the best:
    // repeats of last partner / previous challenge partner or opponents cost most, then imbalance.
    function chooseChallengeMatches(active) {
        const n = active.length, half = n / 2, ideal = n + 1;
        const rankOf = new Map(active.map((p, i) => [p.id, i + 1]));
        const strong = active.slice(0, half);
        const weakAsc = active.slice(half).reverse();      // weakest first
        const prev = hybridState.prevChallenge || { partners: {}, opponents: {} };
        const inPhase = hybridState.challengeRound > 0;
        const phaseP = inPhase ? (hybridState.phasePartners || {}) : {};
        const phaseO = inPhase ? (hybridState.phaseOpponents || {}) : {};
        const last = hybridState.lastPartner || {};
        const splits = courtSplits(half);
        const perms = [];
        if (half <= 6) perms.push(...permutations(half));
        else {
            perms.push([...Array(half).keys()]);
            const rnd = seededRandom(currentRound * 31337 + n);
            for (let k = 0; k < 4000; k++) { const p = [...Array(half).keys()]; for (let i = half - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } perms.push(p); }
        }
        let best = null;
        for (const perm of perms) {
            const pairs = strong.map((s, i) => [s, weakAsc[perm[i]]]);
            let pairScore = 0;
            pairs.forEach(([x, y]) => {
                if (last[x.name] === y.name) pairScore += 1000;
                if (prev.partners[x.name] === y.name) pairScore += 300;
                if ((phaseP[x.name] || []).includes(y.name)) pairScore += 300;   // teammate earlier in this challenge
                pairScore += Math.abs(rankOf.get(x.id) + rankOf.get(y.id) - ideal);
            });
            if (best && pairScore >= best.score) continue;
            for (const split of splits) {
                let score = pairScore;
                split.forEach(([i, j]) => {
                    const A = pairs[i], B = pairs[j];
                    A.forEach(x => B.forEach(y => {
                        if ((prev.opponents[x.name] || []).includes(y.name)) score += 100;
                        score += 60 * (phaseO[x.name] || []).filter(n => n === y.name).length;   // opponent earlier in this challenge
                    }));
                    score += Math.abs((rankOf.get(A[0].id) + rankOf.get(A[1].id)) - (rankOf.get(B[0].id) + rankOf.get(B[1].id)));
                });
                if (!best || score < best.score) best = { score, pairs, split };
            }
        }
        const courts = best.split.map(([i, j]) => [best.pairs[i], best.pairs[j]])
            .sort((c1, c2) => Math.min(...c1.flat().map(p => rankOf.get(p.id))) - Math.min(...c2.flat().map(p => rankOf.get(p.id))));
        return courts.map(([A, B], c) => {
            const [hiA, loA] = rankOf.get(A[0].id) < rankOf.get(A[1].id) ? A : [A[1], A[0]];
            const [hiB, loB] = rankOf.get(B[0].id) < rankOf.get(B[1].id) ? B : [B[1], B[0]];
            const first = rankOf.get(hiA.id) < rankOf.get(hiB.id);
            const [X, Y] = first ? [[hiA, loA], [hiB, loB]] : [[hiB, loB], [hiA, loA]];
            return { courtNum: c + 1, p1: X[0].name, p2: X[1].name, p3: Y[0].name, p4: Y[1].name, challenge: true };
        });
    }

    function buildHybridRound() {
        if (!hybridState) hybridState = newHybridState();
        const st = hybridState;
        const ranked = rankForSeeding();
        const rankIdx = new Map(ranked.map((p, i) => [p.id, i]));
        roundActiveMatches = [];
        sittingOutThisRound = [];

        if (currentRound <= HYBRID_AMERICANO_ROUNDS) {
            st.roundType = 'americano';
            // Pure Americano: the standings play no part. Rest ties are broken at random, not by rank.
            const rnd = seededRandom(currentRound * 4813 + participants.length * 7 + (tournamentId ? tournamentId.length * 131 : 0));
            const shuffled = participants.slice();
            for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
            const randomIdx = new Map(shuffled.map((p, i) => [p.id, i]));
            sittingOutThisRound = pickResters(randomIdx, false);
            const out = new Set(sittingOutThisRound.map(p => p.id));
            roundActiveMatches = hybridMixedMatches(participants.filter(p => !out.has(p.id)));
            return;
        }

        if (st.phase === 'challenge') {
            st.roundType = 'challenge';
            const frozen = new Map((st.snapshot || ranked.map(p => p.id)).map((id, i) => [id, i]));
            sittingOutThisRound = pickResters(frozen, true);
            const out = new Set(sittingOutThisRound.map(p => p.id));
            const active = participants.filter(p => !out.has(p.id)).sort((a, b) => frozen.get(a.id) - frozen.get(b.id));
            roundActiveMatches = chooseChallengeMatches(active);
            return;
        }

        st.roundType = 'normal';
        sittingOutThisRound = pickResters(rankIdx, false);
        const out = new Set(sittingOutThisRound.map(p => p.id));
        const active = ranked.filter(p => !out.has(p.id));
        for (let c = 0; c < totalCourts; c++) {
            const [A, B] = chooseHybridPairing(active.slice(c * 4, c * 4 + 4));
            roundActiveMatches.push({ courtNum: c + 1, p1: A[0].name, p2: A[1].name, p3: B[0].name, p4: B[1].name });
        }
    }

    // Rest award for someone sitting a challenge round (returns null for "paid after the next challenge round").
    function hybridChallengeRestAward(p) {
        const own = (hybridState.challengeScores || {})[p.id] || [];
        if (!own.length) return null;
        const won = own.reduce((n, s) => n + s.won, 0) / own.length;
        const lost = own.reduce((n, s) => n + s.lost, 0) / own.length;
        return { awarded: exactPts(won), conceded: exactPts(lost), note: `own challenge score ${Math.round(won * 100) / 100} pts` };
    }

    // Pay anyone still waiting (e.g. the tournament ends between the two challenge rounds):
    // they get the average score of the last challenge round.
    function hybridSettlePending(log) {
        const st = hybridState;
        if (!st || !st.pendingRest.length) return;
        const last = [...matchHistoryLog].reverse().find(r => r.type === 'challenge');
        const avg = last && last.matches.length ? last.matches.reduce((n, m) => n + m.score1 + m.score2, 0) / (2 * last.matches.length) : maxPoints / 2;
        st.pendingRest.forEach(id => {
            const p = participants.find(x => x.id === id);
            if (!p) return;
            p.points = exactPts(p.points + avg);
            p.pointsLost = exactPts(p.pointsLost + Math.max(0, maxPoints - avg));
            (log || (last && last.byesApplied) || []).push({ name: p.name, pts: exactPts(avg), calculation: 'challenge round average (no second challenge round played)' });
        });
        st.pendingRest = [];
    }

    // After a round is scored: remember partners/opponents, pay deferred challenge rests, move between phases.
    function hybridAfterRound() {
        const st = hybridState;
        if (!st) return;
        const log = matchHistoryLog[matchHistoryLog.length - 1];
        const roundPartners = {}, roundOpponents = {};
        const ownScores = {};   // id -> { won, lost } at 1.0x
        roundActiveMatches.forEach((m, i) => {
            const lm = log.matches[i];
            const sides = [[m.p1, m.p2, lm.score1, lm.score2], [m.p3, m.p4, lm.score2, lm.score1]];
            sides.forEach(([x, y, won, lost], s) => {
                const opp = s === 0 ? [m.p3, m.p4] : [m.p1, m.p2];
                [[x, y], [y, x]].forEach(([me, mate]) => {
                    st.lastPartner[me] = mate; roundPartners[me] = mate;
                    st.lastOpponents[me] = opp; roundOpponents[me] = opp;
                    const p = participants.find(q => q.name === me);
                    if (p) ownScores[p.id] = { won, lost };
                });
            });
        });

        if (st.roundType === 'challenge') {
            st.prevChallenge = { partners: roundPartners, opponents: roundOpponents };
            Object.entries(roundPartners).forEach(([me, mate]) => { (st.phasePartners[me] = st.phasePartners[me] || []).push(mate); });
            Object.entries(roundOpponents).forEach(([me, opp]) => { st.phaseOpponents[me] = [...(st.phaseOpponents[me] || []), ...opp]; });
            Object.entries(ownScores).forEach(([id, sc]) => { (st.challengeScores[id] = st.challengeScores[id] || []).push(sc); });
            st.challengePlayed = [...new Set([...st.challengePlayed, ...Object.keys(ownScores).map(Number)])];
            // Pay last challenge round's sitters with the score they just made.
            st.pendingRest = st.pendingRest.filter(id => {
                const sc = ownScores[id];
                if (!sc) return true;
                const p = participants.find(x => x.id === id);
                p.points = exactPts(p.points + sc.won);
                p.pointsLost = exactPts(p.pointsLost + sc.lost);
                log.byesApplied.push({ name: p.name, pts: sc.won, calculation: `rest in the previous challenge round, paid with own challenge score ${sc.won} pts` });
                return false;
            });
            // Sitters of this round who have no challenge score yet are paid after the next one.
            sittingOutThisRound.forEach(s => { if (!st.challengeScores[s.id] && !st.pendingRest.includes(s.id)) st.pendingRest.push(s.id); });
            st.challengeRound++;
            const everyonePlayed = participants.every(p => st.challengePlayed.includes(p.id));
            const minRounds = participants.length > totalCourts * 4 ? 2 : 1;
            const changed = hybridGroupsChanged();
            st.lastGroupsChanged = changed;
            const doneEarly = st.challengeRound >= minRounds && everyonePlayed && changed === totalCourts;
            if (doneEarly || st.challengeRound >= hybridChallengeLimit()) {
                hybridSettlePending(log.byesApplied);
                st.phase = 'normal';
                st.frozenPoints = null;              // Actual pts now include both challenge rounds' match points
                hybridResetTrigger();                // fresh baseline from the full totals
            }
            return;
        }

        if (st.roundType === 'americano') {
            if (currentRound >= HYBRID_AMERICANO_ROUNDS) hybridResetTrigger();
            return;
        }

        // Normal round: has any leaderboard group kept its core players?
        const groups = hybridGroups(rankForSeeding().map(p => p.id));
        if (!st.cores || st.cores.length !== groups.length) { hybridResetTrigger(); return; }
        let trigger = false;
        groups.forEach((g, i) => {
            const core = st.cores[i].filter(id => g.includes(id));
            if (core.length >= hybridCoreNeeded(g.length)) {
                st.cores[i] = core;
                st.streaks[i]++;
                if (st.streaks[i] >= HYBRID_STABLE_ROUNDS_TO_TRIGGER) trigger = true;
            } else {
                st.cores[i] = g.slice();
                st.streaks[i] = 0;
            }
        });
        if (trigger && totalCourts > 1) {
            st.phase = 'challenge';
            st.snapshot = rankByActual().map(p => p.id);
            st.groupsAtStart = hybridGroups(rankForSeeding().map(p => p.id));
            st.phasePartners = {};
            st.phaseOpponents = {};
            st.frozenPoints = Object.fromEntries(participants.map(p => [p.id, getRawPoints(p)]));
            st.challengeRound = 0;
            st.challengePlayed = [];
            st.challengeScores = {};
            st.pendingRest = [];
        }
    }

    // How many leaderboard groups have changed since the challenge started: a group has changed when at
    // least one of its players was promoted or demoted (someone left it and someone else came in).
    function hybridGroupsChanged() {
        const start = hybridState.groupsAtStart;
        if (!start) return 0;
        const now = hybridGroups(rankForSeeding().map(p => p.id));
        return now.filter((g, i) => !start[i] || g.some(id => !start[i].includes(id))).length;
    }

    function hybridResetTrigger() {
        const groups = hybridGroups(rankForSeeding().map(p => p.id));
        hybridState.cores = groups.map(g => g.slice());
        hybridState.streaks = groups.map(() => 0);
    }

    // One-line description of the current round shown above the courts.
    function roundInfoText(americanoInfoExtra = "") {
        let infoStr = "";
        if (format === 'hybrid') {
            const st = hybridState || {};
            if (st.roundType === 'americano') {
                return `Americano mix (round ${currentRound} of ${HYBRID_AMERICANO_ROUNDS}): mixed courts and new partners to build the first leaderboard. No multipliers.`;
            }
            if (st.roundType === 'challenge') {
                const progress = st.challengeRound > 0 ? ` So far ${st.lastGroupsChanged || 0} of ${totalCourts} groups have changed.` : '';
                return `Challenge round ${(st.challengeRound || 0) + 1}: strong players partner weak ones (strongest with weakest first), ranked by Actual pts frozen at the start of the challenge, with new teammates and opponents. Challenges continue until every court's leaderboard group has had at least one promotion or demotion.${progress}`;
            }
            return "Hybrid: courts seeded by rank, no multipliers, and nobody partners the same player twice in a row.";
        }
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
        return infoStr;
    }

    function generateRound() {
        if (isTournamentFinished) return;

        const maxAmericanoRounds = calculateTotalAmericanoRounds();
        let americanoInfoExtra = "";
        if (format === 'americano' || format === 'team-americano') {
            americanoInfoExtra = currentRound > maxAmericanoRounds ? ' (extra round, seeded by standings)' : ` (Round ${currentRound} of ${maxAmericanoRounds})`;
        }

        document.getElementById('round-title').innerText = 'Round ' + currentRound;

        // Hybrid: build the round first so the info line can say whether it is a challenge round.
        if (format === 'hybrid') {
            buildHybridRound();
            document.getElementById('multiplier-info').innerText = roundInfoText();
            renderRoundLayout();
            renderLeaderboard();
            appendHistoryView();
            return;
        }

        document.getElementById('multiplier-info').innerText = roundInfoText(americanoInfoExtra);

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
        } else if (format === 'team-mexicano' || format === 'team-americano') {
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
            } else if (format === 'hybrid') {
                label = match.challenge ? '⚡ Challenge' : (match.mixed ? 'Americano mix' : 'No multiplier');
            }

            const team1Display = isTeam ? `<span><strong>${match.p1}</strong></span>` : `<span>${match.p1}</span><span>${match.p2}</span>`;
            const team2Display = isTeam ? `<span><strong>${match.p3}</strong></span>` : `<span>${match.p3}</span><span>${match.p4}</span>`;

            const chip = (format === 'hybrid' && match.challenge) || (format === 'beat-the-box' && match.courtNum === 1) ? 'chip-lime'
                : (format === 'super-mexicano' && getCourtMultiplier(match.courtNum) > 1) ? 'chip-green' : 'chip-grey';
            html += `<div class="court-block">
                <div class="court-id"><small>${format === 'beat-the-box' ? 'BOX' : 'COURT'}</small><b>${String(match.courtNum).padStart(2, '0')}</b></div>
                <div class="match-grid">
                    <div class="team-names team-left">${team1Display}</div>
                    <div class="score-box">
                        <input type="number" id="score-${idx}-t1" class="score-input" min="0" max="${maxPoints}" oninput="syncScores(${idx}, 1)" placeholder="0">
                        <span class="vs-text">vs</span>
                        <input type="number" id="score-${idx}-t2" class="score-input" min="0" max="${maxPoints}" oninput="syncScores(${idx}, 2)" placeholder="0">
                    </div>
                    <div class="team-names team-right">${team2Display}</div>
                </div>
                <span class="badge chip court-tag ${chip}">${label}</span>
            </div>`;
        });

        if (sittingOutThisRound.length > 0) {
            const unit = isTeam ? "Team(s)" : "Player(s)";
            const restLines = sittingOutThisRound.map(s => {
                const p = participants.find(x => x.id === s.id) || s;
                const a = (format === 'hybrid' && hybridState && hybridState.roundType === 'challenge')
                    ? (hybridChallengeRestAward(p) || { awarded: null, note: 'paid after the next challenge round: own challenge score' })
                    : computeByeAward(p);
                return `${p.name} <small style="color:var(--text-muted)">(${a.awarded === null ? '' : '+' + fmtPts(a.awarded) + ': '}${a.note})</small>`;
            }).join(', ');
            html += `<div class="bye-list">
                <strong>Resting This Round (${unit} on Bye):</strong> ${restLines}<br>
                <small style="color:var(--text-muted)">Guaranteed to play next round. Rest points (1.0x scores): no games yet = this round's base score (total points scored ÷ players who played); 1 game = (base score + their score) ÷ 2; 2+ games = their average.${format === 'super-mexicano' ? ' Then times the multiplier of the court their current standing puts them on.' : ''}</small>
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
        if (format === 'hybrid') { hybridSettlePending(); if (hybridState) hybridState.frozenPoints = null; }
        isTournamentFinished = true;
        lockPlayedRounds();
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
                    <button class="btn btn-sm btn-glass" onclick="reopenTournament()"><svg><use href="#i-refresh"/></svg>Reopen &amp; keep playing</button>
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
        const roundScores = roundActiveMatches.map((m, i) => [
            parseInt(document.getElementById('score-' + i + '-t1').value),
            parseInt(document.getElementById('score-' + i + '-t2').value)
        ]);
        if (roundScores.some(([a, b]) => isNaN(a) || isNaN(b))) {
            alert("Please fully enter match scores for all active courts!");
            return;
        }
        applyRoundScores(roundScores);

        // Check if Americano formats have completed their full round-robin
        const maxAmericanoRounds = calculateTotalAmericanoRounds();
        if ((format === 'americano' || format === 'team-americano') && currentRound >= maxAmericanoRounds && !playingExtraRounds) {
            triggerTournamentFinish(true);
            return;
        }

        currentRound++;
        generateRound();
        autoSaveCurrentTournament();
    }

    // Engine state needed to replay the tournament from a given round.
    function snapshotState() {
        return JSON.parse(JSON.stringify({
            currentRound, historyLen: matchHistoryLog.length, participants, hybridState, beatTheBoxPositions,
            partnerCountMatrix, lastPartnerRound, teamOpponentCount, lastTeamOpponentRound,
            roundActiveMatches, sittingOutThisRound
        }));
    }

    // Scores the round on court (scores: [[team1, team2], ...] in court order) and logs it.
    function applyRoundScores(roundScores) {
        roundSnapshots = roundSnapshots.filter(sn => sn.currentRound < currentRound);
        roundSnapshots.push(snapshotState());
        let roundLogItem = { round: currentRound, matches: [], byesApplied: [] };
        const isTeam = isTeamFormat();

        // Rest awards use standings as they were when this round was drawn, so work them out first.
        const roundBase = computeRoundBaseScore(roundScores);
        const hybridChallenge = format === 'hybrid' && hybridState && hybridState.roundType === 'challenge';
        const byeAwards = sittingOutThisRound.map(s => {
            const original = participants.find(x => x.id === s.id);
            if (!original) return { original, award: null };
            if (hybridChallenge) {
                const a = hybridChallengeRestAward(original);
                return { original, award: a || { awarded: 0, conceded: 0, note: 'paid after the next challenge round (own challenge score)', deferred: true } };
            }
            return { original, award: computeByeAward(original, roundBase) };
        });

        roundActiveMatches.forEach((match, i) => {
            const [t1, t2] = roundScores[i];

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

        if (format === 'hybrid' && hybridState) {
            roundLogItem.type = hybridState.roundType;
        }
        matchHistoryLog.push(roundLogItem);
        if (format === 'hybrid') hybridAfterRound();
    }

    // Hybrid: make the challenge state match the type a round was actually played as (used when
    // replaying after a score edit, where the edited score could otherwise flip a challenge decision).
    function hybridConform(type) {
        const st = hybridState;
        if (!st || !type) return;
        if (type === 'challenge' && st.phase !== 'challenge') {
            st.phase = 'challenge';
            st.snapshot = rankByActual().map(p => p.id);
            st.groupsAtStart = hybridGroups(rankForSeeding().map(p => p.id));
            st.phasePartners = {}; st.phaseOpponents = {};
            st.frozenPoints = Object.fromEntries(participants.map(p => [p.id, getRawPoints(p)]));
            st.challengeRound = 0; st.challengePlayed = []; st.challengeScores = {}; st.pendingRest = [];
        } else if (type !== 'challenge' && st.phase === 'challenge') {
            hybridSettlePending();
            st.phase = 'normal';
            st.frozenPoints = null;
            hybridResetTrigger();
        }
        st.roundType = type;
    }

    const lastPlayedRound = () => matchHistoryLog.reduce((n, r) => Math.max(n, r.round || 0), 0);
    function canEditRound(round) {
        return !isTournamentFinished && round > editLockRound && roundSnapshots.some(sn => sn.currentRound === round);
    }
    // Lock every round played so far (scores can no longer be edited) and drop their snapshots.
    function lockPlayedRounds() {
        editLockRound = Math.max(editLockRound, lastPlayedRound());
        roundSnapshots = roundSnapshots.filter(sn => sn.currentRound > editLockRound);
        editingRound = null;
    }

    // Correct the scores of a round already played. The tournament is replayed from that round with
    // the same pairings and rests, so totals, rest points, multipliers and boxes all follow the new
    // scores. The round on court now keeps its pairings.
    function editRoundScores(round, newScores) {
        if (!canEditRound(round)) { alert('The scores of this round are locked.'); return false; }
        const idx = roundSnapshots.findIndex(sn => sn.currentRound === round);
        const replay = roundSnapshots.slice(idx).map(sn => JSON.parse(JSON.stringify(sn)));
        const logs = new Map(matchHistoryLog.map(r => [r.round, r]));
        const typed = roundActiveMatches.map((m, i) => ['t1', 't2'].map(t => { const el = document.getElementById(`score-${i}-${t}`); return el ? el.value : ''; }));
        const keep = { currentRound, roundActiveMatches, sittingOutThisRound, type: hybridState ? hybridState.roundType : null };

        const base = replay[0];
        participants = base.participants;
        hybridState = base.hybridState;
        beatTheBoxPositions = base.beatTheBoxPositions || {};
        partnerCountMatrix = base.partnerCountMatrix || {};
        lastPartnerRound = base.lastPartnerRound || {};
        teamOpponentCount = base.teamOpponentCount || {};
        lastTeamOpponentRound = base.lastTeamOpponentRound || {};
        matchHistoryLog = matchHistoryLog.slice(0, base.historyLen);
        roundSnapshots = roundSnapshots.slice(0, idx);

        replay.forEach(sn => {
            currentRound = sn.currentRound;
            roundActiveMatches = sn.roundActiveMatches;
            sittingOutThisRound = sn.sittingOutThisRound || [];
            if (format === 'hybrid') hybridConform(sn.hybridState && sn.hybridState.roundType);
            const log = logs.get(sn.currentRound);
            applyRoundScores(sn.currentRound === round ? newScores : log.matches.map(m => [m.score1, m.score2]));
        });

        currentRound = keep.currentRound;
        roundActiveMatches = keep.roundActiveMatches;
        sittingOutThisRound = keep.sittingOutThisRound;
        if (format === 'hybrid') hybridConform(keep.type);

        editingRound = null;
        document.getElementById('round-title').innerText = 'Round ' + currentRound;
        document.getElementById('multiplier-info').innerText = roundInfoText();
        renderRoundLayout();
        typed.forEach(([a, b], i) => {
            const e1 = document.getElementById(`score-${i}-t1`), e2 = document.getElementById(`score-${i}-t2`);
            if (e1) e1.value = a; if (e2) e2.value = b;
        });
        renderLeaderboard();
        appendHistoryView();
        autoSaveCurrentTournament();
        return true;
    }

    // Match history editor (one round at a time).
    function startEditRound(round) { if (canEditRound(round)) { editingRound = round; appendHistoryView(); } }
    function cancelEditRound() { editingRound = null; appendHistoryView(); }
    function syncEditScores(round, i, team) {
        const a = document.getElementById(`edit-${round}-${i}-t1`), b = document.getElementById(`edit-${round}-${i}-t2`);
        const src = team === 1 ? a : b, other = team === 1 ? b : a;
        let v = parseInt(src.value);
        if (isNaN(v)) { other.value = ''; return; }
        v = Math.max(0, Math.min(maxPoints, v));
        src.value = v;
        other.value = maxPoints - v;
    }
    function saveEditRound(round) {
        const log = matchHistoryLog.find(r => r.round === round);
        if (!log) return;
        const scores = log.matches.map((m, i) => [
            parseInt(document.getElementById(`edit-${round}-${i}-t1`).value),
            parseInt(document.getElementById(`edit-${round}-${i}-t2`).value)
        ]);
        if (scores.some(([a, b]) => isNaN(a) || isNaN(b))) { alert('Enter both scores for every court.'); return; }
        if (scores.every(([a, b], i) => a === log.matches[i].score1 && b === log.matches[i].score2)) { cancelEditRound(); return; }
        const later = lastPlayedRound() > round ? ` Rounds ${round + 1}–${lastPlayedRound()} keep their pairings; points, rest awards and standings are recalculated.` : '';
        if (!confirm(`Save the corrected scores for round ${round}?${later}`)) return;
        editRoundScores(round, scores);
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
        setThirdColumnHeader(format);
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
            const boxBadge = format === 'beat-the-box' ? `<span class="badge" style="background:var(--c-box); margin-left:6px;">Box ${p.currentBox || '-'}</span>` : '';
            
            const isCrown = isTournamentFinished && idx === 0;
            const rankBadge = isCrown ? '👑 #1' : `#${idx + 1}`;
            const rowStyle = isCrown ? 'background: var(--gold-row);' : '';

            return `
                <tr style="${rowStyle}">
                    <td><strong>${rankBadge}</strong></td>
                    <td><strong>${p.name}</strong>${boxBadge}</td>
                    <td style="font-weight:bold; color:var(--accent);">${ptsCell(p.points)}</td>
                    ${thirdColumnCell(p, format, matchHistoryLog, hybridState)}
                    <td style="font-weight:bold; color:var(--c-loss);">${ptsCell(p.pointsLost)}</td>
                    <td style="font-weight:600; color:${diff >= 0 ? 'var(--c-pos)' : 'var(--c-loss)'};">${diffSign}${diff}</td>
                    <td>${p.roundsPlayed}</td>
                    <td style="color:var(--c-win); font-weight:600;">${p.wins}</td>
                    <td style="color:var(--c-tie); font-weight:600;">${p.ties}</td>
                    <td style="color:var(--c-loss); font-weight:600;">${p.losses}</td>
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
            const anyLocked = matchHistoryLog.some(r => !canEditRound(r.round));
            if (!isTournamentFinished && anyLocked) {
                html += `<p class="edit-note">🔒 ${editLockRound ? `Scores up to round ${editLockRound} are locked because the tournament was saved and resumed more than 15 minutes later.` : 'Some scores are locked.'} Later rounds can still be corrected.</p>`;
            }
            [...matchHistoryLog].reverse().forEach(r => {
                const editable = canEditRound(r.round);
                const tag = editable ? `<button class="edit-round-btn" onclick="startEditRound(${r.round})">✎ Edit scores</button>` : (isTournamentFinished ? '' : '<span class="edit-lock">🔒 Locked</span>');
                html += `<div class="history-item${editingRound === r.round ? ' editing' : ''}">
                    <div class="history-round-title"><span>Round ${r.round} Results${r.type === 'challenge' ? ' · ⚡ Challenge round' : r.type === 'americano' ? ' · Americano mix' : ''}</span>${editingRound === r.round ? '' : tag}</div>`;

                if (editingRound === r.round) {
                    html += r.matches.map((m, i) => `
                        <div class="edit-line">
                            <span class="edit-court">Court ${m.court}</span>
                            <span class="edit-team">${m.team1}</span>
                            <span class="edit-scores">
                                <input type="number" class="score-input" id="edit-${r.round}-${i}-t1" min="0" max="${maxPoints}" value="${m.score1}" oninput="syncEditScores(${r.round}, ${i}, 1)" aria-label="Court ${m.court} team 1 score">
                                <input type="number" class="score-input" id="edit-${r.round}-${i}-t2" min="0" max="${maxPoints}" value="${m.score2}" oninput="syncEditScores(${r.round}, ${i}, 2)" aria-label="Court ${m.court} team 2 score">
                            </span>
                            <span class="edit-team edit-team-right">${m.team2}</span>
                        </div>`).join('') + `
                        <div class="edit-actions">
                            <button class="btn btn-secondary btn-sm" onclick="cancelEditRound()">Cancel</button>
                            <button class="btn btn-primary btn-sm" onclick="saveEditRound(${r.round})">Save scores</button>
                        </div></div>`;
                    return;
                }

                r.matches.forEach(m => {
                    html += `<div style="margin-bottom: 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px;">
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
        savedAt = new Date().toISOString();
        editingRound = null;
        autoSaveCurrentTournament();
        document.getElementById('tournament-screen').classList.add('hidden');
        document.getElementById('setup-screen').classList.remove('hidden');
        updateArchiveCountBadge();
    }

    function resetTournament() {
        if (!tournamentId) return;
        const rec = getSavedTournaments().find(t => t.id === tournamentId);
        if (window.CloudSync && !CloudSync.mayDeleteTournament(rec)) { alert(CloudSync.MASTER_ONLY + '\n\nUse "Save & exit" to leave the tournament.'); return; }
        const everywhere = window.CloudSync && CloudSync.hasKey();
        if (!confirm(`Delete "${tournamentName}"? All its rounds and scores will be removed${everywhere ? ', also from the online database and player stats' : ''}. This cannot be undone.\n\nTo keep it, press Cancel and use "Save & exit" instead.`)) return;
        const id = tournamentId;
        saveTournamentsToStorage(getSavedTournaments().filter(t => t.id !== id));
        if (window.CloudSync) CloudSync.queueDelete(id);
        tournamentId = '';
        participants = [];
        roundActiveMatches = [];
        sittingOutThisRound = [];
        matchHistoryLog = [];
        isTournamentFinished = false;
        document.getElementById('tournament-screen').classList.add('hidden');
        document.getElementById('setup-screen').classList.remove('hidden');
        updateArchiveCountBadge();
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
        const all = getSavedTournaments();
        const container = document.getElementById('saved-tournaments-list');
        const filter = window.archiveFilter || 'all';
        const list = all.filter(t => filter === 'all' || (filter === 'done' ? t.isFinished : !t.isFinished));
        const label = document.getElementById('archiveCountLabel');
        if (label) label.textContent = list.length === all.length ? `${all.length} saved` : `${list.length} of ${all.length}`;

        if (list.length === 0) {
            container.innerHTML = `<p class="empty-state">${all.length === 0
                ? 'No tournaments saved yet. Run a tournament and it will automatically be stored here.'
                : 'No tournaments match this filter.'}</p>`;
            return;
        }

        const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        container.innerHTML = list.map(t => {
            const roundsPlayed = t.totalRoundsPlayed !== undefined ? t.totalRoundsPlayed : (t.totalRounds || 0);
            const currentRnd = t.currentRound || (roundsPlayed + 1);
            const unit = isTeamFormat(t.format) ? "teams" : "players";
            const count = t.participants ? t.participants.length : (t.players ? t.players.length : 0);
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.date || '');
            const day = m ? m[3] : '--', mon = m ? MONTHS[parseInt(m[2], 10) - 1] : '';
            const isLive = !t.isFinished && !t.recorded && t.id === tournamentId && participants.length > 0;
            const statusBadge = t.recorded ? `<span class="chip chip-grey">Recorded</span>`
                : t.isFinished ? `<span class="chip chip-green">Completed</span>`
                : isLive ? `<span class="chip chip-lime">● Live · Rd ${currentRnd}</span>`
                : `<span class="badge-status">In progress · Rd ${currentRnd}</span>`;
            const fmtName = t.format.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `
                <div class="archive-card${isLive ? ' is-live' : ''}">
                    <div class="date-block"><b>${day}</b><small>${mon}</small></div>
                    <div class="archive-info">
                        <h4>${t.name}</h4>
                        <div class="archive-meta">${fmtName} · ${t.maxPoints || 16} pts · ${t.date}</div>
                        <div class="archive-chips">${statusBadge}${t.winner && t.winner !== 'None' ? `<span class="badge-winner">${t.isFinished ? '🏆 ' : 'Leader: '}${t.winner}</span>` : ''}${t._synced ? '<span class="badge-cloud" title="Saved in the online database">☁ Saved online</span>' : ''}</div>
                    </div>
                    <div class="archive-foot"><span>${count} ${unit} · ${t.totalCourts} ${t.totalCourts == 1 ? 'court' : 'courts'}</span><span>${t.recorded ? 'Final table only' : roundsPlayed + (roundsPlayed === 1 ? ' round played' : ' rounds played')}</span></div>
                    <div class="archive-actions">
                        ${t.recorded ? '' : `<button class="action-btn btn-resume-sm" onclick="resumeTournamentById('${t.id}', true)">${t.isFinished ? 'Continue playing' : 'Resume'}</button>`}
                        <button class="action-btn btn-view-sm" onclick="viewTournamentDetails('${t.id}')">View</button>
                        ${!window.CloudSync || CloudSync.mayDeleteTournament(t) ? `<button class="action-btn btn-delete-sm" onclick="deleteTournamentRecord('${t.id}')">Delete</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function resumeTournamentById(id, reopen = false) {
        const list = getSavedTournaments();
        const t = list.find(x => x.id === id);
        if (!t) return;

        // Finished tournaments may be trimmed on this device to save space; fetch the full copy first.
        if (t._slim) {
            if (!window.CloudSync) return;
            CloudSync.loadFull(id).then(ok => ok
                ? resumeTournamentById(id, reopen)
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
        hybridState = format === 'hybrid' ? { ...newHybridState(), ...(t.hybridState || {}) } : null;
        playingExtraRounds = !!t.playingExtraRounds;
        roundSnapshots = Array.isArray(t.roundSnapshots) ? t.roundSnapshots : [];
        editLockRound = t.editLockRound || 0;
        editingRound = null;
        // Scores stay editable if the tournament is resumed within 15 minutes of being saved
        // (or of its last change, if it was never explicitly saved); otherwise they are locked.
        const lastSave = Date.parse(t.savedAt || t.updatedAt || 0) || 0;
        const lockOnResume = !t.isFinished && Date.now() - lastSave > EDIT_WINDOW_MS;
        savedAt = null;

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
                document.getElementById('multiplier-info').innerText = roundInfoText();
                renderRoundLayout();
                renderLeaderboard();
            } else {
                generateRound();
            }
        }

        if (lockOnResume) { lockPlayedRounds(); autoSaveCurrentTournament(); }
        appendHistoryView();
        if (reopen && isTournamentFinished) reopenTournament();
    }

    // Finished tournaments can be reopened: the champion is cleared and play continues with the
    // next round. Finishing again crowns the leader at that point.
    function reopenTournament() {
        if (!isTournamentFinished) return;
        if (!confirm("Reopen this tournament and keep playing? Scores so far are kept, and the champion is decided again when you finish.")) return;
        isTournamentFinished = false;
        if (format === 'americano' || format === 'team-americano') playingExtraRounds = true;
        const lastPlayed = matchHistoryLog.length ? Math.max(...matchHistoryLog.map(r => r.round || 0)) : Math.max(0, currentRound - 1);
        if (lastPlayed >= currentRound || !roundActiveMatches || roundActiveMatches.length === 0) {
            currentRound = lastPlayed + 1;
            roundActiveMatches = [];
            sittingOutThisRound = [];
        }
        launchTournamentScreen();
        if (roundActiveMatches.length > 0) {
            document.getElementById('round-title').innerText = 'Round ' + currentRound;
            document.getElementById('multiplier-info').innerText = roundInfoText();
            renderRoundLayout();
            renderLeaderboard();
        } else {
            generateRound();
        }
        appendHistoryView();
        autoSaveCurrentTournament();
    }

    function deleteTournamentRecord(id) {
        const rec = getSavedTournaments().find(t => t.id === id);
        if (window.CloudSync && !CloudSync.mayDeleteTournament(rec)) { alert(CloudSync.MASTER_ONLY); return; }
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
        if (t) setThirdColumnHeader(t.format);
        if (!t) return;

        currentlyViewingArchiveId = id;
        document.getElementById('vault-screen').classList.add('hidden');
        document.getElementById('archive-view-screen').classList.remove('hidden');

        document.getElementById('view-archive-title').innerText = t.name;
        const roundsPlayed = t.totalRoundsPlayed !== undefined ? t.totalRoundsPlayed : (t.totalRounds || 0);
        document.getElementById('view-archive-meta').innerText = `${t.date} · ${t.format.toUpperCase().replace(/-/g, ' ')} · ${roundsPlayed} rounds`;

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
            const boxBadge = t.format === 'beat-the-box' ? `<span class="badge" style="background:var(--c-box); margin-left:6px;">Box ${p.currentBox || '-'}</span>` : '';
            const isWinner = t.isFinished && idx === 0;
            return `
                <tr style="${isWinner ? 'background: var(--gold-row);' : ''}">
                    <td><strong>${isWinner ? '👑 #1' : `#${idx + 1}`}</strong></td>
                    <td><strong>${p.name}</strong>${boxBadge}</td>
                    <td style="font-weight:bold; color:var(--accent);">${ptsCell(p.points)}</td>
                    ${thirdColumnCell(p, t.format, t.matchHistory, t.hybridState)}
                    <td style="font-weight:bold; color:var(--c-loss);">${ptsCell(p.pointsLost)}</td>
                    <td style="font-weight:600; color:${diff >= 0 ? 'var(--c-pos)' : 'var(--c-loss)'};">${diffSign}${diff}</td>
                    <td>${p.roundsPlayed}</td>
                    <td style="color:var(--c-win); font-weight:600;">${p.wins || 0}</td>
                    <td style="color:var(--c-tie); font-weight:600;">${p.ties || 0}</td>
                    <td style="color:var(--c-loss); font-weight:600;">${p.losses || 0}</td>
                    <td style="color:var(--text-muted); font-weight:600;">${p.byeCount || 0}</td>
                </tr>
            `;
        }).join('');

        const histContainer = document.getElementById('view-archive-history');
        if (!t.matchHistory || t.matchHistory.length === 0) {
            histContainer.innerHTML = t.historyPurgedAt
                ? '<p class="helper-text" style="text-align:center;">The match-by-match history was removed after 60 days to keep the database small. Final scores and standings are kept.</p>'
                : '<p style="color:var(--text-muted); text-align:center;">No match logs recorded.</p>';
            return;
        }

        let html = '';
        [...t.matchHistory].reverse().forEach(r => {
            html += `<div class="history-item">
                <div class="history-round-title">Round ${r.round} Results${r.type === 'challenge' ? ' · ⚡ Challenge round' : r.type === 'americano' ? ' · Americano mix' : ''}</div>`;
            
            r.matches.forEach(m => {
                html += `<div style="margin-bottom: 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px;">
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
        resumeTournamentById(currentlyViewingArchiveId, true);
    }

    function closeArchiveViewer() {
        currentlyViewingArchiveId = null;
        document.getElementById('archive-view-screen').classList.add('hidden');
        document.getElementById('vault-screen').classList.remove('hidden');
    }
