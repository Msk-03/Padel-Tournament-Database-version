/* App shell: navigation (sidebar + phone bottom bar), light/dark theme, page header,
   summary tiles, live/archive metrics, online-database dialog, PWA install. Engine lives in app.js. */
(() => {
  const $ = id => document.getElementById(id);
  const SCREENS = ['setup-screen', 'tournament-screen', 'vault-screen', 'archive-view-screen', 'players-screen', 'record-screen'];
  const NAV_OF = { 'setup-screen': 'setup', 'tournament-screen': 'live', 'vault-screen': 'vault', 'archive-view-screen': 'vault', 'players-screen': 'players', 'record-screen': 'record' };
  const TITLES = {
    'setup-screen': ['New tournament', 'Choose a format, courts and players'],
    'tournament-screen': ['Live tournament', 'Enter scores court by court, then submit the round'],
    'vault-screen': ['Tournaments', 'Resume, review or delete saved tournaments'],
    'archive-view-screen': ['Tournament details', 'Final standings and match log'],
    'players-screen': ['Player stats', 'Career records across every tournament'],
    'record-screen': ['Record a past tournament', 'Add an old tournament from its final table']
  };
  const icon = name => `<svg><use href="#i-${name}"/></svg>`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let lastScreen = null;

  const current = () => SCREENS.find(id => !$(id).classList.contains('hidden')) || 'setup-screen';
  const hasLive = () => typeof participants !== 'undefined' && participants.length > 0;
  const saved = () => { try { return getSavedTournaments(); } catch (e) { return []; } };
  function showScreen(id) { SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id)); }

  /* ----- light / dark theme ----- */
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('padel_theme', t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0e1d20' : '#f1f6f5';
  }
  document.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
  $('themeBtnMobile').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  /* ----- summary tiles ----- */
  function summary() {
    const list = saved();
    const done = list.filter(t => t.isFinished).length;
    const online = list.filter(t => t._synced).length;
    const live = hasLive() && !isTournamentFinished;
    const tiles = [
      ['Saved tournaments', list.length, online ? `${online} online` : 'on this device', 'archive', online],
      ['In progress', list.length - done, 'can be resumed', 'play'],
      ['Completed', done, done ? 'champions crowned' : 'none yet', 'trophy'],
      ['Live round', live ? currentRound : '–', live ? esc(tournamentName) : 'no live event', 'court', live]
    ];
    $('summary').innerHTML = tiles.map(([l, v, n, ic, up]) =>
      `<div class="sum-tile"><span>${l}</span><strong>${v}</strong><small${up ? ' class="up"' : ''}>${n}</small><i class="sum-icon">${icon(ic)}</i></div>`).join('');
    $('navArchiveCount').textContent = list.length;
  }

  /* ----- live tournament + archive record metrics ----- */
  const metric = (v, l) => `<div class="metric"><b>${v}</b><small>${l}</small></div>`;
  function liveDetails() {
    if (!hasLive()) return;
    const unit = isTeamFormat() ? 'Teams' : 'Players';
    $('liveMetrics').innerHTML = metric(participants.length, unit) + metric(totalCourts, totalCourts === 1 ? 'Court' : 'Courts')
      + metric(isTournamentFinished ? 'Done' : currentRound, isTournamentFinished ? 'Finished' : 'Current round') + metric(maxPoints, 'Points per match');
    $('liveChip').textContent = isTournamentFinished ? '🏆 COMPLETED' : '● LIVE TOURNAMENT';
    const rt = $('round-title').textContent.trim();
    $('roundChip').textContent = isTournamentFinished ? 'Finished' : '● ' + (rt || 'Round ' + currentRound);
  }
  function viewDetails() {
    const id = typeof currentlyViewingArchiveId !== 'undefined' ? currentlyViewingArchiveId : null;
    const t = id && saved().find(x => x.id === id);
    if (!t) return;
    const rounds = t.totalRoundsPlayed !== undefined ? t.totalRoundsPlayed : (t.totalRounds || 0);
    const n = (t.participants || t.players || []).length;
    $('viewMetrics').innerHTML = metric(n, isTeamFormat(t.format) ? 'Teams' : 'Players') + metric(t.totalCourts || '–', 'Courts')
      + metric(t.recorded ? '–' : rounds, 'Rounds played') + metric(t.maxPoints || '–', 'Points per match');
    $('view-modal-resume-btn').hidden = $('view-resume-bottom').hidden = !!t.recorded;
    $('view-modal-resume-btn').textContent = t.isFinished ? 'Continue playing' : 'Resume';
    $('view-resume-bottom').querySelector('span').textContent = t.isFinished ? 'Continue playing' : 'Resume playing';
    $('viewChip').textContent = t.recorded ? 'RECORDED RESULT' : t.isFinished ? `🏆 ${t.winner || 'COMPLETED'}` : '● IN PROGRESS';
  }

  /* ----- New tournament: format summary card ----- */
  function formatCard() {
    const sel = $('tournament-type');
    $('formatCardTitle').textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    $('formatCardText').textContent = $('format-bubble-text').textContent;
  }
  $('tournament-type').addEventListener('change', formatCard);
  $('tipLink').addEventListener('click', e => {
    setMenu(false); showScreen('setup-screen'); sync();
    requestAnimationFrame(() => { $('formatCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); toggleFormatBubble(e); });
  });

  /* ----- header + nav state ----- */
  function sync() {
    const cur = current(), nav = NAV_OF[cur], live = hasLive() && !isTournamentFinished;
    document.querySelectorAll('.nav-item[data-nav]').forEach(b => {
      const on = b.dataset.nav === nav;
      b.classList.toggle('active', on);
      on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
      if (b.dataset.nav === 'live') b.classList.toggle('disabled', !hasLive());
    });
    $('liveDot').hidden = !live;
    const [t, s] = TITLES[cur];
    $('pageTitle').textContent = t;
    $('pageSub').textContent = s;
    $('headCta').hidden = cur === 'setup-screen';
    summary();
    if (cur === 'tournament-screen') liveDetails();
    if (cur === 'archive-view-screen') viewDetails();
    if (cur === 'setup-screen') formatCard();
    if (cur !== lastScreen) { lastScreen = cur; window.scrollTo({ top: 0 }); }
  }

  /* ----- navigation (sidebar, phone bottom bar, header button) ----- */
  function go(n) {
    if (n === 'setup') showScreen('setup-screen');
    else if (n === 'live') showScreen('tournament-screen');
    else if (n === 'players') { showScreen('players-screen'); Players.render(); }
    else if (n === 'record') { showScreen('record-screen'); Recorder.open(); }
    else { showScreen('vault-screen'); openVaultScreen(); }
    sync();
  }
  $('sidebar').addEventListener('click', e => {
    const b = e.target.closest('.nav-item[data-nav]');
    if (b && !b.classList.contains('disabled')) { go(b.dataset.nav); setMenu(false); }
  });

  /* ----- phones: the sidebar slides in from the menu button ----- */
  const phone = window.matchMedia('(max-width: 759px)');
  const sidebar = $('sidebar'), scrim = $('scrim'), menuBtn = $('menuBtn');
  const syncInert = () => sidebar.toggleAttribute('inert', phone.matches && !sidebar.classList.contains('open'));
  function setMenu(open) {
    if (!phone.matches) open = false;
    if (open === sidebar.classList.contains('open')) return syncInert();
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    requestAnimationFrame(() => scrim.classList.toggle('show', open));
    document.body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    syncInert();
    (open ? sidebar.querySelector('.nav-item.active') || sidebar.querySelector('.nav-item') : menuBtn).focus({ preventScroll: true });
  }
  menuBtn.addEventListener('click', () => setMenu(true));
  $('sideClose').addEventListener('click', () => setMenu(false));
  scrim.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sidebar.classList.contains('open')) setMenu(false); });
  phone.addEventListener('change', () => { if (!phone.matches) setMenu(false); syncInert(); });
  syncInert();
  $('headCta').addEventListener('click', () => go('setup'));

  /* ----- archive filter ----- */
  window.archiveFilter = 'all';
  $('archiveFilter').addEventListener('click', e => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    window.archiveFilter = b.dataset.filter;
    $('archiveFilter').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    renderSavedTournamentsList();
  });

  /* ----- keep shell in sync with the engine (no engine hooks needed) ----- */
  const mo = new MutationObserver(sync);
  SCREENS.forEach(id => mo.observe($(id), { attributes: true, attributeFilter: ['class'] }));
  [$('archive-count-badge'), $('round-title'), $('format-bubble-text'), $('tournament-completed-banner')]
    .forEach(el => mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] }));

  /* ----- online database status + organiser key ----- */
  const dialog = $('syncDialog');
  function syncStatus() {
    if (!window.CloudSync) return;
    const st = CloudSync.status();
    $('syncLabel').textContent = st.label;
    $('syncDot').dataset.tone = $('syncDialogDot').dataset.tone = $('syncDotMobile').dataset.tone = st.tone;
    $('syncBtn').title = $('syncBtnMobile').title = 'Online database: ' + st.label;
    $('syncDetail').textContent = st.detail;
    $('syncBtn').classList.toggle('sync-off', CloudSync.state.api === 'none');
    $('syncForget').hidden = !CloudSync.hasKey();
  }
  const openSync = () => { setMenu(false); $('syncKey').value = ''; syncStatus(); dialog.showModal(); };
  $('syncBtn').addEventListener('click', openSync);
  $('syncBtnMobile').addEventListener('click', openSync);
  $('syncClose').addEventListener('click', () => dialog.close());
  $('syncNowBtn').addEventListener('click', () => CloudSync.syncNow());
  $('syncForget').addEventListener('click', async () => { await CloudSync.setKey(''); syncStatus(); });
  $('syncForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = $('syncKey').value.trim();
    if (!key) return $('syncKey').focus();
    $('syncSave').disabled = true;
    const ok = await CloudSync.setKey(key);
    $('syncSave').disabled = false;
    syncStatus();
    if (ok) dialog.close();
    else {
      if (CloudSync.state.api === 'up') { await CloudSync.setKey(''); $('syncDetail').textContent = 'That key was not accepted. Check it and try again.'; }
      $('syncKey').select();
    }
  });
  window.addEventListener('padel:data-changed', () => {
    syncStatus(); summary();
    if (current() === 'vault-screen') renderSavedTournamentsList();
  });

  /* ----- PWA install + service worker ----- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null; $('installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.log('Service Worker registration failed:', err)));
  }

  sync();
  syncStatus();
})();
