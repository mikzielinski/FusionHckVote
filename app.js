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
  const MAX_VOTES = 1;
  const ADMIN_KEY = 'fusionAdminUnlocked';
  const CONFIG_DOC = 'app';

  let db = null;
  let adminUnlocked = sessionStorage.getItem(ADMIN_KEY) === '1';
  let votingEnabled = true;
  let votingStartAtMs = null;
  let votingEndAtMs = null;
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
      return Promise.resolve();
    }
    return db.collection('config').doc(CONFIG_DOC).get()
      .then(doc => {
        if (!doc.exists) {
          votingEnabled = true;
          votingStartAtMs = null;
          votingEndAtMs = null;
          return;
        }
        const data = doc.data() || {};
        votingEnabled = data.votingEnabled !== false;
        votingStartAtMs = parseConfigDateValue(data.votingStartAt);
        votingEndAtMs = parseConfigDateValue(data.votingEndAt);
      })
      .catch(() => {
        votingEnabled = true;
        votingStartAtMs = null;
        votingEndAtMs = null;
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

  function loadProjects() {
    if (!db) {
      voteState.projects = useLiveOnly ? [] : MOCK_PROJECTS.slice();
      return Promise.resolve();
    }
    return db.collection('projects')
      .get()
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fromDb = list
          .filter(p => p.isActive !== false)
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        voteState.projects = fromDb.length > 0 ? fromDb : (useLiveOnly ? [] : MOCK_PROJECTS.slice());
      })
      .catch(() => { voteState.projects = useLiveOnly ? [] : MOCK_PROJECTS.slice(); });
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
        voteState.myVotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
      removeVoteInFirestore(projectId);
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
    addVoteInFirestore(projectId);
  }

  function addVoteInFirestore(projectId) {
    if (!db) {
      if (!useLiveOnly) localStorage.setItem(MOCK_VOTES_KEY, JSON.stringify([...voteState.selected]));
      else showToast('Connect Firebase to save votes.', 'error');
      return;
    }
    const voterId = getVoterId();
    db.collection('votes').add({
      voteId: 'vote_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      projectId,
      voterId,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => loadMyVotes().then(() => renderVotePage()))
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
    if (voteState.selected.size === 0) {
      showToast('Select one project to vote.', 'error');
      return;
    }
    showToast('Vote saved. You can change it anytime.', 'success');
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
    const warning = document.getElementById('vote-warning');
    if (warning) warning.classList.toggle('visible', false);

    const cards = voteState.projects.map(p => {
      const voted = voteState.selected.has(p.id);
      const desc = (p.description || '').slice(0, 120) + ((p.description || '').length > 120 ? '…' : '');
      const thumbSrc = p.thumbnailDataUrl || p.thumbnailUrl || '';
      const thumbHtml = thumbSrc
        ? '<div class="project-card-thumb"><img src="' + escapeAttr(thumbSrc) + '" alt="" loading="lazy" /></div>'
        : '';
      const videoBtn = p.videoUrl
        ? '<button type="button" class="watch-video" data-video="' + escapeAttr(p.videoUrl) + '">Watch demo</button>'
        : '';
      const cardDisabled = votingClosed || p.isActive === false;
      return (
        '<article class="project-card' + (voted ? ' voted' : '') + (cardDisabled ? ' disabled' : '') + (votingClosed ? ' voting-closed' : '') + '" data-project-id="' + escapeAttr(p.id) + '" data-project-name="' + escapeAttr(p.name || '') + '">' +
          thumbHtml +
          '<div class="project-card-body">' +
          '<div class="name">' + escapeHtml(p.name || 'Unnamed') + '</div>' +
          (p.team ? '<div class="team">' + escapeHtml(p.team) + '</div>' : '') +
          (desc ? '<div class="description">' + escapeHtml(desc) + '</div>' : '') +
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
          (votingClosed ? '<div class="vote-closed-banner"><p>' + escapeHtml(closedBanner.title) + '</p><p class="vote-closed-hint">' + escapeHtml(closedBanner.hint) + '</p></div>' : '') +
          '<h1>UiPath Fusion</h1>' +
          '<p class="subtitle">Public Choice Award</p>' +
          '<p class="vote-instructions">' + (votingClosed ? 'You can view projects below.' : 'Vote for 1 project. You can change your vote anytime.') + '</p>' +
          (votingClosed ? '' : '<div class="' + counterClass + '" id="vote-counter">Votes used: ' + used + ' / ' + MAX_VOTES + '</div>') +
          (votingClosed ? '' : '<p class="vote-warning" id="vote-warning">You can vote for only 1 project. Remove current vote to choose another.</p>') +
        '</header>' +
        '<div class="projects-list" id="projects-list">' + (cards || (useLiveOnly && !db ? '<p class="empty-state">Connect Firebase to load projects.</p>' : '<p class="empty-state">No projects yet. Check back later.</p>')) + '</div>' +
        '</div>' +
        (votingClosed ? '' : '<div class="submit-votes-bar' + (used > 0 ? ' submit-votes-bar--has-votes' : '') + '" id="submit-votes-bar">' +
          '<div class="submit-votes-bar-inner">' +
            '<div class="submit-votes-counter" id="submit-votes-counter">Votes: ' + used + ' / ' + MAX_VOTES + '</div>' +
            '<p class="submit-votes-cta">' + (used > 0 ? 'Tap below to confirm your vote' : 'Choose 1 project, then confirm') + '</p>' +
            '<button type="button" class="btn btn-primary btn-submit-votes" id="submit-votes-btn">Submit my votes</button>' +
          '</div>' +
        '</div>') +
      '</div>';
    render(getAppEl(), html);

    const list = document.getElementById('projects-list');
    if (list) {
      list.addEventListener('click', e => {
        const card = e.target.closest('.project-card');
        if (!card || card.classList.contains('disabled')) return;
        if (e.target.classList.contains('watch-video')) {
          e.preventDefault();
          e.stopPropagation();
          openVideoModal(e.target.getAttribute('data-video'));
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

    const listHtml = items.map(p =>
      '<div class="result-item">' +
        '<div class="name">' + escapeHtml(p.name || 'Unnamed') + '</div>' +
        '<div class="stats">Votes: ' + p.votes + ' — Views: ' + p.views + ' — Vote rate: ' + p.pct + '% — Engagement: ' + p.engagement + '%</div>' +
        '<div class="bar-wrap"><div class="bar" style="width:' + (totalVotes ? (p.votes / totalVotes * 100) : 0) + '%"></div></div>' +
      '</div>'
    ).join('');

    const totalVotesNum = Object.values(voteCounts).reduce((a, b) => a + b, 0);
    const isMock = !db;
    const winner = items[0] || null;
    const winnerHtml = winner
      ? (
          '<section class="winner-announcement">' +
            '<p class="winner-kicker">Winner announcement</p>' +
            '<h2>' + escapeHtml(winner.name || 'Unnamed') + '</h2>' +
            '<p class="winner-meta">' +
              'Team: ' + escapeHtml(winner.team || '—') + ' | Votes: ' + winner.votes + ' | Share: ' + winner.pct + '%' +
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
        (isMock ? '<p class="results-mock-hint">' + (useLiveOnly ? 'Connect Firebase to see results.' : 'Demo data. Connect Firebase to see real-time votes.') + '</p>' : '') +
        (totalVotesNum === 0 && !isMock ? '<p class="empty-state">No votes yet. Be the first to vote!</p>' : '') +
        winnerHtml +
        podiumHtml +
        '<div class="results-list">' + (listHtml || '<p class="empty-state">No projects yet.</p>') + '</div>' +
        '<div class="chart-container"><canvas id="results-chart"></canvas></div>' +
        '</div>' +
      '</div>';
    render(getAppEl(), html);

    const ctx = document.getElementById('results-chart')?.getContext('2d');
    if (ctx && typeof Chart !== 'undefined') {
      if (resultsChart) resultsChart.destroy();
      resultsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: items.map(p => (p.name || 'Unnamed').slice(0, 20)),
          datasets: [{ label: 'Votes', data: items.map(p => p.votes), backgroundColor: 'rgba(255, 107, 53, 0.8)', borderColor: '#ff6b35', borderWidth: 1 }]
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
      } else {
        thumbUrlRadio.checked = true;
        thumbUrlInput.value = project.thumbnailUrl || '';
        thumbDataInput.value = '';
        thumbFileInput.value = '';
        toggleThumbInputs('url');
      }
    } else {
      titleEl.textContent = 'Add project';
      idInput.value = '';
      form.reset();
      idInput.value = '';
      thumbDataInput.value = '';
      toggleThumbInputs('url');
    }
    modal.hidden = false;
    document.getElementById('project-form-name')?.focus();
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
            thumbnailDataUrl = reader.result;
            saveProjectForm(id, name, thumbnailUrl, thumbnailDataUrl);
          };
          reader.readAsDataURL(file);
          return;
        }
        if (dataInput?.value) thumbnailDataUrl = dataInput.value;
      } else {
        thumbnailUrl = document.getElementById('project-form-thumbnailUrl').value.trim() || null;
      }
      saveProjectForm(id, name, thumbnailUrl, thumbnailDataUrl);
    });

    function saveProjectForm(id, name, thumbnailUrl, thumbnailDataUrl) {
      if (useLiveOnly && !db) {
        showToast('Connect Firebase to manage projects.', 'error');
        return;
      }
      const team = document.getElementById('project-form-team').value.trim();
      const data = {
        name,
        team,
        description: document.getElementById('project-form-description').value.trim(),
        videoUrl: document.getElementById('project-form-videoUrl').value.trim() || null,
        thumbnailUrl: thumbnailUrl || null,
        thumbnailDataUrl: thumbnailDataUrl || null,
        teamToken: resolveTeamTokenForProject(id, team)
      };
      if (id) {
        if (db) {
          db.collection('projects').doc(id).update(data).then(() => { showToast('Updated'); closeProjectFormModal(); loadAdminData(); }).catch(() => showToast('Failed', 'error'));
        } else {
          const proj = adminMockProjects.find(p => p.id === id);
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
      } else {
        if (db) {
          db.collection('projects').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp(), isActive: true }).then(() => { showToast('Project added'); closeProjectFormModal(); loadAdminData(); }).catch(() => showToast('Failed to add', 'error'));
        } else {
          const newId = 'mock-' + Date.now();
          adminMockProjects.push({ id: newId, ...data, isActive: true });
          adminMockStats.voteCounts[newId] = 0;
          adminMockStats.viewCounts[newId] = 0;
          showToast('Project added');
          closeProjectFormModal();
          loadAdminData();
        }
      }
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
    if (!adminUnlocked) {
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
