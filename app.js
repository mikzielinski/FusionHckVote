(function () {
  'use strict';

  if (typeof window.FUSION_VOTE_CONFIG === 'undefined') {
    window.FUSION_VOTE_CONFIG = { firebase: {}, adminPassword: 'admin' };
  }

  const CONFIG = window.FUSION_VOTE_CONFIG;
  const useLiveOnly = CONFIG.useMock === false;
  const STORAGE_KEY = 'voterId'; // device ID – one per browser/device, max 1 vote per device
  const VIEWED_KEY = 'fusionViewedProjects';
  const MOCK_VOTES_KEY = 'fusionMockVotes'; // when no Firebase: persist selected projectIds here
  const VOTING_ENABLED_KEY = 'fusionVotingEnabled'; // when no Firebase: admin toggle
  const VOTING_START_KEY = 'fusionVotingStartAt';
  const VOTING_END_KEY = 'fusionVotingEndAt';
  const TIE_BREAK_WINNER_KEY = 'fusionTieBreakWinnerProjectId';
  const FUN_ANIMATIONS_ENABLED_KEY = 'fusionFunVoteAnimationsEnabled';
  const MAX_VOTES = 1;
  const ADMIN_KEY = 'fusionAdminUnlocked';
  const CONFIG_DOC = 'app';

  let db = null;
  let adminUnlocked = sessionStorage.getItem(ADMIN_KEY) === '1';
  let votingEnabled = true;
  let votingStartAtMs = null;
  let votingEndAtMs = null;
  let tieBreakWinnerProjectId = null;
  let funVoteAnimationsEnabled = true;
  let adminProjectsCache = [];

  function getVoterId() {
    try {
      var id = localStorage.getItem(STORAGE_KEY);
      if (!id) {
        id = 'v_' + (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch (e) {
      return 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function initFirebase() {
    if (!CONFIG.firebase || !CONFIG.firebase.apiKey || CONFIG.firebase.apiKey === 'YOUR_API_KEY') {
      return null;
    }
    if (typeof firebase === 'undefined') return null;
    try {
      firebase.initializeApp(CONFIG.firebase);
      return firebase.firestore();
    } catch (e) {
      console.warn('Firebase init failed', e);
      return null;
    }
  }

  try {
    db = initFirebase();
  } catch (e) {
    console.warn('Firebase init error:', e);
    db = null;
  }

  function parseConfigDateValue(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.seconds === 'number') return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    return null;
  }

  function toConfigDateValue(ms) {
    if (ms == null) return null;
    if (!db || typeof firebase === 'undefined' || !firebase.firestore?.Timestamp) return new Date(ms).toISOString();
    return firebase.firestore.Timestamp.fromDate(new Date(ms));
  }

  function formatDateTime(ms) {
    if (!Number.isFinite(ms)) return '—';
    return new Intl.DateTimeFormat('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms));
  }

  function getRouteQueryParam(name) {
    const hash = window.location.hash.slice(1) || '/vote';
    const query = hash.includes('?') ? hash.split('?')[1] : '';
    return new URLSearchParams(query).get(name);
  }

  function getVotingWindowState(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const hasStart = Number.isFinite(votingStartAtMs);
    const hasEnd = Number.isFinite(votingEndAtMs);
    let allowed = votingEnabled;
    let reason = votingEnabled ? 'enabled' : 'disabled';
    if (allowed && hasStart && now < votingStartAtMs) {
      allowed = false;
      reason = 'not_started';
    }
    if (allowed && hasEnd && now > votingEndAtMs) {
      allowed = false;
      reason = 'ended';
    }
    return {
      allowed,
      reason,
      hasStart,
      hasEnd,
      hasSchedule: hasStart || hasEnd
    };
  }

  function getVotingClosedBannerMessage() {
    const state = getVotingWindowState();
    if (state.reason === 'disabled') {
      return {
        title: 'Voting is currently disabled.',
        hint: 'Organisers have disabled voting. Check back later.'
      };
    }
    if (state.reason === 'not_started') {
      return {
        title: 'Voting has not started yet.',
        hint: 'Start time: ' + formatDateTime(votingStartAtMs)
      };
    }
    if (state.reason === 'ended') {
      return {
        title: 'Voting has ended.',
        hint: 'End time: ' + formatDateTime(votingEndAtMs)
      };
    }
    return { title: '', hint: '' };
  }

  function toDatetimeInputValue(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function parseDatetimeInputValue(raw) {
    if (!raw) return null;
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getRandomFunScene() {
    const scenes = [
      {
        title: 'Monocycle Stardust Show',
        cast: [
          { kind: 'bear-mono', name: 'Bruno' },
          { kind: 'cat-skater', name: 'Mila' }
        ],
        tone: 'pink',
        motion: 'spin'
      },
      {
        title: 'Cosmic Disco Drop',
        cast: [
          { kind: 'cat-skater', name: 'Mila' },
          { kind: 'octo-jazz', name: 'Ozzy' }
        ],
        tone: 'violet',
        motion: 'wave'
      },
      {
        title: 'Robot Llama Parade',
        cast: [
          { kind: 'llama-bot', name: 'Rufi' },
          { kind: 'bear-mono', name: 'Bruno' }
        ],
        tone: 'blue',
        motion: 'bounce'
      },
      {
        title: 'Octopus Jazz Ballet',
        cast: [
          { kind: 'octo-jazz', name: 'Ozzy' },
          { kind: 'llama-bot', name: 'Rufi' }
        ],
        tone: 'teal',
        motion: 'float'
      }
    ];
    return scenes[Math.floor(Math.random() * scenes.length)];
  }

  function renderFunCharacter(kind) {
    if (kind === 'bear-mono') {
      return (
        '<div class="fun-char char-bear-mono">' +
          '<div class="char-shadow"></div>' +
          '<div class="bear-wheel"></div>' +
          '<div class="bear-tutu"></div>' +
          '<div class="bear-body"></div>' +
          '<div class="bear-head">' +
            '<span class="bear-ear bear-ear-left"></span><span class="bear-ear bear-ear-right"></span>' +
            '<span class="bear-eye bear-eye-left"></span><span class="bear-eye bear-eye-right"></span>' +
          '</div>' +
          '<div class="bear-arm bear-arm-left"></div><div class="bear-arm bear-arm-right"></div>' +
          '<span class="juggle-ball juggle-ball-1"></span><span class="juggle-ball juggle-ball-2"></span><span class="juggle-ball juggle-ball-3"></span>' +
        '</div>'
      );
    }
    if (kind === 'cat-skater') {
      return (
        '<div class="fun-char char-cat-skater">' +
          '<div class="char-shadow"></div>' +
          '<div class="cat-board"></div>' +
          '<span class="board-wheel board-wheel-left"></span><span class="board-wheel board-wheel-right"></span>' +
          '<div class="cat-body"></div>' +
          '<div class="cat-head">' +
            '<span class="cat-ear cat-ear-left"></span><span class="cat-ear cat-ear-right"></span>' +
            '<span class="cat-visor"></span>' +
          '</div>' +
          '<div class="cat-tail"></div>' +
        '</div>'
      );
    }
    if (kind === 'llama-bot') {
      return (
        '<div class="fun-char char-llama-bot">' +
          '<div class="char-shadow"></div>' +
          '<div class="llama-rocket"></div>' +
          '<div class="llama-body"></div>' +
          '<div class="llama-neck"></div>' +
          '<div class="llama-head">' +
            '<span class="llama-ear llama-ear-left"></span><span class="llama-ear llama-ear-right"></span>' +
            '<span class="llama-eye"></span>' +
          '</div>' +
          '<span class="llama-leg llama-leg-1"></span><span class="llama-leg llama-leg-2"></span>' +
        '</div>'
      );
    }
    return (
      '<div class="fun-char char-octo-jazz">' +
        '<div class="char-shadow"></div>' +
        '<div class="octo-head"><span class="octo-eye octo-eye-left"></span><span class="octo-eye octo-eye-right"></span></div>' +
        '<span class="octo-arm octo-arm-1"></span><span class="octo-arm octo-arm-2"></span><span class="octo-arm octo-arm-3"></span><span class="octo-arm octo-arm-4"></span>' +
        '<div class="octo-trumpet"></div>' +
      '</div>'
    );
  }

  function showVoteFunAnimation() {
    if (!funVoteAnimationsEnabled) return;
    const overlay = document.getElementById('vote-fun-overlay');
    if (!overlay) return;
    const scene = getRandomFunScene();
    overlay.className = 'vote-fun-overlay tone-' + scene.tone + ' motion-' + scene.motion + ' active';
    overlay.innerHTML =
      '<div class="vote-fun-card" role="status" aria-live="polite">' +
        '<p class="vote-fun-kicker">Vote accepted!</p>' +
        '<h3>' + escapeHtml(scene.title) + '</h3>' +
        '<div class="vote-fun-stage">' +
          '<span class="fun-spark fun-spark-1"></span><span class="fun-spark fun-spark-2"></span><span class="fun-spark fun-spark-3"></span><span class="fun-spark fun-spark-4"></span>' +
          scene.cast.map(function (actor) { return renderFunCharacter(actor.kind); }).join('') +
        '</div>' +
        '<div class="vote-fun-cast">' +
          scene.cast.map(function (actor) { return '<span class="vote-fun-name">' + escapeHtml(actor.name) + '</span>'; }).join('') +
        '</div>' +
      '</div>';
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(function () {
      overlay.classList.remove('active');
    }, 1800);
  }

  function buildTeamKey(project) {
    const team = (project.team || '').trim().toLowerCase();
    if (team) return 'team:' + team;
    return 'project:' + (project.id || project.name || Math.random().toString(36).slice(2));
  }

  function generateTeamToken() {
    const random = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return 'team_' + random.slice(0, 24);
  }

  function ensureTeamTokens(projects) {
    const tokenByKey = {};
    projects.forEach(p => {
      if (p.teamToken) tokenByKey[buildTeamKey(p)] = p.teamToken;
    });
    const updates = [];
    const withTokens = projects.map(p => {
      const key = buildTeamKey(p);
      let token = p.teamToken || tokenByKey[key];
      if (!token) {
        token = generateTeamToken();
        tokenByKey[key] = token;
        updates.push({ id: p.id, teamToken: token });
      }
      return { ...p, teamToken: token };
    });
    return { withTokens, updates };
  }

  function buildTeamResultsLink(token) {
    if (!token) return '';
    return window.location.origin + window.location.pathname + '#/team?token=' + encodeURIComponent(token);
  }

  function resolveTeamTokenForProject(projectId, teamName) {
    const normalizedTeam = (teamName || '').trim().toLowerCase();
    const sameTeamProject = normalizedTeam
      ? adminProjectsCache.find(p => p.id !== projectId && (p.team || '').trim().toLowerCase() === normalizedTeam && p.teamToken)
      : null;
    if (sameTeamProject) return sameTeamProject.teamToken;
    const current = adminProjectsCache.find(p => p.id === projectId);
    if (current?.teamToken) {
      const currentTeam = (current.team || '').trim().toLowerCase();
      if (!normalizedTeam || normalizedTeam === currentTeam) return current.teamToken;
    }
    return generateTeamToken();
  }

  function backfillExistingTeamTokens() {
    if (!db) return Promise.resolve();
    return db.collection('projects').get().then((snap) => {
      const rawProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const ensured = ensureTeamTokens(rawProjects);
      adminProjectsCache = ensured.withTokens.slice();
      if (ensured.updates.length === 0) return;
      const batch = db.batch();
      ensured.updates.forEach((u) => {
        batch.set(db.collection('projects').doc(u.id), { teamToken: u.teamToken }, { merge: true });
      });
      return batch.commit();
    }).catch(() => {});
  }

  function loadVotingConfig() {
    if (!db) {
      votingEnabled = localStorage.getItem(VOTING_ENABLED_KEY) !== 'false';
      votingStartAtMs = parseConfigDateValue(localStorage.getItem(VOTING_START_KEY));
      votingEndAtMs = parseConfigDateValue(localStorage.getItem(VOTING_END_KEY));
      tieBreakWinnerProjectId = localStorage.getItem(TIE_BREAK_WINNER_KEY) || null;
      funVoteAnimationsEnabled = localStorage.getItem(FUN_ANIMATIONS_ENABLED_KEY) !== 'false';
      return Promise.resolve();
    }
    return db.collection('config').doc(CONFIG_DOC).get()
      .then(doc => {
        if (!doc.exists) {
          votingEnabled = true;
          votingStartAtMs = null;
          votingEndAtMs = null;
          tieBreakWinnerProjectId = null;
          funVoteAnimationsEnabled = true;
          return;
        }
        const data = doc.data() || {};
        votingEnabled = data.votingEnabled !== false;
        votingStartAtMs = parseConfigDateValue(data.votingStartAt);
        votingEndAtMs = parseConfigDateValue(data.votingEndAt);
        tieBreakWinnerProjectId = (typeof data.tieBreakWinnerProjectId === 'string' && data.tieBreakWinnerProjectId) ? data.tieBreakWinnerProjectId : null;
        funVoteAnimationsEnabled = data.funVoteAnimationsEnabled !== false;
      })
      .catch(() => {
        votingEnabled = true;
        votingStartAtMs = null;
        votingEndAtMs = null;
        tieBreakWinnerProjectId = null;
        funVoteAnimationsEnabled = true;
      });
  }

  function setVotingEnabled(enabled) {
    votingEnabled = enabled;
    if (!db) {
      localStorage.setItem(VOTING_ENABLED_KEY, enabled ? 'true' : 'false');
      return Promise.resolve();
    }
    return db.collection('config').doc(CONFIG_DOC).set({ votingEnabled: enabled }, { merge: true });
  }

  function setVotingSchedule(startAtMs, endAtMs) {
    votingStartAtMs = startAtMs;
    votingEndAtMs = endAtMs;
    if (!db) {
      if (startAtMs == null) localStorage.removeItem(VOTING_START_KEY);
      else localStorage.setItem(VOTING_START_KEY, String(startAtMs));
      if (endAtMs == null) localStorage.removeItem(VOTING_END_KEY);
      else localStorage.setItem(VOTING_END_KEY, String(endAtMs));
      return Promise.resolve();
    }
    return db.collection('config').doc(CONFIG_DOC).set({
      votingStartAt: toConfigDateValue(startAtMs),
      votingEndAt: toConfigDateValue(endAtMs)
    }, { merge: true });
  }

  function setTieBreakWinnerProjectId(projectId) {
    tieBreakWinnerProjectId = projectId || null;
    if (!db) {
      if (tieBreakWinnerProjectId) localStorage.setItem(TIE_BREAK_WINNER_KEY, tieBreakWinnerProjectId);
      else localStorage.removeItem(TIE_BREAK_WINNER_KEY);
      return Promise.resolve();
    }
    return db.collection('config').doc(CONFIG_DOC).set({
      tieBreakWinnerProjectId: tieBreakWinnerProjectId
    }, { merge: true });
  }

  function setFunVoteAnimationsEnabled(enabled) {
    funVoteAnimationsEnabled = enabled;
    if (!db) {
      localStorage.setItem(FUN_ANIMATIONS_ENABLED_KEY, enabled ? 'true' : 'false');
      return Promise.resolve();
    }
    return db.collection('config').doc(CONFIG_DOC).set({
      funVoteAnimationsEnabled: enabled
    }, { merge: true });
  }

  function clearAllVotesInDb() {
    if (!db) return Promise.reject(new Error('No database'));
    const BATCH_SIZE = 500;
    return db.collection('votes').get().then(snap => {
      if (snap.empty) return Promise.resolve();
      const docs = snap.docs;
      const batches = [];
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
        batches.push(batch.commit());
      }
      return Promise.all(batches);
    });
  }

  const router = {
    routes: {},
    current: '',
    init() {
      const go = () => {
        const hash = window.location.hash.slice(1) || '/vote';
        const path = hash.startsWith('/') ? hash : '/' + hash;
        const base = path.split('?')[0];
        this.current = base;
        const fn = this.routes[base] || this.routes['/vote'];
        if (fn) fn();
        document.querySelectorAll('.nav-link[data-route]').forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === '#' + base);
        });
      };
      window.addEventListener('hashchange', go);
      go();
    },
    on(path, fn) {
      this.routes[path] = fn;
    }
  };

  function showToast(msg, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast visible ' + (type || '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 3500);
  }

  function render(el, html) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (el) el.innerHTML = html;
  }

  function getAppEl() {
    return document.getElementById('app');
  }

  // ---------- Mock projects (when Firebase not configured or empty) ----------
  const MOCK_PROJECTS = [
    {
      id: 'mock-1',
      name: 'AI Payroll Agent',
      team: 'Automation Crew',
      description: 'Intelligent agent that processes timesheets, calculates pay and generates reports. Integrates with HR systems and supports multiple countries.',
      thumbnailUrl: 'https://picsum.photos/seed/payroll1/400/225',
      videoUrl: 'https://www.youtube.com/watch?v=l3L0n-4LpRc',
      isActive: true
    },
    {
      id: 'mock-2',
      name: 'Document Intelligence Pipeline',
      team: 'Data Ninjas',
      description: 'End-to-end pipeline for invoice and contract extraction using AI. Outputs structured data ready for ERP and compliance checks.',
      thumbnailUrl: 'https://picsum.photos/seed/docpipe2/400/225',
      videoUrl: 'https://www.youtube.com/watch?v=l3L0n-4LpRc',
      isActive: true
    },
    {
      id: 'mock-3',
      name: 'Customer Support Co-pilot',
      team: 'Support Heroes',
      description: 'Agent that reads tickets, suggests replies and escalates when needed. Reduces handling time and keeps satisfaction high.',
      thumbnailUrl: 'https://picsum.photos/seed/support3/400/225',
      videoUrl: 'https://www.youtube.com/watch?v=l3L0n-4LpRc',
      isActive: true
    },
    {
      id: 'mock-4',
      name: 'Procurement Assistant',
      team: 'ProcureBot',
      description: 'Automates RFQ creation, vendor comparison and purchase order approval. Connects to SAP and Coupa.',
      thumbnailUrl: 'https://picsum.photos/seed/procure4/400/225',
      videoUrl: 'https://www.youtube.com/watch?v=l3L0n-4LpRc',
      isActive: true
    },
    {
      id: 'mock-5',
      name: 'IT Onboarding Bot',
      team: 'DevOps League',
      description: 'Provisions accounts, installs software and runs checklists for new joiners. Fully auditable and role-based.',
      thumbnailUrl: 'https://picsum.photos/seed/onboard5/400/225',
      videoUrl: 'https://www.youtube.com/watch?v=l3L0n-4LpRc',
      isActive: true
    },
    {
      id: 'mock-6',
      name: 'Compliance Guardian',
      team: 'Risk & Control',
      description: 'Monitors policies, runs controls and generates audit trails. Alerts when exceptions or deadlines are at risk.',
      thumbnailUrl: 'https://picsum.photos/seed/compliance6/400/225',
      videoUrl: 'https://www.youtube.com/watch?v=l3L0n-4LpRc',
      isActive: true
    }
  ];

  // ---------- Vote page ----------
  let voteState = { projects: [], myVotes: [], selected: new Set() };

  function shuffleProjects(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function loadProjects() {
    if (!db) {
      voteState.projects = useLiveOnly ? [] : shuffleProjects(MOCK_PROJECTS);
      return Promise.resolve();
    }
    return db.collection('projects')
      .get()
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fromDb = list
          .filter(p => p.isActive !== false);
        voteState.projects = fromDb.length > 0 ? shuffleProjects(fromDb) : (useLiveOnly ? [] : shuffleProjects(MOCK_PROJECTS));
      })
      .catch(() => { voteState.projects = useLiveOnly ? [] : shuffleProjects(MOCK_PROJECTS); });
  }

  function loadMyVotes() {
    if (!db) {
      if (useLiveOnly) {
        voteState.myVotes = [];
        voteState.selected = new Set();
        return Promise.resolve();
      }
      try {
        const saved = JSON.parse(localStorage.getItem(MOCK_VOTES_KEY) || '[]');
        const ids = Array.isArray(saved) ? saved.slice(0, MAX_VOTES) : [];
        voteState.selected = new Set(ids);
        voteState.myVotes = ids.map(projectId => ({ projectId }));
      } catch (_) {
        voteState.myVotes = [];
        voteState.selected = new Set();
      }
      return Promise.resolve();
    }
    const voterId = getVoterId();
    return db.collection('votes')
      .where('voterId', '==', voterId)
      .get()
      .then(snap => {
        voteState.myVotes = snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, MAX_VOTES);
        voteState.selected = new Set(voteState.myVotes.map(v => v.projectId));
      })
      .catch(() => {
        voteState.myVotes = [];
        voteState.selected = new Set();
      });
  }

  function recordView(projectId) {
    if (!db) return;
    const voterId = getVoterId();
    let viewed = [];
    try {
      viewed = JSON.parse(sessionStorage.getItem(VIEWED_KEY) || '[]');
    } catch (_) {}
    if (viewed.includes(projectId)) return;
    viewed.push(projectId);
    sessionStorage.setItem(VIEWED_KEY, JSON.stringify(viewed));
    db.collection('views').add({
      viewId: 'view_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      projectId,
      voterId,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  }

  function toggleVote(projectId) {
    if (voteState.selected.has(projectId)) {
      voteState.selected.delete(projectId);
      renderVotePage();
      return;
    }
    if (voteState.selected.size >= MAX_VOTES) {
      showToast('You can vote for only 1 project. Remove current vote to choose another.', 'error');
      document.getElementById('vote-warning')?.classList.add('visible');
      return;
    }
    document.getElementById('vote-warning')?.classList.remove('visible');
    voteState.selected.add(projectId);
    renderVotePage();
  }

  function addVoteInFirestore(projectId) {
    if (!db) {
      if (!useLiveOnly) {
        localStorage.setItem(MOCK_VOTES_KEY, JSON.stringify([...voteState.selected]));
        showVoteFunAnimation();
      }
      else showToast('Connect Firebase to save votes.', 'error');
      return;
    }
    const voterId = getVoterId();
    db.collection('votes').add({
      voteId: 'vote_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      projectId,
      voterId,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => loadMyVotes().then(() => {
      renderVotePage();
      showVoteFunAnimation();
    }))
      .catch(() => { voteState.selected.delete(projectId); renderVotePage(); showToast('Failed to save vote', 'error'); });
  }

  function removeVoteInFirestore(projectId) {
    if (!db) {
      if (!useLiveOnly) localStorage.setItem(MOCK_VOTES_KEY, JSON.stringify([...voteState.selected]));
      renderVotePage();
      return;
    }
    const voterId = getVoterId();
    db.collection('votes')
      .where('voterId', '==', voterId)
      .where('projectId', '==', projectId)
      .get()
      .then(snap => {
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        return batch.commit();
      })
      .then(() => loadMyVotes().then(() => renderVotePage()))
      .catch(() => { voteState.selected.add(projectId); renderVotePage(); showToast('Failed to remove vote', 'error'); });
  }

  function submitVotes() {
    const voterId = getVoterId();
    if (voteState.selected.size === 0) {
      if (voteState.myVotes.length > 0) {
        if (!confirm('Czy na pewno chcesz cofnąć głos? (Zostaniesz bez oddanego głosu.)')) return;
        if (!db) {
          if (!useLiveOnly) localStorage.setItem(MOCK_VOTES_KEY, '[]');
          voteState.myVotes = [];
          voteState.selected = new Set();
          renderVotePage();
          showToast('Głos cofnięty.', 'success');
          return;
        }
        db.collection('votes')
          .where('voterId', '==', voterId)
          .get()
          .then(snap => {
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            return batch.commit();
          })
          .then(() => loadMyVotes().then(() => {
            renderVotePage();
            showToast('Głos cofnięty.', 'success');
          }))
          .catch(() => showToast('Nie udało się cofnąć głosu.', 'error'));
        return;
      }
      showToast('Select one project to vote.', 'error');
      return;
    }
    const projectId = [...voteState.selected][0];
    const project = voteState.projects.find(p => p.id === projectId);
    const projectName = (project ? (project.name || 'Unnamed') : 'this project').replace(/"/g, "'");
    const currentVote = voteState.myVotes[0];
    const isChange = currentVote && currentVote.projectId !== projectId;
    let confirmMsg;
    if (isChange) {
      const currentProject = voteState.projects.find(p => p.id === currentVote.projectId);
      const currentName = (currentProject ? (currentProject.name || 'Unnamed') : 'ten projekt').replace(/"/g, "'");
      confirmMsg = 'Czy na pewno chcesz zmienić głos?\n\nObecny głos: „' + currentName + '"\nNowy wybór: „' + projectName + '"';
    } else {
      confirmMsg = 'Czy na pewno chcesz oddać głos na „' + projectName + '"';
    }
    if (!confirm(confirmMsg + '?')) return;
    if (!db) {
      if (!useLiveOnly) {
        localStorage.setItem(MOCK_VOTES_KEY, JSON.stringify([...voteState.selected]));
        showToast('Vote saved. You can change it anytime.', 'success');
        showVoteFunAnimation();
      } else showToast('Connect Firebase to save votes.', 'error');
      return;
    }
    db.collection('votes')
      .where('voterId', '==', voterId)
      .get()
      .then(snap => {
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        return batch.commit();
      })
      .then(() => {
        return db.collection('votes').add({
          voteId: 'vote_' + Date.now() + '_' + Math.random().toString(36).slice(2),
          projectId,
          voterId,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      })
      .then(() => loadMyVotes().then(() => {
        renderVotePage();
        showVoteFunAnimation();
        showToast('Głos oddany. Możesz go zmienić w każdej chwili.', 'success');
      }))
      .catch(() => {
        loadMyVotes().then(() => renderVotePage());
        showToast('Nie udało się zapisać głosu.', 'error');
      });
  }

  function openVideoModal(url) {
    if (!url) return;
    const container = document.getElementById('video-container');
    const modal = document.getElementById('video-modal');
    if (!container || !modal) return;
    let embed = '';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const id = (url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/) || [])[1] || '';
      embed = '<iframe src="https://www.youtube.com/embed/' + id + '?rel=0" allowfullscreen></iframe>';
    } else if (url.includes('vimeo.com')) {
      const id = (url.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1] || '';
      embed = '<iframe src="https://player.vimeo.com/video/' + id + '" allowfullscreen></iframe>';
    } else if (url.match(/\.(mp4|webm|ogg)(\?|$)/i)) {
      embed = '<video controls src="' + url + '"></video>';
    } else {
      embed = '<p>Unsupported video URL</p>';
    }
    container.innerHTML = embed;
    modal.hidden = false;
  }

  function initVideoModal() {
    const modal = document.getElementById('video-modal');
    if (!modal) return;
    const close = () => {
      modal.hidden = true;
      document.getElementById('video-container').innerHTML = '';
    };
    modal.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', close));
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function renderVotePage() {
    const used = voteState.selected.size;
    const counterClass = used === MAX_VOTES ? 'vote-counter at-limit' : 'vote-counter';
    const votingState = getVotingWindowState();
    const votingClosed = !votingState.allowed;
    const closedBanner = getVotingClosedBannerMessage();
    const closedBannerAction = votingState.reason === 'ended'
      ? (
          '<div class="vote-closed-actions">' +
            '<a href="#/final-results" class="btn btn-secondary">View final podium</a>' +
            (adminUnlocked ? '<a href="#/results" class="btn btn-secondary">Judge details</a>' : '') +
          '</div>'
        )
      : '';
    const warning = document.getElementById('vote-warning');
    if (warning) warning.classList.toggle('visible', false);

    const INITIAL_DESC_LEN = 220;
    const cards = voteState.projects.map(p => {
      const voted = voteState.selected.has(p.id);
      const fullDesc = p.description || '';
      const needsExpand = fullDesc.length > INITIAL_DESC_LEN;
      const shortDesc = needsExpand ? fullDesc.slice(0, INITIAL_DESC_LEN) + '…' : fullDesc;
      const thumbSrc = p.thumbnailDataUrl || p.thumbnailUrl || '';
      const thumbFallback = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'225\'%3E%3Crect fill=\'%23334155\' width=\'400\' height=\'225\'/%3E%3C/svg%3E';
      const thumbHtml = thumbSrc
        ? '<div class="project-card-thumb"><img src="' + escapeAttr(thumbSrc) + '" alt="" loading="lazy" data-fallback="' + escapeAttr(thumbFallback) + '" /></div>'
        : '<div class="project-card-thumb project-card-thumb--empty"><img src="' + escapeAttr(thumbFallback) + '" alt="" /></div>';
      const videoBtn = p.videoUrl
        ? '<button type="button" class="watch-video" data-video="' + escapeAttr(p.videoUrl) + '">Watch demo</button>'
        : '';
      const cardDisabled = votingClosed || p.isActive === false;
      let descHtml = '';
      if (fullDesc) {
        if (needsExpand) {
          descHtml = '<div class="description-wrap">' +
            '<div class="description description-preview">' + escapeHtml(shortDesc) + '</div>' +
            '<div class="description description-full" aria-hidden="true">' + escapeHtml(fullDesc) + '</div>' +
            '<button type="button" class="show-more-desc" aria-expanded="false">Pokaż więcej</button>' +
            '</div>';
        } else {
          descHtml = '<div class="description-wrap"><div class="description">' + escapeHtml(fullDesc) + '</div></div>';
        }
      }
      return (
        '<article class="project-card' + (voted ? ' voted' : '') + (cardDisabled ? ' disabled' : '') + (votingClosed ? ' voting-closed' : '') + '" data-project-id="' + escapeAttr(p.id) + '" data-project-name="' + escapeAttr(p.name || '') + '">' +
          thumbHtml +
          '<div class="project-card-body">' +
          '<div class="name">' + escapeHtml(p.name || 'Unnamed') + '</div>' +
          (p.team ? '<div class="team">' + escapeHtml(p.team) + '</div>' : '') +
          descHtml +
          (videoBtn ? '<div>' + videoBtn + '</div>' : '') +
          '<div class="badge">' + (voted ? 'Voted' : '') + '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    const html =
      '<div class="vote-page">' +
        '<div class="vote-banner-wrap">' +
          '<picture class="vote-banner-picture">' +
            '<source media="(min-width: 1024px)" srcset="images/banner-desktop.png" />' +
            '<img src="images/banner-hero.png" alt="Agent Pageant – Agentic Automation Hackathon" class="vote-banner-hero" />' +
          '</picture>' +
        '</div>' +
        '<div class="container">' +
        '<header class="vote-header">' +
          (votingClosed ? '<div class="vote-closed-banner"><p>' + escapeHtml(closedBanner.title) + '</p><p class="vote-closed-hint">' + escapeHtml(closedBanner.hint) + '</p>' + closedBannerAction + '</div>' : '') +
          '<h1>UiPath Fusion</h1>' +
          '<p class="subtitle">Public Choice Award</p>' +
          '<p class="vote-instructions">' + (votingClosed ? 'You can view projects below.' : 'Click a project to select it, then click “Submit my votes” to cast your vote.') + '</p>' +
          (votingClosed ? '' : '<div class="' + counterClass + '" id="vote-counter">Votes used: ' + used + ' / ' + MAX_VOTES + '</div>') +
          (votingClosed ? '' : '<p class="vote-warning" id="vote-warning">You can vote for only 1 project. Remove current vote to choose another.</p>') +
        '</header>' +
        '<div class="projects-list" id="projects-list">' + (cards || (useLiveOnly && !db ? '<p class="empty-state">Connect Firebase to load projects.</p>' : '<p class="empty-state">No projects yet. Check back later.</p>')) + '</div>' +
        '</div>' +
        (votingClosed ? '' : '<div class="submit-votes-bar' + (used > 0 ? ' submit-votes-bar--has-votes' : '') + '" id="submit-votes-bar">' +
          '<div class="submit-votes-bar-inner">' +
            '<div class="submit-votes-counter" id="submit-votes-counter">Votes: ' + used + ' / ' + MAX_VOTES + '</div>' +
            '<p class="submit-votes-cta">' + (used > 0 ? 'Tap below to confirm and cast your vote' : 'Choose 1 project above, then tap here to submit') + '</p>' +
            '<button type="button" class="btn btn-primary btn-submit-votes" id="submit-votes-btn">Submit my votes</button>' +
          '</div>' +
        '</div>') +
      '</div>';
    render(getAppEl(), html);

    const list = document.getElementById('projects-list');
    if (list) {
      list.querySelectorAll('.project-card-thumb img[data-fallback]').forEach(function (img) {
        img.addEventListener('error', function () {
          var f = img.getAttribute('data-fallback');
          if (f) img.src = f;
        });
      });
      list.addEventListener('click', e => {
        const card = e.target.closest('.project-card');
        if (!card || card.classList.contains('disabled')) return;
        const watchBtn = e.target.closest('.watch-video');
        if (watchBtn) {
          e.preventDefault();
          e.stopPropagation();
          openVideoModal(watchBtn.getAttribute('data-video'));
          return;
        }
        const showMoreBtn = e.target.closest('.show-more-desc');
        if (showMoreBtn) {
          e.preventDefault();
          e.stopPropagation();
          const expanded = card.classList.toggle('description-expanded');
          showMoreBtn.setAttribute('aria-expanded', expanded);
          showMoreBtn.textContent = expanded ? 'Pokaż mniej' : 'Pokaż więcej';
          return;
        }
        if (e.target.closest('.description-wrap')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const projectId = card.getAttribute('data-project-id');
        toggleVote(projectId);
      });
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const card = entry.target;
          const id = card.getAttribute('data-project-id');
          if (id) recordView(id);
        });
      }, { threshold: 0.5 });
      list.querySelectorAll('.project-card').forEach(el => observer.observe(el));
    }
    document.getElementById('submit-votes-btn')?.addEventListener('click', submitVotes);
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- Results page ----------
  let resultsChart = null;

  // Mock vote/view counts for demo (used when no Firebase or empty)
  function getMockStats() {
    const ids = MOCK_PROJECTS.map(p => p.id);
    const voteCounts = {};
    const viewCounts = {};
    const uniqueDevicesByProject = {};
    ids.forEach((id, i) => {
      voteCounts[id] = [82, 67, 54, 41, 38, 28][i] || 0;
      viewCounts[id] = [140, 120, 95, 88, 80, 65][i] || 0;
      uniqueDevicesByProject[id] = [58, 48, 42, 35, 32, 25][i] || 0; // mock unique devices per project
    });
    const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
    const uniqueDevicesTotal = 120; // mock
    return { voteCounts, viewCounts, uniqueDevicesByProject, uniqueDevicesTotal, totalVotes };
  }

  function loadResults() {
    if (!db) {
      if (useLiveOnly) {
        renderResultsPage({ projects: [], voteCounts: {}, viewCounts: {} });
        return;
      }
      const { voteCounts, viewCounts } = getMockStats();
      try {
        const myVotes = JSON.parse(localStorage.getItem(MOCK_VOTES_KEY) || '[]');
        if (Array.isArray(myVotes)) {
          myVotes.forEach(function (pid) {
            voteCounts[pid] = (voteCounts[pid] || 0) + 1;
          });
        }
      } catch (e) { /* ignore */ }
      renderResultsPage({ projects: MOCK_PROJECTS.slice(), voteCounts, viewCounts });
      return;
    }
    Promise.all([
      db.collection('projects').get(),
      db.collection('votes').get(),
      db.collection('views').get()
    ]).then(([projSnap, voteSnap, viewSnap]) => {
      const projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const voteCounts = {};
      voteSnap.docs.forEach(d => { const p = d.data().projectId; voteCounts[p] = (voteCounts[p] || 0) + 1; });
      const viewCounts = {};
      viewSnap.docs.forEach(d => { const p = d.data().projectId; viewCounts[p] = (viewCounts[p] || 0) + 1; });
      const hasProjects = projects.filter(p => p.isActive !== false).length > 0;
      if (!hasProjects) {
        renderResultsPage(useLiveOnly ? { projects: [], voteCounts: {}, viewCounts: {} } : { projects: MOCK_PROJECTS.slice(), voteCounts: getMockStats().voteCounts, viewCounts: getMockStats().viewCounts });
      } else {
        renderResultsPage({ projects, voteCounts, viewCounts });
      }
    }).catch(() => {
      if (useLiveOnly) renderResultsPage({ projects: [], voteCounts: {}, viewCounts: {} });
      else {
        const mock = getMockStats();
        renderResultsPage({ projects: MOCK_PROJECTS.slice(), voteCounts: mock.voteCounts, viewCounts: mock.viewCounts });
      }
    });
  }

  function computeTieState(items) {
    const ranked = items.slice();
    if (ranked.length === 0) {
      return {
        hasTie: false,
        topVotes: 0,
        tied: [],
        hasSelectedWinner: false,
        selectedWinner: null,
        winner: null,
        rankedItems: ranked
      };
    }
    const topVotes = ranked[0].votes || 0;
    const tied = ranked.filter(p => p.votes === topVotes);
    const hasTie = tied.length > 1 && topVotes > 0;
    const selectedWinner = hasTie && tieBreakWinnerProjectId
      ? (tied.find(p => p.id === tieBreakWinnerProjectId) || null)
      : null;

    if (!selectedWinner) {
      return {
        hasTie,
        topVotes,
        tied,
        hasSelectedWinner: false,
        selectedWinner: null,
        winner: ranked[0],
        rankedItems: ranked
      };
    }

    const tiedOthers = tied.filter(p => p.id !== selectedWinner.id);
    const nonTied = ranked.filter(p => p.votes !== topVotes);
    return {
      hasTie,
      topVotes,
      tied,
      hasSelectedWinner: true,
      selectedWinner,
      winner: selectedWinner,
      rankedItems: [selectedWinner].concat(tiedOthers, nonTied)
    };
  }

  function renderResultsPage(data) {
    const { projects, voteCounts, viewCounts } = data;
    const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);

    const items = projects.filter(p => p.isActive !== false).map(p => {
      const votes = voteCounts[p.id] || 0;
      const views = viewCounts[p.id] || 0;
      const pct = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
      const engagement = views ? Math.round((votes / views) * 100) : 0;
      return {
        ...p,
        votes,
        views,
        pct,
        engagement
      };
    }).sort((a, b) => b.votes - a.votes);
    const tieState = computeTieState(items);
    const rankingItems = tieState.rankedItems;

    const listHtml = rankingItems.map(p =>
      '<div class="result-item">' +
        '<div class="name">' + escapeHtml(p.name || 'Unnamed') + '</div>' +
        '<div class="stats">Votes: ' + p.votes + '</div>' +
        '<div class="bar-wrap"><div class="bar" style="width:' + (totalVotes ? (p.votes / totalVotes * 100) : 0) + '%"></div></div>' +
      '</div>'
    ).join('');

    const totalVotesNum = Object.values(voteCounts).reduce((a, b) => a + b, 0);
    const isMock = !db;
    const heroBlocks = buildWinnerAndPodiumHtml(rankingItems, tieState);
    const tieNames = tieState.tied.map(p => escapeHtml(p.name || 'Unnamed')).join(', ');
    const tiePanelHtml = tieState.hasTie
      ? (
          '<section class="tie-break-panel">' +
            '<p class="tie-break-title">Tie detected at first place</p>' +
            '<p class="tie-break-text">Tied projects (' + tieState.topVotes + ' votes): ' + tieNames + '</p>' +
            '<div class="tie-break-actions">' +
              '<button type="button" class="btn btn-primary" id="btn-random-tie-break">Randomly pick winner</button>' +
              (tieState.hasSelectedWinner ? '<button type="button" class="btn btn-secondary" id="btn-clear-tie-break">Clear tie-break winner</button>' : '') +
            '</div>' +
          '</section>'
        )
      : '';
    const html =
      '<div class="results-page">' +
        '<div class="results-banner-wrap">' +
          '<img src="images/banner-hero.png" alt="Agent Pageant – Agentic Automation Hackathon" class="results-banner" />' +
        '</div>' +
        '<div class="container">' +
        '<div class="results-header-row">' +
          '<h1>Live results</h1>' +
          '<button type="button" class="btn btn-secondary btn-refresh-results" id="btn-refresh-results">Refresh</button>' +
        '</div>' +
        '<p class="results-mock-hint">Ranking is based on total votes only.</p>' +
        (isMock ? '<p class="results-mock-hint">' + (useLiveOnly ? 'Connect Firebase to see results.' : 'Demo data. Connect Firebase to see real-time votes.') + '</p>' : '') +
        (totalVotesNum === 0 && !isMock ? '<p class="empty-state">No votes yet. Be the first to vote!</p>' : '') +
        heroBlocks.winnerHtml +
        tiePanelHtml +
        heroBlocks.podiumHtml +
        '<div class="results-list">' + (listHtml || '<p class="empty-state">No projects yet.</p>') + '</div>' +
        '<div class="chart-container"><canvas id="results-chart"></canvas></div>' +
        '</div>' +
      '</div>';
    render(getAppEl(), html);

    document.getElementById('btn-random-tie-break')?.addEventListener('click', () => {
      if (!tieState.hasTie || tieState.tied.length === 0) return;
      const randomIdx = Math.floor(Math.random() * tieState.tied.length);
      const chosen = tieState.tied[randomIdx];
      setTieBreakWinnerProjectId(chosen.id)
        .then(() => {
          showToast('Tie-break winner selected: ' + (chosen.name || 'Unnamed'));
          loadResults();
        })
        .catch(() => showToast('Failed to save tie-break winner', 'error'));
    });

    document.getElementById('btn-clear-tie-break')?.addEventListener('click', () => {
      setTieBreakWinnerProjectId(null)
        .then(() => {
          showToast('Tie-break winner cleared');
          loadResults();
        })
        .catch(() => showToast('Failed to clear tie-break winner', 'error'));
    });

    const ctx = document.getElementById('results-chart')?.getContext('2d');
    if (ctx && typeof Chart !== 'undefined') {
      if (resultsChart) resultsChart.destroy();
      resultsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: rankingItems.map(p => (p.name || 'Unnamed').slice(0, 20)),
          datasets: [{ label: 'Votes', data: rankingItems.map(p => p.votes), backgroundColor: 'rgba(255, 107, 53, 0.8)', borderColor: '#ff6b35', borderWidth: 1 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { color: '#cbd5e1' } },
            x: { ticks: { color: '#cbd5e1', maxRotation: 45 } }
          }
        }
      });
    }
  }

  function buildWinnerAndPodiumHtml(items, tieState) {
    const state = tieState || computeTieState(items);
    const winner = state.winner;
    const winnerKicker = state.hasTie && !state.hasSelectedWinner ? 'Tie for winner' : 'Winner announcement';
    let winnerMeta = '';
    if (winner) {
      winnerMeta = 'Team: ' + escapeHtml(winner.team || '—') + ' | Votes: ' + winner.votes;
      if (state.hasTie && state.hasSelectedWinner) {
        winnerMeta += ' | Selected by random tie-break';
      }
      if (state.hasTie && !state.hasSelectedWinner) {
        winnerMeta = 'Tie at ' + state.topVotes + ' votes. Draw random winner to finalize.';
      }
    }
    const winnerHtml = winner
      ? (
          '<section class="winner-announcement">' +
            '<p class="winner-kicker">' + winnerKicker + '</p>' +
            '<h2>' + escapeHtml(winner.name || 'Unnamed') + '</h2>' +
            '<p class="winner-meta">' +
              winnerMeta +
            '</p>' +
          '</section>'
        )
      : '';
    const podiumSlots = [
      { place: '2nd', tier: 'silver', project: items[1] || null },
      { place: '1st', tier: 'gold', project: items[0] || null },
      { place: '3rd', tier: 'bronze', project: items[2] || null }
    ];
    const podiumHtml = items.length
      ? (
          '<section class="results-podium">' +
            '<h2>Top 3 podium</h2>' +
            '<div class="podium-grid">' +
              podiumSlots.map(function (slot) {
                const p = slot.project;
                return (
                  '<article class="podium-card podium-' + slot.tier + (p ? '' : ' empty') + '">' +
                    '<div class="podium-place">' + slot.place + '</div>' +
                    (p
                      ? '<div class="podium-name">' + escapeHtml(p.name || 'Unnamed') + '</div><div class="podium-votes">' + p.votes + ' votes</div>'
                      : '<div class="podium-name">—</div><div class="podium-votes">No project</div>') +
                  '</article>'
                );
              }).join('') +
            '</div>' +
          '</section>'
        )
      : '';
    return { winnerHtml, podiumHtml };
  }

  function renderPublicFinalResultsPage(data) {
    const { projects, voteCounts, isMock } = data;
    const items = projects.filter(p => p.isActive !== false).map(p => {
      const votes = voteCounts[p.id] || 0;
      return { ...p, votes };
    }).sort((a, b) => b.votes - a.votes);
    const tieState = computeTieState(items);
    const rankingItems = tieState.rankedItems;

    const heroBlocks = buildWinnerAndPodiumHtml(rankingItems, tieState);
    const listHtml = rankingItems.map(p =>
      '<div class="result-item">' +
        '<div class="name">' + escapeHtml(p.name || 'Unnamed') + '</div>' +
        '<div class="stats">Votes: ' + p.votes + '</div>' +
      '</div>'
    ).join('');

    render(getAppEl(),
      '<div class="results-page">' +
        '<div class="results-banner-wrap">' +
          '<img src="images/banner-hero.png" alt="Agent Pageant – Final results" class="results-banner" />' +
        '</div>' +
        '<div class="container">' +
          '<div class="results-header-row">' +
            '<h1>Final results</h1>' +
            (adminUnlocked ? '<a href="#/results" class="btn btn-secondary">Judge details</a>' : '') +
          '</div>' +
          '<p class="results-mock-hint">Voting ended — final winner podium. Ranking is based on total votes only.</p>' +
          (isMock ? '<p class="results-mock-hint">Demo data mode.</p>' : '') +
          heroBlocks.winnerHtml +
          heroBlocks.podiumHtml +
          '<div class="results-list">' + (listHtml || '<p class="empty-state">No projects yet.</p>') + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function loadPublicFinalResults() {
    if (!db) {
      if (useLiveOnly) {
        renderPublicFinalResultsPage({ projects: [], voteCounts: {}, isMock: true });
        return;
      }
      const mock = getMockStats();
      const voteCounts = { ...mock.voteCounts };
      try {
        const myVotes = JSON.parse(localStorage.getItem(MOCK_VOTES_KEY) || '[]');
        if (Array.isArray(myVotes)) myVotes.forEach(pid => { voteCounts[pid] = (voteCounts[pid] || 0) + 1; });
      } catch (_) {}
      renderPublicFinalResultsPage({ projects: MOCK_PROJECTS.slice(), voteCounts, isMock: true });
      return;
    }

    Promise.all([
      db.collection('projects').get(),
      db.collection('votes').get()
    ]).then(([projSnap, voteSnap]) => {
      const projects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const voteCounts = {};
      voteSnap.docs.forEach(d => {
        const pid = d.data().projectId;
        voteCounts[pid] = (voteCounts[pid] || 0) + 1;
      });
      renderPublicFinalResultsPage({ projects, voteCounts, isMock: false });
    }).catch(() => {
      renderPublicFinalResultsPage({ projects: [], voteCounts: {}, isMock: false });
    });
  }

  // ---------- Team results ----------
  function renderTeamResultsPage(payload) {
    if (!payload || payload.error) {
      render(getAppEl(),
        '<div class="results-page container">' +
          '<h1>Team results</h1>' +
          '<p class="empty-state">' + escapeHtml(payload?.error || 'Invalid team link.') + '</p>' +
        '</div>'
      );
      return;
    }

    const { teamLabel, projects, voteCounts } = payload;
    const items = projects.map(p => ({
      name: p.name || 'Unnamed',
      votes: voteCounts[p.id] || 0
    })).sort((a, b) => b.votes - a.votes);
    const total = items.reduce((sum, item) => sum + item.votes, 0);

    const rows = items.map(item =>
      '<div class="result-item">' +
        '<div class="name">' + escapeHtml(item.name) + '</div>' +
        '<div class="stats">Votes: ' + item.votes + '</div>' +
      '</div>'
    ).join('');

    render(getAppEl(),
      '<div class="results-page">' +
        '<div class="results-banner-wrap">' +
          '<img src="images/banner-hero.png" alt="Agent Pageant – Team results" class="results-banner" />' +
        '</div>' +
        '<div class="container">' +
          '<div class="results-header-row">' +
            '<h1>Team results</h1>' +
          '</div>' +
          '<p class="results-mock-hint"><strong>Team:</strong> ' + escapeHtml(teamLabel || 'Your team') + '</p>' +
          '<p class="results-mock-hint"><strong>Total votes:</strong> ' + total + '</p>' +
          '<div class="results-list">' + (rows || '<p class="empty-state">No projects for this team.</p>') + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function loadTeamResultsByToken() {
    const token = getRouteQueryParam('token');
    if (!token) {
      renderTeamResultsPage({ error: 'Missing team token in link.' });
      return;
    }

    if (!db) {
      if (adminMockProjects.length === 0) {
        MOCK_PROJECTS.forEach(p => adminMockProjects.push({ ...p }));
        const ensuredMock = ensureTeamTokens(adminMockProjects);
        adminMockProjects = ensuredMock.withTokens;
      }
      const ownProjects = adminMockProjects.filter(p => p.teamToken === token && p.isActive !== false);
      if (ownProjects.length === 0) {
        renderTeamResultsPage({ error: 'No projects found for this team link.' });
        return;
      }
      const voteCounts = {};
      const mockStats = getMockStats();
      ownProjects.forEach(p => { voteCounts[p.id] = mockStats.voteCounts[p.id] || 0; });
      try {
        const localVotes = JSON.parse(localStorage.getItem(MOCK_VOTES_KEY) || '[]');
        if (Array.isArray(localVotes)) {
          localVotes.forEach(pid => {
            if (voteCounts[pid] != null) voteCounts[pid] += 1;
          });
        }
      } catch (_) {}
      renderTeamResultsPage({ teamLabel: ownProjects[0].team || ownProjects[0].name, projects: ownProjects, voteCounts });
      return;
    }

    Promise.all([
      db.collection('projects').where('teamToken', '==', token).get(),
      db.collection('votes').get()
    ]).then(([projSnap, voteSnap]) => {
      const ownProjects = projSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.isActive !== false);
      if (ownProjects.length === 0) {
        renderTeamResultsPage({ error: 'No projects found for this team link.' });
        return;
      }
      const voteCounts = {};
      const ownIds = new Set(ownProjects.map(p => p.id));
      voteSnap.docs.forEach(d => {
        const pid = d.data().projectId;
        if (ownIds.has(pid)) voteCounts[pid] = (voteCounts[pid] || 0) + 1;
      });
      renderTeamResultsPage({ teamLabel: ownProjects[0].team || ownProjects[0].name, projects: ownProjects, voteCounts });
    }).catch(() => renderTeamResultsPage({ error: 'Failed to load team results.' }));
  }

  // ---------- Admin (mock state when no Firebase) ----------
  let adminMockProjects = [];
  let adminMockStats = { voteCounts: {}, viewCounts: {} };

  function checkAdminPassword(pwd) {
    return pwd === (CONFIG.adminPassword || 'admin');
  }

  function showAdminLogin(cb) {
    const modal = document.getElementById('admin-login-modal');
    const input = document.getElementById('admin-password');
    const btn = document.getElementById('admin-login-btn');
    if (!modal || !input || !btn) return;
    modal.hidden = false;
    input.value = '';
    input.focus();
    const tryLogin = () => {
      if (checkAdminPassword(input.value)) {
        sessionStorage.setItem(ADMIN_KEY, '1');
        adminUnlocked = true;
        modal.hidden = true;
        if (cb) cb();
      } else {
        showToast('Wrong password', 'error');
      }
    };
    btn.onclick = tryLogin;
    input.onkeydown = e => { if (e.key === 'Enter') tryLogin(); };
    modal.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', () => { modal.hidden = true; }));
  }

  function loadAdminData() {
    if (!db) {
      if (useLiveOnly) {
        adminProjectsCache = [];
        renderAdminPage({ projects: [], voteCounts: {}, viewCounts: {}, uniqueDevicesByProject: {}, uniqueDevicesTotal: 0, totalVotes: 0, liveOnlyNoDb: true });
        return;
      }
      if (adminMockProjects.length === 0) {
        MOCK_PROJECTS.forEach(p => adminMockProjects.push({ ...p }));
        adminMockStats = getMockStats();
      }
      const ensuredMock = ensureTeamTokens(adminMockProjects);
      adminMockProjects = ensuredMock.withTokens;
      adminProjectsCache = adminMockProjects.slice();
      const mock = getMockStats();
      renderAdminPage({
        projects: adminMockProjects,
        voteCounts: adminMockStats.voteCounts,
        viewCounts: adminMockStats.viewCounts,
        uniqueDevicesByProject: mock.uniqueDevicesByProject || {},
        uniqueDevicesTotal: mock.uniqueDevicesTotal || 0,
        totalVotes: mock.totalVotes || 0
      });
      return;
    }
    Promise.all([
      db.collection('projects').get(),
      db.collection('votes').get(),
      db.collection('views').get()
    ]).then(([projSnap, voteSnap, viewSnap]) => {
      const rawProjects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const ensured = ensureTeamTokens(rawProjects);
      const projects = ensured.withTokens;
      const voteCounts = {};
      const uniqueDevicesByProject = {};
      const allVoterIds = new Set();
      voteSnap.docs.forEach(d => {
        const { projectId, voterId } = d.data();
        voteCounts[projectId] = (voteCounts[projectId] || 0) + 1;
        if (!uniqueDevicesByProject[projectId]) uniqueDevicesByProject[projectId] = new Set();
        uniqueDevicesByProject[projectId].add(voterId);
        allVoterIds.add(voterId);
      });
      const viewCounts = {};
      viewSnap.docs.forEach(d => { const p = d.data().projectId; viewCounts[p] = (viewCounts[p] || 0) + 1; });
      const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
      const uniqueDevicesByProjectSizes = {};
      Object.keys(uniqueDevicesByProject).forEach(pid => { uniqueDevicesByProjectSizes[pid] = uniqueDevicesByProject[pid].size; });
      const finalize = () => {
        adminProjectsCache = projects.slice();
        renderAdminPage({
          projects,
          voteCounts,
          viewCounts,
          uniqueDevicesByProject: uniqueDevicesByProjectSizes,
          uniqueDevicesTotal: allVoterIds.size,
          totalVotes
        });
      };
      if (ensured.updates.length === 0) {
        finalize();
        return;
      }
      const batch = db.batch();
      ensured.updates.forEach(u => {
        batch.set(db.collection('projects').doc(u.id), { teamToken: u.teamToken }, { merge: true });
      });
      batch.commit().then(finalize).catch(finalize);
    }).catch(() => {
      adminProjectsCache = [];
      renderAdminPage({ projects: [], voteCounts: {}, viewCounts: {}, uniqueDevicesByProject: {}, uniqueDevicesTotal: 0, totalVotes: 0 });
    });
  }

  function renderAdminPage(data) {
    const { projects, voteCounts, viewCounts, uniqueDevicesByProject = {}, uniqueDevicesTotal = 0, totalVotes = 0, liveOnlyNoDb = false } = data;
    const votingWindow = getVotingWindowState();
    const scheduleText = (votingStartAtMs || votingEndAtMs)
      ? ('Start: ' + (votingStartAtMs ? formatDateTime(votingStartAtMs) : 'immediately') + ' | End: ' + (votingEndAtMs ? formatDateTime(votingEndAtMs) : 'no end'))
      : 'No schedule set (manual on/off only).';
    const rows = projects.map(p => {
      const votes = voteCounts[p.id] || 0;
      const views = viewCounts[p.id] || 0;
      const uniqueDevices = uniqueDevicesByProject[p.id] != null ? uniqueDevicesByProject[p.id] : votes;
      const teamLink = p.teamToken ? buildTeamResultsLink(p.teamToken) : '';
      return '<tr>' +
        '<td>' + escapeHtml(p.name || '') + '</td>' +
        '<td>' + escapeHtml(p.team || '') + '</td>' +
        '<td>' + votes + '</td>' +
        '<td>' + uniqueDevices + '</td>' +
        '<td>' + views + '</td>' +
        '<td class="admin-team-link-cell">' +
          (teamLink
            ? '<div class="admin-team-link-actions">' +
                '<a href="' + escapeAttr(teamLink) + '" target="_blank" rel="noopener">Open</a>' +
                '<button type="button" class="btn btn-secondary copy-team-link" data-id="' + escapeAttr(p.id) + '" data-link="' + escapeAttr(teamLink) + '">Copy link</button>' +
              '</div>'
            : '<span class="admin-team-link-empty">—</span>') +
        '</td>' +
        '<td class="admin-actions">' +
          '<button type="button" class="btn btn-secondary edit-project" data-id="' + escapeAttr(p.id) + '">Edit</button>' +
          '<button type="button" class="btn btn-secondary toggle-project" data-id="' + escapeAttr(p.id) + '" data-active="' + (p.isActive !== false) + '">' + (p.isActive !== false ? 'Disable' : 'Enable') + '</button>' +
          '<button type="button" class="btn btn-secondary delete-project" data-id="' + escapeAttr(p.id) + '">Delete</button>' +
        '</td></tr>';
    }).join('');

    const html =
      '<div class="admin-page container">' +
        '<h1>Admin dashboard</h1>' +
        (liveOnlyNoDb ? '<p class="results-mock-hint">Live mode: connect Firebase to manage projects and see stats.</p>' : '') +
        '<div class="admin-section admin-voting-toggle">' +
          '<h2>Voting</h2>' +
          '<p class="admin-voting-status">Voting is <strong>' + (votingWindow.allowed ? 'open' : 'closed') + '</strong>. Manual switch is <strong>' + (votingEnabled ? 'enabled' : 'disabled') + '</strong>.</p>' +
          '<p class="admin-voting-status">' + escapeHtml(scheduleText) + '</p>' +
          '<button type="button" class="btn ' + (votingEnabled ? 'btn-secondary' : 'btn-primary') + ' admin-toggle-voting" id="admin-toggle-voting">' + (votingEnabled ? 'Disable voting' : 'Enable voting') + '</button>' +
          '<p class="admin-voting-status">Funny vote animations are <strong>' + (funVoteAnimationsEnabled ? 'enabled' : 'disabled') + '</strong>.</p>' +
          '<button type="button" class="btn ' + (funVoteAnimationsEnabled ? 'btn-secondary' : 'btn-primary') + '" id="admin-toggle-fun-animations">' + (funVoteAnimationsEnabled ? 'Disable funny animations' : 'Enable funny animations') + '</button>' +
          '<div class="admin-schedule-grid">' +
            '<label for="admin-voting-start">Start date/time</label>' +
            '<input type="datetime-local" id="admin-voting-start" value="' + escapeAttr(toDatetimeInputValue(votingStartAtMs)) + '" />' +
            '<label for="admin-voting-end">End date/time</label>' +
            '<input type="datetime-local" id="admin-voting-end" value="' + escapeAttr(toDatetimeInputValue(votingEndAtMs)) + '" />' +
          '</div>' +
          '<div class="admin-schedule-actions">' +
            '<button type="button" class="btn btn-secondary" id="admin-save-schedule">Save schedule</button>' +
            '<button type="button" class="btn btn-secondary" id="admin-clear-schedule">Clear schedule</button>' +
          '</div>' +
        '</div>' +
        '<div class="admin-section admin-stats-summary">' +
          '<p class="admin-stats-line"><strong>Unique devices (voters):</strong> ' + uniqueDevicesTotal + ' &nbsp;|&nbsp; <strong>Total votes:</strong> ' + totalVotes + '</p>' +
          '<p class="admin-stats-hint">Each device can vote for 1 project. Votes are tied to device ID (localStorage).</p>' +
          (liveOnlyNoDb ? '' : '<p class="admin-stats-actions"><button type="button" class="btn btn-secondary admin-clear-votes" id="admin-clear-votes">Clear all votes in DB</button></p>') +
        '</div>' +
        '<div class="admin-section">' +
          '<h2>Projects</h2>' +
          '<div class="admin-table-wrap"><table class="admin-table">' +
            '<thead><tr><th>Project name</th><th>Team</th><th>Votes</th><th>Unique devices</th><th>Views</th><th>Team link</th><th>Actions</th></tr></thead>' +
            '<tbody id="admin-tbody">' + rows + '</tbody>' +
          '</table></div>' +
        '</div>' +
        '<div class="admin-section">' +
          '<button type="button" class="btn btn-primary" id="admin-add-project-btn">Add project</button>' +
        '</div>' +
      '</div>';
    render(getAppEl(), html);

    document.getElementById('admin-add-project-btn')?.addEventListener('click', () => {
      openProjectFormModal('add');
    });

    document.getElementById('admin-toggle-voting')?.addEventListener('click', () => {
      setVotingEnabled(!votingEnabled).then(() => {
        showToast(votingEnabled ? 'Voting enabled' : 'Voting disabled');
        loadAdminData();
      }).catch(() => showToast('Failed to update', 'error'));
    });

    document.getElementById('admin-toggle-fun-animations')?.addEventListener('click', () => {
      setFunVoteAnimationsEnabled(!funVoteAnimationsEnabled).then(() => {
        showToast(funVoteAnimationsEnabled ? 'Funny animations enabled' : 'Funny animations disabled');
        loadAdminData();
      }).catch(() => showToast('Failed to update', 'error'));
    });

    document.getElementById('admin-save-schedule')?.addEventListener('click', () => {
      const startRaw = document.getElementById('admin-voting-start')?.value || '';
      const endRaw = document.getElementById('admin-voting-end')?.value || '';
      const startMs = parseDatetimeInputValue(startRaw);
      const endMs = parseDatetimeInputValue(endRaw);
      if (startRaw && startMs == null) {
        showToast('Invalid start date/time', 'error');
        return;
      }
      if (endRaw && endMs == null) {
        showToast('Invalid end date/time', 'error');
        return;
      }
      if (startMs != null && endMs != null && startMs >= endMs) {
        showToast('End time must be later than start time', 'error');
        return;
      }
      setVotingSchedule(startMs, endMs)
        .then(() => { showToast('Voting schedule saved'); loadAdminData(); })
        .catch(() => showToast('Failed to save schedule', 'error'));
    });

    document.getElementById('admin-clear-schedule')?.addEventListener('click', () => {
      setVotingSchedule(null, null)
        .then(() => { showToast('Voting schedule cleared'); loadAdminData(); })
        .catch(() => showToast('Failed to clear schedule', 'error'));
    });

    document.getElementById('admin-clear-votes')?.addEventListener('click', () => {
      if (!confirm('Delete all votes in the database? This cannot be undone.')) return;
      const btn = document.getElementById('admin-clear-votes');
      if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
      clearAllVotesInDb()
        .then(() => { showToast('All votes cleared'); loadAdminData(); })
        .catch(() => showToast('Failed to clear votes', 'error'))
        .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Clear all votes in DB'; } });
    });

    document.getElementById('admin-tbody')?.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.copy-team-link');
      if (copyBtn) {
        const url = copyBtn.getAttribute('data-link') || '';
        if (!url) return;
        const done = () => showToast('Team link copied');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(() => showToast('Copy failed', 'error'));
        } else {
          const temp = document.createElement('textarea');
          temp.value = url;
          temp.setAttribute('readonly', '');
          temp.style.position = 'absolute';
          temp.style.left = '-9999px';
          document.body.appendChild(temp);
          temp.select();
          try {
            document.execCommand('copy');
            done();
          } catch (_) {
            showToast('Copy failed', 'error');
          }
          document.body.removeChild(temp);
        }
        return;
      }

      const id = e.target.closest('[data-id]')?.getAttribute('data-id');
      if (!id) return;
      const doc = projects.find(p => p.id === id);

      if (e.target.classList.contains('delete-project')) {
        if (!confirm('Delete this project?')) return;
        if (db) {
          db.collection('projects').doc(id).delete().then(() => { showToast('Deleted'); loadAdminData(); }).catch(() => showToast('Failed', 'error'));
        } else {
          const idx = adminMockProjects.findIndex(p => p.id === id);
          if (idx !== -1) adminMockProjects.splice(idx, 1);
          delete adminMockStats.voteCounts[id];
          delete adminMockStats.viewCounts[id];
          showToast('Deleted');
          loadAdminData();
        }
        return;
      }
      if (e.target.classList.contains('toggle-project')) {
        if (!doc) return;
        const isActive = doc.isActive !== false;
        if (db) {
          db.collection('projects').doc(id).update({ isActive: !isActive }).then(() => { showToast(isActive ? 'Disabled' : 'Enabled'); loadAdminData(); }).catch(() => showToast('Failed', 'error'));
        } else {
          doc.isActive = isActive;
          showToast(isActive ? 'Disabled' : 'Enabled');
          loadAdminData();
        }
        return;
      }
      if (e.target.classList.contains('edit-project')) {
        if (!doc) return;
        openProjectFormModal('edit', doc);
      }
    });
  }

  function openProjectFormModal(mode, project) {
    const modal = document.getElementById('project-form-modal');
    const titleEl = document.getElementById('project-form-title');
    const form = document.getElementById('project-form');
    const idInput = document.getElementById('project-form-id');
    const thumbUrlRadio = document.getElementById('project-form-thumb-type-url');
    const thumbFileRadio = document.getElementById('project-form-thumb-type-file');
    const thumbUrlInput = document.getElementById('project-form-thumbnailUrl');
    const thumbFileInput = document.getElementById('project-form-thumbnailFile');
    const thumbDataInput = document.getElementById('project-form-thumbnailDataUrl');
    if (!modal || !form) return;
    if (mode === 'edit' && project) {
      titleEl.textContent = 'Edit project';
      idInput.value = project.id;
      document.getElementById('project-form-name').value = project.name || '';
      document.getElementById('project-form-team').value = project.team || '';
      document.getElementById('project-form-description').value = project.description || '';
      document.getElementById('project-form-videoUrl').value = project.videoUrl || '';
      if (project.thumbnailDataUrl) {
        thumbFileRadio.checked = true;
        thumbDataInput.value = project.thumbnailDataUrl;
        thumbUrlInput.value = '';
        thumbFileInput.value = '';
        toggleThumbInputs('file');
        updateFormThumbPreview(project.thumbnailDataUrl);
      } else {
        thumbUrlRadio.checked = true;
        thumbUrlInput.value = project.thumbnailUrl || '';
        thumbDataInput.value = '';
        thumbFileInput.value = '';
        toggleThumbInputs('url');
        updateFormThumbPreview(project.thumbnailUrl || '');
      }
    } else {
      titleEl.textContent = 'Add project';
      idInput.value = '';
      form.reset();
      idInput.value = '';
      thumbDataInput.value = '';
      toggleThumbInputs('url');
      updateFormThumbPreview('');
    }
    modal.hidden = false;
    document.getElementById('project-form-name')?.focus();
  }

  function updateFormThumbPreview(src) {
    var wrap = document.getElementById('project-form-thumb-preview-wrap');
    var img = document.getElementById('project-form-thumb-preview');
    if (!wrap || !img) return;
    if (img._objectUrl) {
      URL.revokeObjectURL(img._objectUrl);
      img._objectUrl = null;
    }
    if (src && src.length > 0) {
      img.src = src;
      wrap.classList.add('visible');
      wrap.setAttribute('aria-hidden', 'false');
    } else {
      img.removeAttribute('src');
      wrap.classList.remove('visible');
      wrap.setAttribute('aria-hidden', 'true');
    }
  }

  function closeProjectFormModal() {
    const modal = document.getElementById('project-form-modal');
    if (modal) modal.hidden = true;
  }

  function toggleThumbInputs(type) {
    const urlWrap = document.getElementById('thumb-url-wrap');
    const fileWrap = document.getElementById('thumb-file-wrap');
    if (urlWrap) urlWrap.style.display = type === 'url' ? '' : 'none';
    if (fileWrap) fileWrap.style.display = type === 'file' ? '' : 'none';
  }

  const THUMB_DATA_URL_MAX_BYTES = 700000;
  const THUMB_MAX_WIDTH = 800;
  const THUMB_MIN_WIDTH = 200;
  const STORAGE_THUMB_PATH = 'project-thumbnails';

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.blob(); });
  }

  function uploadThumbnailToStorage(projectId, dataUrl) {
    if (typeof firebase === 'undefined' || !firebase.storage) return Promise.reject(new Error('Firebase Storage not available'));
    var storage = firebase.storage();
    var path = STORAGE_THUMB_PATH + '/' + projectId + '.jpg';
    var ref = storage.ref(path);
    return dataUrlToBlob(dataUrl).then(function (blob) {
      return ref.put(blob, { contentType: 'image/jpeg' });
    }).then(function (snapshot) {
      return snapshot.ref.getDownloadURL ? snapshot.ref.getDownloadURL() : ref.getDownloadURL();
    });
  }

  function compressImageDataUrl(dataUrl, maxBytes) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        let w = nw;
        let h = nh;
        if (w > THUMB_MAX_WIDTH) { h = Math.round((nh * THUMB_MAX_WIDTH) / nw); w = THUMB_MAX_WIDTH; }
        let lastOk = null;
        while (w >= THUMB_MIN_WIDTH) {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const c = canvas.getContext('2d');
          if (!c) break;
          c.drawImage(img, 0, 0, w, h);
          for (let q = 0.85; q >= 0.2; q -= 0.1) {
            const result = canvas.toDataURL('image/jpeg', q);
            if (result.length <= maxBytes) { lastOk = result; break; }
          }
          if (lastOk) break;
          w = Math.max(THUMB_MIN_WIDTH, Math.floor(w / 2));
          h = Math.round((nh * w) / nw);
        }
        if (lastOk) { resolve(lastOk); return; }
        var fb = document.createElement('canvas');
        fb.width = w;
        fb.height = h;
        fb.getContext('2d').drawImage(img, 0, 0, fb.width, fb.height);
        for (var qq = 0.25; qq >= 0.1; qq -= 0.05) {
          var r = fb.toDataURL('image/jpeg', qq);
          if (r.length <= maxBytes) { resolve(r); return; }
        }
        resolve(fb.toDataURL('image/jpeg', 0.1));
      };
      img.onerror = function () { reject(new Error('Nie można załadować obrazu.')); };
      img.src = dataUrl;
    });
  }

  function initProjectFormModal() {
    const modal = document.getElementById('project-form-modal');
    const form = document.getElementById('project-form');
    if (!modal || !form) return;

    function closeModal(e) {
      if (e) e.preventDefault();
      closeProjectFormModal();
    }

    document.getElementById('project-form-cancel')?.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close-modal') || e.target.closest('[data-close-modal]')) closeModal(e);
    });

    document.getElementById('project-form-thumb-type-url')?.addEventListener('change', function () { toggleThumbInputs('url'); });
    document.getElementById('project-form-thumb-type-file')?.addEventListener('change', function () { toggleThumbInputs('file'); });

    document.getElementById('project-form-thumbnailUrl')?.addEventListener('input', function () {
      if (form.querySelector('input[name="thumbType"]:checked')?.value === 'url') updateFormThumbPreview(this.value.trim() || '');
    });
    document.getElementById('project-form-thumbnailUrl')?.addEventListener('change', function () {
      if (form.querySelector('input[name="thumbType"]:checked')?.value === 'url') updateFormThumbPreview(this.value.trim() || '');
    });
    document.getElementById('project-form-thumbnailFile')?.addEventListener('change', function () {
      var file = this.files && this.files[0];
      var wrap = document.getElementById('project-form-thumb-preview-wrap');
      var img = document.getElementById('project-form-thumb-preview');
      if (!file) { updateFormThumbPreview(''); return; }
      if (!file.type.startsWith('image/')) { updateFormThumbPreview(''); return; }
      if (img && img._objectUrl) URL.revokeObjectURL(img._objectUrl);
      var url = URL.createObjectURL(file);
      if (img) { img._objectUrl = url; img.src = url; }
      if (wrap) { wrap.classList.add('visible'); wrap.setAttribute('aria-hidden', 'false'); }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const id = document.getElementById('project-form-id').value.trim();
      const name = document.getElementById('project-form-name').value.trim();
      if (!name) { showToast('Name is required', 'error'); return; }
      const thumbType = form.querySelector('input[name="thumbType"]:checked')?.value || 'url';
      let thumbnailUrl = null;
      let thumbnailDataUrl = null;
      if (thumbType === 'file') {
        const fileInput = document.getElementById('project-form-thumbnailFile');
        const dataInput = document.getElementById('project-form-thumbnailDataUrl');
        if (fileInput?.files?.length) {
          const file = fileInput.files[0];
          if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return; }
          const reader = new FileReader();
          reader.onload = function () {
            const raw = reader.result;
            compressImageDataUrl(raw, THUMB_DATA_URL_MAX_BYTES)
              .then(function (compressed) {
                saveProjectForm(id, name, null, compressed);
              })
              .catch(function (err) {
                showToast(err && err.message ? err.message : 'Obraz za duży', 'error');
              });
          };
          reader.readAsDataURL(file);
          return;
        }
        if (dataInput?.value) thumbnailDataUrl = dataInput.value;
      } else {
        thumbnailUrl = document.getElementById('project-form-thumbnailUrl').value.trim() || null;
        if (!thumbnailUrl) {
          const fileInput = document.getElementById('project-form-thumbnailFile');
          if (fileInput?.files?.length && fileInput.files[0].type.startsWith('image/')) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = function () {
              compressImageDataUrl(reader.result, THUMB_DATA_URL_MAX_BYTES)
                .then(function (compressed) { saveProjectForm(id, name, null, compressed); })
                .catch(function (err) { showToast(err && err.message ? err.message : 'Obraz za duży', 'error'); });
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      }
      saveProjectForm(id, name, thumbnailUrl, thumbnailDataUrl);
    });

    function saveProjectForm(id, name, thumbnailUrl, thumbnailDataUrl) {
      if (useLiveOnly && !db) {
        showToast('Connect Firebase to manage projects.', 'error');
        return;
      }
      const team = document.getElementById('project-form-team').value.trim();
      if (thumbnailDataUrl != null && thumbnailDataUrl.length > THUMB_DATA_URL_MAX_BYTES) {
        showToast('Obraz jest za duży. Użyj mniejszego pliku lub URL.', 'error');
        return;
      }
      const baseData = {
        name: name || '',
        team: team || '',
        description: (document.getElementById('project-form-description').value || '').trim(),
        videoUrl: (document.getElementById('project-form-videoUrl').value || '').trim() || null,
        teamToken: resolveTeamTokenForProject(id, team)
      };
      function doSave(docId, thumbUrl, thumbDataUrl, isNew) {
        var data = Object.assign({}, baseData, {
          thumbnailUrl: thumbUrl || null,
          thumbnailDataUrl: thumbDataUrl || null
        });
        if (!isNew && docId) {
          if (db) {
            db.collection('projects').doc(docId).update(data).then(() => { showToast('Updated'); closeProjectFormModal(); loadAdminData(); }).catch(function (err) { showToast(err && err.message ? err.message : 'Failed', 'error'); });
          } else {
            var proj = adminMockProjects.find(function (p) { return p.id === docId; });
            if (proj) {
              proj.name = data.name;
              proj.team = data.team;
              proj.description = data.description;
              proj.videoUrl = data.videoUrl;
              proj.thumbnailUrl = data.thumbnailUrl;
              proj.thumbnailDataUrl = data.thumbnailDataUrl;
            }
            showToast('Updated');
            closeProjectFormModal();
            loadAdminData();
          }
          return;
        }
        if (db) {
          var newId = docId || ('proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
          db.collection('projects').doc(newId).set(Object.assign({}, data, { createdAt: firebase.firestore.FieldValue.serverTimestamp(), isActive: true })).then(() => { showToast('Project added'); closeProjectFormModal(); loadAdminData(); }).catch(function (err) { showToast(err && err.message ? err.message : 'Failed to add', 'error'); });
        } else {
          var mockId = 'mock-' + Date.now();
          adminMockProjects.push({ id: mockId, ...data, isActive: true });
          adminMockStats.voteCounts[mockId] = 0;
          adminMockStats.viewCounts[mockId] = 0;
          showToast('Project added');
          closeProjectFormModal();
          loadAdminData();
        }
      }
      var isNew = !id;
      if (db && thumbnailDataUrl && typeof firebase !== 'undefined' && firebase.storage) {
        var projectId = id || ('proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
        uploadThumbnailToStorage(projectId, thumbnailDataUrl)
          .then(function (url) { doSave(projectId, url, null, isNew); })
          .catch(function (err) {
            showToast(err && err.message ? err.message : 'Upload miniatury nie powiódł się', 'error');
          });
        return;
      }
      doSave(id, thumbnailUrl, thumbnailDataUrl, isNew);
    }
  }

  // ---------- Routes ----------
  router.on('/vote', function () {
    Promise.all([loadProjects(), loadMyVotes(), loadVotingConfig()])
      .then(() => renderVotePage())
      .catch(function (err) {
        console.error('Vote page load error:', err);
        renderVotePage();
      });
  });

  router.on('/results', function () {
    loadVotingConfig().then(() => {
      const votingState = getVotingWindowState();
      if (!adminUnlocked) {
        if (votingState.reason === 'ended') {
          loadPublicFinalResults();
          return;
        }
        render(getAppEl(),
          '<div class="results-page container">' +
            '<h1>Results</h1>' +
            '<p class="results-mock-hint">Global results are available for judges only. Teams should use their dedicated team link.</p>' +
            '<button type="button" class="btn btn-secondary" id="btn-open-results-login">Judge login</button>' +
          '</div>'
        );
        document.getElementById('btn-open-results-login')?.addEventListener('click', function () {
          showAdminLogin(() => {
            document.querySelector('.nav-link.admin-link')?.classList.add('visible');
            loadResults();
          });
        });
        return;
      }
      loadResults();
    }).catch(() => {
      if (adminUnlocked) loadResults();
      else render(getAppEl(), '<div class="results-page container"><p class="empty-state">Failed to load results.</p></div>');
    });
  });

  router.on('/final-results', function () {
    loadVotingConfig().then(() => {
      const votingState = getVotingWindowState();
      if (votingState.reason !== 'ended' && !adminUnlocked) {
        render(getAppEl(),
          '<div class="results-page container">' +
            '<h1>Final results</h1>' +
            '<p class="results-mock-hint">Final podium is available after voting ends.</p>' +
          '</div>'
        );
        return;
      }
      loadPublicFinalResults();
    }).catch(() => {
      render(getAppEl(), '<div class="results-page container"><p class="empty-state">Failed to load final results.</p></div>');
    });
  });

  router.on('/team', function () {
    loadTeamResultsByToken();
  });

  router.on('/admin', function () {
    if (!adminUnlocked) {
      showAdminLogin(() => {
        document.querySelector('.nav-link.admin-link')?.classList.add('visible');
        loadVotingConfig().then(loadAdminData);
      });
    } else {
      loadVotingConfig().then(loadAdminData);
    }
  });

  function initNavAdminLink() {
    const adminLink = document.querySelector('a[href="#/admin"]');
    if (adminLink) {
      adminLink.classList.add('admin-link');
      if (adminUnlocked) adminLink.classList.add('visible');
    }
  }

  function boot() {
    initVideoModal();
    initProjectFormModal();
    initNavAdminLink();
    backfillExistingTeamTokens();
    var appEl = document.getElementById('app');
    if (appEl) {
      appEl.addEventListener('click', function (e) {
        var btn = e.target.id === 'btn-refresh-results' ? e.target : e.target.closest && e.target.closest('#btn-refresh-results');
        if (btn) {
          e.preventDefault();
          showToast('Loading…');
          loadResults();
        }
      });
    }
    if (!window.location.hash) window.location.hash = '/vote';
    router.init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
