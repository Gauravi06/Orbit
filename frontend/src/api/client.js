/**
 * API client for Orbit.
 *
 * When VITE_USE_MOCK=true (set in .env), all calls go to the in-memory mock
 * layer so the demo works without a backend. When false, real axios calls
 * go to the FastAPI server.
 *
 * Every exported function has the same signature regardless of mode.
 */

import axios from 'axios';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

/* ---------- Real HTTP client ---------- */
const http = axios.create({ baseURL: 'http://localhost:8000' });

http.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('orbit_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch { /* ignore */ }
  return config;
});

http.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401) {
      try { localStorage.removeItem('orbit_token'); } catch { /* ignore */ }
      window.location.href = '/login';
    }
    return Promise.reject(e);
  }
);

/* ---------- Error text helper ---------- */
export { errText } from './errText.js';

/* ---------- Lazy-load mock module ---------- */
let _mock = null;
async function mock() {
  if (!_mock) _mock = await import('./mock.js');
  return _mock;
}

/* ---------- Auth ---------- */

export async function login({ email, password }) {
  if (USE_MOCK) {
    const m = await mock();
    return m.login({ email, password });
  }
  const { data } = await http.post('/auth/login', { email, password });
  return data;
}

export async function signup({ name, email, password }) {
  if (USE_MOCK) {
    const m = await mock();
    return m.signup({ name, email, password });
  }
  await http.post('/auth/signup', { name, email, password });
  const { data } = await http.post('/auth/login', { email, password });
  return data;
}

export async function getMe() {
  if (USE_MOCK) {
    const m = await mock();
    return m.getMe();
  }
  const { data } = await http.get('/auth/me');
  return data;
}

/* ---------- Tasks ---------- */

export async function getTasks() {
  if (USE_MOCK) {
    const m = await mock();
    return m.getTasks();
  }
  const { data } = await http.get('/tasks');
  return data;
}

export async function createTask(taskData) {
  if (USE_MOCK) {
    const m = await mock();
    return m.createTask(taskData);
  }
  const { data } = await http.post('/tasks', taskData);
  return data;
}

export async function updateTask(taskId, updates) {
  if (USE_MOCK) {
    const m = await mock();
    return m.updateTask(taskId, updates);
  }
  const { data } = await http.patch(`/tasks/${taskId}`, updates);
  return data;
}

export async function deleteTask(taskId) {
  if (USE_MOCK) {
    const m = await mock();
    return m.deleteTask(taskId);
  }
  const { data } = await http.delete(`/tasks/${taskId}`);
  return data;
}

/* ---------- Schedule ---------- */

function _mergeFixedIntoItems(match) {
  if (!match) return match;
  const existingItems = match.items || [];
  const fixedItems = (match.fixed || []).map((b) => ({
    id: `fixed-${b.title}-${b.start}`,
    title: b.title,
    start_time: b.start,
    end_time: b.end,
    is_fixed: true,
    kind: 'fixed',
    tier: 'need_to',
    status: 'scheduled',
    done: false,
  }));

  const seenTitles = new Set(existingItems.filter((i) => i.is_fixed).map((i) => (i.title || '').toLowerCase()));
  const seen = new Set(existingItems.map((i) => `${(i.title || '').toLowerCase()}-${i.start_time}`));
  const merged = [...existingItems];
  for (const fi of fixedItems) {
    const key = `${fi.title.toLowerCase()}-${fi.start_time}`;
    if (!seen.has(key) && !seenTitles.has(fi.title.toLowerCase())) {
      merged.push(fi);
      seen.add(key);
      seenTitles.add(fi.title.toLowerCase());
    }
  }
  merged.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  return {
    ...match,
    items: merged,
  };
}

export async function getSchedule(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.getSchedule(date);
  }
  const params = date ? { date } : {};
  const { data } = await http.get('/schedules', { params });
  if (data && Array.isArray(data.days)) {
    const targetDateStr = date || new Date().toISOString().split('T')[0];
    const match = data.days.find((d) => d.date === targetDateStr) || data.days[0];
    if (match) {
      const mergedMatch = _mergeFixedIntoItems(match);
      return {
        ...mergedMatch,
        at_risk: data.at_risk || [],
        violations: data.violations || [],
      };
    }
  }
  return data;
}

export async function generateSchedule(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.generateSchedule(date);
  }
  const { data } = await http.post('/schedules/generate', { date });
  if (data && data.violations && data.violations.length > 0) {
    const err = new Error(`Schedule generation produced violations: ${data.violations.join('; ')}`);
    err.response = { status: 422, data: { detail: data.violations } };
    throw err;
  }
  if (data && Array.isArray(data.days)) {
    const targetDateStr = date || new Date().toISOString().split('T')[0];
    const match = data.days.find((d) => d.date === targetDateStr) || data.days[0];
    if (match) {
      const mergedMatch = _mergeFixedIntoItems(match);
      return {
        ...mergedMatch,
        at_risk: data.at_risk || [],
        violations: data.violations || [],
      };
    }
  }
  return data;
}

/* ---------- Checkboxes & Day Closing ---------- */

export async function setItemDone(itemId, done) {
  if (USE_MOCK) {
    const m = await mock();
    return m.setItemDone(itemId, done);
  }
  const { data } = await http.patch(`/schedules/items/${itemId}/done`, { done });
  return data;
}

export async function closeDay(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.closeDay(date);
  }
  const { data } = await http.post('/schedules/close-day', { date });
  return data;
}

export async function reopenDay(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.reopenDay(date);
  }
  const { data } = await http.post('/schedules/reopen-day', { date });
  return data;
}

export async function checkUnclosedPastDay() {
  if (USE_MOCK) {
    const m = await mock();
    return m.checkUnclosedPastDay();
  }
  const { data } = await http.get('/schedules/unclosed-check');
  return data;
}

/* ---------- Week Spread ---------- */

export async function getWeekSpread(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.getWeekSpread(date);
  }
  const { data } = await http.get('/schedules/week', { params: { date } });
  return data;
}

/* ---------- Re-planning ---------- */

export async function replanSchedule(payload) {
  if (USE_MOCK) {
    const m = await mock();
    return m.replanSchedule(payload);
  }
  const { data } = await http.post('/schedules/replan', payload);
  return data;
}

export async function checkNoteVague(text) {
  if (USE_MOCK) {
    const m = await mock();
    return m.checkNoteVague(text);
  }
  return false;
}

/* ---------- Disruption ---------- */

export async function disrupt(text, date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.disrupt(text, date);
  }
  const { data } = await http.post('/schedules/disrupt-text', { text, date });
  return data;
}

/* ---------- Proposals ---------- */

export async function proposeSchedule(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.proposeSchedule(date);
  }
  const { data } = await http.post('/schedules/propose', date ? { date } : {});
  return data;
}

export async function proposeDisruption(text, date, selectedOption) {
  if (USE_MOCK) {
    const m = await mock();
    return m.proposeDisruption(text, date, selectedOption);
  }
  const { data } = await http.post('/schedules/propose', { text, date, selected_option: selectedOption });
  return data;
}

export async function approveProposal(proposalId) {
  if (USE_MOCK) {
    const m = await mock();
    return m.approveProposal(proposalId);
  }
  const { data } = await http.post(`/schedules/proposals/${proposalId}/approve`);
  return data;
}

export async function rejectProposal(proposalId) {
  if (USE_MOCK) {
    const m = await mock();
    return m.rejectProposal(proposalId);
  }
  const { data } = await http.post(`/schedules/proposals/${proposalId}/reject`);
  return data;
}


export async function sendFeedback(text) {
  if (USE_MOCK) {
    const m = await mock();
    return m.sendFeedback(text);
  }
  const { data } = await http.post('/feedback', { text });
  return data;
}

/* ---------- Notes / Tell Orbit Anything ---------- */

export async function sendNote(text) {
  if (USE_MOCK) {
    const m = await mock();
    return m.sendNote(text);
  }
  const { data } = await http.post('/notes/understand', { text });
  return data;
}

export async function saveNote({ text, kind, rating }) {
  if (USE_MOCK) {
    const m = await mock();
    return m.saveNote({ text, kind, rating });
  }
  const { data } = await http.post('/notes', { text, kind, rating });
  return data;
}

export async function resetDemo() {
  if (USE_MOCK) {
    const m = await mock();
    m.resetDemoState();
    return { success: true };
  }
  return { success: true };
}

/* ---------- Preferences ---------- */

export async function getPreferences() {
  if (USE_MOCK) {
    const m = await mock();
    return m.getPreferences();
  }
  const { data } = await http.get('/preferences');
  return data;
}

export async function savePreferences(prefs) {
  if (USE_MOCK) {
    const m = await mock();
    return m.savePreferences(prefs);
  }
  const { data } = await http.put('/preferences', prefs);
  return data;
}

export async function saveOnboarding(answers) {
  if (USE_MOCK) {
    const m = await mock();
    return m.saveOnboarding(answers);
  }
  const { data } = await http.post('/onboarding', answers);
  return data;
}

export async function seedDemoStudent() {
  if (USE_MOCK) {
    const m = await mock();
    return m.seedDemoStudent();
  }
  return null;
}

export async function getInsights() {
  if (USE_MOCK) {
    const m = await mock();
    return m.getInsights();
  }
  return [];
}

export async function submitInsightFeedback(insightId, feedbackType) {
  if (USE_MOCK) {
    const m = await mock();
    return m.submitInsightFeedback(insightId, feedbackType);
  }
  return null;
}

/* ---------- Interventions ---------- */

export async function getInterventions(status = 'active') {
  if (USE_MOCK) {
    const m = await mock();
    return m.getInterventions(status);
  }
  const { data } = await http.get('/interventions', { params: { status } });
  return data;
}

export async function dismissIntervention(interventionId) {
  if (USE_MOCK) {
    const m = await mock();
    return m.dismissIntervention(interventionId);
  }
  const { data } = await http.post(`/interventions/${interventionId}/dismiss`);
  return data;
}

export async function snoozeIntervention(interventionId, snoozeUntil) {
  if (USE_MOCK) {
    const m = await mock();
    return m.snoozeIntervention(interventionId, snoozeUntil);
  }
  const { data } = await http.post(`/interventions/${interventionId}/snooze`, {
    snooze_until: snoozeUntil,
  });
  return data;
}

/* ---------- Semantic NLP Parser ---------- */
export { parseTaskSemantics, parseTaskSemanticsAsync, parseDeadline, extractCleanTitle } from './semanticParser';

