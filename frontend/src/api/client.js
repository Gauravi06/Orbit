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
export function errText(e) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join(' | ');
  if (typeof e === 'object' && e.response?.data?.detail) return String(e.response.data.detail);
  if (!e?.response && e?.message) return e.message;
  return 'Something went wrong. Please try again.';
}

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

/* ---------- Schedule ---------- */

export async function getSchedule(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.getSchedule(date);
  }
  const params = date ? { date } : {};
  const { data } = await http.get('/schedules', { params });
  return data;
}

export async function generateSchedule(date) {
  if (USE_MOCK) {
    const m = await mock();
    return m.generateSchedule(date);
  }
  const { data } = await http.post('/schedules/generate', { date });
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

/* ---------- Feedback ---------- */

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
