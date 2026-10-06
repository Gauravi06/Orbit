/**
 * Mock API layer for Orbit.
 *
 * Provides realistic fake data so the full demo works without a backend.
 * Every function returns a Promise that resolves after a 600-900ms delay
 * to make loading states visible.
 *
 * Shape contracts match the FastAPI backend exactly.
 */

/* ---------- helpers ---------- */
let _id = 1000;
const uid = () => ++_id;
const delay = (ms) => new Promise((r) => setTimeout(r, ms !== undefined ? ms : 300 + Math.random() * 200));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d, h, m = 0) =>
  `${ymd(d)}T${pad(h)}:${pad(m)}:00`;

function todayDate() {
  return new Date();
}

function addDays(d, n) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

const today = todayDate();
const friday = (() => {
  const d = new Date();
  const diff = 5 - d.getDay();
  d.setDate(d.getDate() + (diff <= 0 ? diff + 7 : diff));
  return d;
})();

/* ---------- Seed Tasks ---------- */
const INITIAL_TASKS = [
  {
    id: 101, title: 'Classes', category: 'academic', task_type: 'fixed',
    tier: 'have_to', deadline: isoTime(today, 9), estimated_duration: 420, priority: 3,
    status: 'scheduled', is_fixed: true,
  },
  {
    id: 102, title: 'Gym', category: 'health', task_type: 'fixed',
    tier: 'have_to', deadline: isoTime(today, 18), estimated_duration: 60, priority: 3,
    status: 'scheduled', is_fixed: true,
  },
  {
    id: 103, title: 'DSA Practice', category: 'academic', task_type: 'growth',
    tier: 'need_to', deadline: null, estimated_duration: 90, priority: 4,
    status: 'pending', is_fixed: false,
  },
  {
    id: 104, title: 'DBMS Assignment', category: 'academic', task_type: 'deadline',
    tier: 'have_to', deadline: isoTime(friday, 23, 59), estimated_duration: 120, priority: 5,
    status: 'pending', is_fixed: false,
  },
  {
    id: 105, title: 'Maths Revision', category: 'academic', task_type: 'growth',
    tier: 'need_to', deadline: null, estimated_duration: 60, priority: 2,
    status: 'pending', is_fixed: false,
  },
  {
    id: 106, title: 'Guitar Practice', category: 'hobby', task_type: 'growth',
    tier: 'like_to', deadline: null, estimated_duration: 45, priority: 2,
    status: 'pending', is_fixed: false,
  },
];

const DSA_ID = 103;
const DBMS_ID = 104;
const MATHS_ID = 105;
const GUITAR_ID = 106;

function buildScheduleItems(dateObj, version) {
  const date = ymd(dateObj);
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

  const items = [
    // Sleep (shown as context)
    {
      id: uid(), task_id: null, title: 'Sleep',
      kind: 'fixed', tier: 'have_to',
      start_time: isoTime(dateObj, 0), end_time: isoTime(dateObj, 7),
      status: 'scheduled', is_fixed: true, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
  ];

  if (!isWeekend) {
    items.push({
      id: uid(), task_id: null, title: 'Classes',
      kind: 'fixed', tier: 'have_to',
      start_time: isoTime(dateObj, 9), end_time: isoTime(dateObj, 16),
      status: 'scheduled', is_fixed: true, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    });
  }

  items.push(
    // Deep work: DSA
    {
      id: uid(), task_id: DSA_ID, title: 'DSA Practice',
      kind: 'deep', tier: 'need_to',
      start_time: isoTime(dateObj, 16, 15), end_time: isoTime(dateObj, 17, 45),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
    // Gym
    {
      id: uid(), task_id: null, title: 'Gym',
      kind: 'fixed', tier: 'have_to',
      start_time: isoTime(dateObj, 18), end_time: isoTime(dateObj, 19),
      status: 'scheduled', is_fixed: true, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
    // Break
    {
      id: uid(), task_id: null, title: 'Dinner & Rest',
      kind: 'break', tier: 'like_to',
      start_time: isoTime(dateObj, 19), end_time: isoTime(dateObj, 19, 45),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
    // DBMS session
    {
      id: uid(), task_id: DBMS_ID, title: 'DBMS Assignment',
      kind: 'deep', tier: 'have_to',
      start_time: isoTime(dateObj, 19, 45), end_time: isoTime(dateObj, 21, 15),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
    // Guitar (protected hobby time)
    {
      id: uid(), task_id: GUITAR_ID, title: 'Guitar Practice',
      kind: 'short', tier: 'like_to',
      start_time: isoTime(dateObj, 21, 15), end_time: isoTime(dateObj, 22),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
    // Decompression
    {
      id: uid(), task_id: null, title: 'Wind Down',
      kind: 'decompression', tier: 'like_to',
      start_time: isoTime(dateObj, 22), end_time: isoTime(dateObj, 22, 30),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    },
    // Maths (short session)
    {
      id: uid(), task_id: MATHS_ID, title: 'Maths Revision',
      kind: 'short', tier: 'need_to',
      start_time: isoTime(dateObj, 22, 30), end_time: isoTime(dateObj, 23, 15),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    }
  );

  return {
    id: uid(),
    date,
    version: version || 1,
    is_closed: false,
    closed_at: null,
    items,
  };
}

/* ---------- Seed Past Days Data (For Week page in Demo) ---------- */
function buildSeedPastDays() {
  const pastList = [];
  // Build days for the current week or preceding 3 days
  const now = new Date();
  const currentDayOfWeek = now.getDay(); // 0 Sun, 1 Mon ...
  const monDiff = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
  const monday = addDays(now, monDiff);

  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const isPast = d < new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const sched = buildScheduleItems(d, 1);
    if (isPast) {
      sched.is_closed = true;
      sched.closed_at = isoTime(d, 23, 30);
      // Mark items as done or moved for demo realism
      sched.items.forEach((item, idx) => {
        if (!item.is_fixed) {
          if (idx % 4 === 0) {
            item.done = false;
            item.status = 'displaced';
            item.displacement_reason = `Left from ${d.toLocaleDateString('en-US', { weekday: 'long' })}, so I put it here.`;
          } else {
            item.done = true;
          }
        }
      });
    }
    pastList.push(sched);
  }
  return pastList;
}

/* ---------- LocalStorage Persistence ---------- */
const STORAGE_KEY_TASKS = 'orbit_mock_tasks';
const STORAGE_KEY_SCHEDULES = 'orbit_mock_schedules';
const STORAGE_KEY_PREFS = 'orbit_mock_preferences';
const STORAGE_KEY_ONBOARDED = 'orbit_mock_onboarded';
const STORAGE_KEY_NOTES = 'orbit_mock_notes';

function loadStoredState() {
  let loadedTasks = null;
  let loadedSchedules = null;
  let loadedPrefs = null;
  let loadedOnboarded = null;

  try {
    const rawTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (rawTasks) loadedTasks = JSON.parse(rawTasks);
  } catch { /* ignore */ }

  try {
    const rawSchedules = localStorage.getItem(STORAGE_KEY_SCHEDULES);
    if (rawSchedules) loadedSchedules = JSON.parse(rawSchedules);
  } catch { /* ignore */ }

  try {
    const rawPrefs = localStorage.getItem(STORAGE_KEY_PREFS);
    if (rawPrefs) loadedPrefs = JSON.parse(rawPrefs);
  } catch { /* ignore */ }

  try {
    const rawOnboarded = localStorage.getItem(STORAGE_KEY_ONBOARDED);
    if (rawOnboarded !== null) loadedOnboarded = JSON.parse(rawOnboarded);
  } catch { /* ignore */ }

  const fallbackSchedules = buildSeedPastDays();
  // Ensure today and tomorrow exist in fallbackSchedules
  const todayStr = ymd(todayDate());
  if (!fallbackSchedules.some((s) => s.date === todayStr)) {
    fallbackSchedules.push(buildScheduleItems(todayDate(), 1));
  }
  const tomStr = ymd(addDays(todayDate(), 1));
  if (!fallbackSchedules.some((s) => s.date === tomStr)) {
    fallbackSchedules.push(buildScheduleItems(addDays(todayDate(), 1), 1));
  }

  return {
    tasks: loadedTasks || JSON.parse(JSON.stringify(INITIAL_TASKS)),
    schedules: loadedSchedules || fallbackSchedules,
    preferences: loadedPrefs || {
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      prefer_long_sessions: true,
      allow_splitting: true,
      juggles: ['classes', 'gym', 'assignments'],
      daily_load_cap_mins: 360, // 6 hours
      protected_hobby_mins_week: 120, // 2 hours
      best_time_of_day: 'morning', // 'morning' | 'afternoon' | 'evening'
      weekend_mode: 'light', // 'light' | 'normal' | 'off'
    },
    onboarded: loadedOnboarded ?? false,
  };
}

const initialState = loadStoredState();
let tasks = initialState.tasks;
let schedules = initialState.schedules;
let preferences = initialState.preferences;
let onboarded = initialState.onboarded;
let notes = [];

try {
  const rawNotes = localStorage.getItem(STORAGE_KEY_NOTES);
  if (rawNotes) notes = JSON.parse(rawNotes);
} catch { /* ignore */ }

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
  } catch { /* ignore */ }
  try {
    localStorage.setItem(STORAGE_KEY_SCHEDULES, JSON.stringify(schedules));
  } catch { /* ignore */ }
  try {
    localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(preferences));
  } catch { /* ignore */ }
  try {
    localStorage.setItem(STORAGE_KEY_ONBOARDED, JSON.stringify(onboarded));
  } catch { /* ignore */ }
  try {
    localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(notes));
  } catch { /* ignore */ }
}

export function resetDemoState() {
  try {
    localStorage.removeItem(STORAGE_KEY_TASKS);
    localStorage.removeItem(STORAGE_KEY_SCHEDULES);
    localStorage.removeItem(STORAGE_KEY_PREFS);
    localStorage.removeItem(STORAGE_KEY_ONBOARDED);
    localStorage.removeItem(STORAGE_KEY_NOTES);
  } catch { /* ignore */ }

  tasks = JSON.parse(JSON.stringify(INITIAL_TASKS));
  schedules = buildSeedPastDays();
  const todayStr = ymd(todayDate());
  if (!schedules.some((s) => s.date === todayStr)) {
    schedules.push(buildScheduleItems(todayDate(), 1));
  }
  preferences = {
    wake_time: '07:00',
    sleep_time: '23:30',
    focus_length: 90,
    prefer_long_sessions: true,
    allow_splitting: true,
    juggles: ['classes', 'gym', 'assignments'],
    daily_load_cap_mins: 360,
    protected_hobby_mins_week: 120,
    best_time_of_day: 'morning',
    weekend_mode: 'light',
  };
  onboarded = false;
  notes = [];
}

/* ---------- Mock user ---------- */
const mockUser = {
  id: 1,
  name: 'Demo Student',
  email: 'demo@orbit.app',
  onboarded: () => onboarded,
};

/* ---------- Token ---------- */
const MOCK_TOKEN = 'mock-jwt-orbit-demo-token';

/* ---------- Public API ---------- */

export async function login({ email, password }) {
  await delay();
  if (!email || !password) throw { response: { data: { detail: 'Email and password are required.' } } };
  if (password.length < 8) throw { response: { data: { detail: 'Password must be at least 8 characters.' } } };
  return { access_token: MOCK_TOKEN, token_type: 'bearer' };
}

export async function signup({ name, email, password }) {
  await delay();
  if (!name || !email || !password) throw { response: { data: { detail: 'All fields are required.' } } };
  if (password.length < 8) throw { response: { data: { detail: 'Password must be at least 8 characters.' } } };
  return { access_token: MOCK_TOKEN, token_type: 'bearer' };
}

export async function getMe() {
  await delay();
  return { ...mockUser, onboarded: onboarded };
}

export async function getTasks() {
  await delay();
  return [...tasks];
}

export async function createTask(data) {
  await delay();
  const task = {
    id: uid(),
    title: data.title || 'Untitled',
    category: data.category || 'academic',
    task_type: data.task_type || 'deadline',
    tier: data.tier || (data.is_fixed ? 'have_to' : data.category === 'hobby' ? 'like_to' : 'need_to'),
    deadline: data.deadline || null,
    estimated_duration: data.estimated_duration || 60,
    priority: data.priority || 3,
    status: 'pending',
    is_fixed: data.is_fixed || false,
  };
  tasks.push(task);
  persistState();
  return task;
}

export async function getSchedule(date) {
  await delay();
  const dateStr = typeof date === 'string' ? date : ymd(date);
  let found = schedules.find((s) => s.date === dateStr);
  if (!found) {
    const targetDate = new Date(dateStr + 'T00:00:00');
    found = buildScheduleItems(targetDate, 1);
    schedules.push(found);
    persistState();
  }
  return found;
}

export async function generateSchedule(date) {
  await delay();
  const dateStr = date ? (typeof date === 'string' ? date : ymd(date)) : ymd(todayDate());
  const existing = schedules.findIndex((s) => s.date === dateStr);
  const targetDate = new Date(dateStr + 'T00:00:00');
  const newSchedule = buildScheduleItems(targetDate, 1);
  if (existing >= 0) {
    schedules[existing] = newSchedule;
  } else {
    schedules.push(newSchedule);
  }
  persistState();
  return newSchedule;
}

/* =========================================================================
   1. CHECKBOXES: setItemDone(id, done)
   ========================================================================= */
export async function setItemDone(itemId, done) {
  await delay(100);
  for (const s of schedules) {
    const item = s.items.find((i) => i.id === itemId);
    if (item && !item.is_fixed) {
      item.done = !!done;
      persistState();
      return { success: true, item };
    }
  }
  return { success: false };
}

/* =========================================================================
   2. "DONE FOR THE DAY" & RESCHEDULING ENGINE
   ========================================================================= */

function calcMins(startIso, endIso) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

function parseTimeToMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Checks if a past day was never closed.
 * Returns the unclosed day string, e.g. "2026-10-05", or null.
 */
export async function checkUnclosedPastDay() {
  await delay(50);
  // Find yesterday's date
  const yest = addDays(todayDate(), -1);
  const yestStr = ymd(yest);

  const found = schedules.find((s) => s.date === yestStr);
  if (found && !found.is_closed) {
    return { unclosedDate: yestStr, weekday: yest.toLocaleDateString('en-US', { weekday: 'long' }) };
  }
  return null;
}

/**
 * Re-open a day if closed today or last evening.
 */
export async function reopenDay(dateStr) {
  await delay(150);
  const sched = schedules.find((s) => s.date === dateStr);
  if (!sched) return { success: false };
  sched.is_closed = false;
  sched.closed_at = null;
  persistState();
  return { success: true, schedule: sched };
}

/**
 * Close day implementation
 */
export async function closeDay(dateStr) {
  await delay(400);
  const sched = schedules.find((s) => s.date === dateStr);
  if (!sched) throw new Error('Schedule not found for date ' + dateStr);

  sched.is_closed = true;
  sched.closed_at = new Date().toISOString();

  const closedDateObj = new Date(dateStr + 'T00:00:00');
  const weekdayName = closedDateObj.toLocaleDateString('en-US', { weekday: 'long' });

  // Separate ticked from unticked non-fixed blocks
  const doneItems = [];
  const untickedItems = [];

  sched.items.forEach((item) => {
    if (item.is_fixed) return;
    if (item.done) {
      doneItems.push(item);
    } else {
      untickedItems.push(item);
    }
  });

  // Sort unticked items by tier priority: Have to (highest) -> Need to -> Like to
  const tierRank = { have_to: 1, need_to: 2, like_to: 3 };
  untickedItems.sort((a, b) => (tierRank[a.tier] || 2) - (tierRank[b.tier] || 2));

  const movedList = [];
  const edgeCases = []; // issues where no slot fits before deadline, or moved twice

  // Horizon: 7 days starting tomorrow
  const startDate = addDays(closedDateObj, 1);

  for (const item of untickedItems) {
    const itemDuration = calcMins(item.start_time, item.end_time) || 60;
    const moveCount = (item.move_count || 0) + 1;
    item.move_count = moveCount;

    if (moveCount >= 2) {
      edgeCases.push({
        type: 'moved_twice',
        itemTitle: item.title,
        message: `This one keeps moving. Want to shorten it, split it, or change the deadline?`,
      });
    }

    // Search chronological days in planning horizon
    let placed = false;

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const candidateDate = addDays(startDate, dayOffset);
      const candidateDateStr = ymd(candidateDate);

      // Check deadline
      if (item.task_id) {
        const taskObj = tasks.find((t) => t.id === item.task_id);
        if (taskObj && taskObj.deadline) {
          const dlTime = new Date(taskObj.deadline).getTime();
          const dayStart = new Date(candidateDateStr + 'T00:00:00').getTime();
          if (dayStart > dlTime) {
            // Can't place past deadline
            continue;
          }
        }
      }

      // Find or build candidate schedule
      let candSched = schedules.find((s) => s.date === candidateDateStr);
      if (!candSched) {
        candSched = buildScheduleItems(candidateDate, 1);
        schedules.push(candSched);
      }

      // Check daily load cap
      const currentStudyMins = candSched.items
        .filter((i) => !i.is_fixed && i.kind !== 'break' && i.kind !== 'decompression')
        .reduce((sum, i) => sum + calcMins(i.start_time, i.end_time), 0);

      const cap = preferences.daily_load_cap_mins || 360;
      if (currentStudyMins + itemDuration > cap) {
        continue; // Exceeds cap
      }

      // Find a slot inside wake & sleep that doesn't overlap fixed commitments + 5 min buffer
      const wakeMins = parseTimeToMins(preferences.wake_time || '07:00');
      const sleepMins = parseTimeToMins(preferences.sleep_time || '23:30');

      // Candidate start candidates (e.g., preference best_time_of_day: morning 9am, afternoon 14pm, evening 19pm)
      let candidateStarts = [16 * 60 + 15, 19 * 60 + 45, 10 * 60, 14 * 60, 21 * 60];
      if (preferences.best_time_of_day === 'morning') {
        candidateStarts = [9 * 60, 10 * 60 + 30, 16 * 60 + 15, 19 * 60 + 45, 14 * 60];
      } else if (preferences.best_time_of_day === 'evening') {
        candidateStarts = [19 * 60, 20 * 60 + 30, 16 * 60 + 15, 10 * 60, 14 * 60];
      }

      let freeStart = null;
      for (const slotStart of candidateStarts) {
        const slotEnd = slotStart + itemDuration;
        if (slotStart < wakeMins || slotEnd > sleepMins) continue;

        // Check overlap with fixed commitments (+ 5 min buffer)
        const overlaps = candSched.items.some((other) => {
          if (!other.is_fixed) return false;
          const otherStart = parseTimeToMins(other.start_time.split('T')[1].slice(0, 5)) - 5;
          const otherEnd = parseTimeToMins(other.end_time.split('T')[1].slice(0, 5)) + 5;
          return Math.max(slotStart, otherStart) < Math.min(slotEnd, otherEnd);
        });

        if (!overlaps) {
          freeStart = slotStart;
          break;
        }
      }

      if (freeStart !== null) {
        // Place in candidate schedule
        const newStartH = Math.floor(freeStart / 60);
        const newStartM = freeStart % 60;
        const freeEnd = freeStart + itemDuration;
        const newEndH = Math.floor(freeEnd / 60);
        const newEndM = freeEnd % 60;

        const displacedReason = `Left from ${weekdayName}, so I put it here.`;

        candSched.items.push({
          id: uid(),
          task_id: item.task_id,
          title: item.title,
          kind: item.kind,
          tier: item.tier,
          start_time: isoTime(candidateDate, newStartH, newStartM),
          end_time: isoTime(candidateDate, newEndH, newEndM),
          status: 'displaced',
          is_fixed: false,
          done: false,
          displaced_by_task_id: null,
          displacement_reason: displacedReason,
          move_count: moveCount,
        });

        candSched.version = (candSched.version || 1) + 1;

        // Mark item in current day as moved
        item.status = 'displaced';
        item.displacement_reason = `Moved to ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })}`;

        movedList.push({
          title: item.title,
          targetDate: candidateDateStr,
          targetDayName: candidateDate.toLocaleDateString('en-US', { weekday: 'long' }),
        });

        placed = true;
        break;
      }
    }

    if (!placed) {
      edgeCases.push({
        type: 'no_slot_before_deadline',
        itemTitle: item.title,
        message: `No free slot fits "${item.title}" before its deadline without crowding your rest. We can shorten it, split it across days, or make room by shifting a lower-priority item.`,
      });
    }
  }

  persistState();

  const summarySentence = `${doneItems.length} done, ${movedList.length} moved`;
  const whatChanged = movedList.map(
    (m) => `"${m.title}" moved to ${m.targetDayName} (${m.targetDate})`
  );

  return {
    success: true,
    doneCount: doneItems.length,
    movedCount: movedList.length,
    summary: summarySentence,
    movedList,
    edgeCases,
    what_changed: whatChanged,
  };
}

/* =========================================================================
   3. WEEK PAGE DATA: getWeekSpread(date)
   ========================================================================= */
export async function getWeekSpread(baseDate) {
  await delay(250);
  const now = baseDate ? new Date(baseDate + 'T00:00:00') : todayDate();
  const currentDayOfWeek = now.getDay(); // 0 Sun, 1 Mon ...
  const monDiff = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
  const monday = addDays(now, monDiff);

  const days = [];
  let totalDeepMins = 0;
  let totalRestMins = 0;
  let totalHobbyMins = 0;

  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const dateStr = ymd(d);
    const daySched = schedules.find((s) => s.date === dateStr);
    const isClosed = daySched ? !!daySched.is_closed : false;

    const dayInfo = {
      date: dateStr,
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
      fullWeekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
      is_closed: isClosed,
      items: daySched ? daySched.items : [],
    };

    if (isClosed && daySched) {
      daySched.items.forEach((item) => {
        const mins = calcMins(item.start_time, item.end_time);
        if (item.kind === 'deep') {
          totalDeepMins += mins;
        } else if (item.kind === 'break' || item.kind === 'decompression') {
          totalRestMins += mins;
        }
        if (item.tier === 'like_to' || (item.title && item.title.toLowerCase().includes('guitar'))) {
          totalHobbyMins += mins;
        }
      });
    }

    days.push(dayInfo);
  }

  // Groups for 7-circle rows
  const groupDefinitions = [
    { key: 'dsa', title: 'DSA Practice', test: (i) => i.title && i.title.toLowerCase().includes('dsa') },
    { key: 'dbms', title: 'DBMS Assignment', test: (i) => i.title && i.title.toLowerCase().includes('dbms') },
    { key: 'maths', title: 'Maths Revision', test: (i) => i.title && i.title.toLowerCase().includes('math') },
    { key: 'guitar', title: 'Guitar / Creative', test: (i) => i.title && (i.title.toLowerCase().includes('guitar') || i.tier === 'like_to') },
  ];

  const groups = groupDefinitions.map((g) => {
    let completedSessions = 0;
    const circles = days.map((day) => {
      if (!day.is_closed) return 'unclosed'; // dotted
      const match = day.items.find(g.test);
      if (!match) return 'none';
      if (match.done) {
        completedSessions++;
        return 'done'; // filled
      }
      return 'moved'; // empty-outlined
    });

    let sentence = `${g.title}: ${completedSessions} session${completedSessions !== 1 ? 's' : ''} completed on closed days.`;
    if (g.key === 'guitar') {
      const hobbyHours = (totalHobbyMins / 60).toFixed(1);
      sentence = `Guitar: ${completedSessions} sessions, you kept your ${hobbyHours} protected hours.`;
    }

    return {
      title: g.title,
      circles,
      sentence,
      completedSessions,
    };
  });

  const deepWorkHours = (totalDeepMins / 60).toFixed(1);
  const restHours = (totalRestMins / 60).toFixed(1);
  const hobbyHours = (totalHobbyMins / 60).toFixed(1);
  const targetHobbyHours = ((preferences.protected_hobby_mins_week || 120) / 60).toFixed(1);

  // Reflection generator
  const noticeParagraph =
    Number(deepWorkHours) >= 4
      ? `Orbit noticed you preserved solid focus blocks during your afternoon classes without cutting into sleep. Your protected guitar time stayed intact even through assignment deadlines.`
      : `Orbit noticed your rhythms leaned toward shorter, adaptive blocks this week to keep energy sustainable while commitments shifted.`;

  const suggestion =
    Number(deepWorkHours) >= 6
      ? `Next week, consider adding an extra 15-minute decompression cushion after long labs to keep your evenings calm.`
      : `Next week, we can protect one uninterrupted 90-minute morning window before midday lectures.`;

  return {
    days,
    groups,
    deepWorkHours,
    restHours,
    hobbyHours,
    targetHobbyHours,
    noticeParagraph,
    suggestion,
  };
}

/* =========================================================================
   4 & 5. RE-PLANNING ENGINE (Tomorrow onward only, triggered by notes/feedback)
   ========================================================================= */

export async function replanSchedule({ reason, feedbackText, clarification }) {
  await delay(400);

  const whatChanged = [];

  const textLower = `${feedbackText || ''} ${clarification || ''} ${reason || ''}`.toLowerCase();

  const isTiredOrOverwhelmed =
    textLower.includes('too much') ||
    textLower.includes('tired') ||
    textLower.includes('exhaust') ||
    textLower.includes('drained') ||
    textLower.includes('plate');

  const isWrongTime =
    textLower.includes('wrong time') ||
    textLower.includes('time of day') ||
    textLower.includes('prefer morning') ||
    textLower.includes('prefer evening');

  const isShortBreaks =
    textLower.includes('breaks too short') ||
    textLower.includes('short break') ||
    textLower.includes('longer break') ||
    textLower.includes('more rest');

  // Loop through next 4 days (tomorrow onward)
  for (let offset = 1; offset <= 4; offset++) {
    const candidateDate = addDays(todayDate(), offset);
    const dateStr = ymd(candidateDate);
    const sched = schedules.find((s) => s.date === dateStr);
    if (!sched || sched.is_closed) continue; // NEVER change past days or closed days

    sched.version = (sched.version || 1) + 1;

    if (isTiredOrOverwhelmed) {
      preferences.daily_load_cap_mins = Math.max(180, (preferences.daily_load_cap_mins || 360) - 60);

      // Lighten non-urgent items
      const lowerItem = sched.items.find((i) => !i.is_fixed && i.tier !== 'have_to' && i.status !== 'displaced');
      if (lowerItem) {
        lowerItem.status = 'displaced';
        lowerItem.displacement_reason = `Moved to your next deep-work block to prevent overload.`;
        whatChanged.push(`Lightened ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })}: shifted "${lowerItem.title}" to protect your energy.`);
      }
    } else if (isWrongTime) {
      // Shift deep work toward user's best time
      const deepItem = sched.items.find((i) => i.kind === 'deep' && !i.is_fixed);
      if (deepItem) {
        deepItem.start_time = isoTime(candidateDate, 10, 0);
        deepItem.end_time = isoTime(candidateDate, 11, 30);
        whatChanged.push(`Adjusted deep focus on ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })} to 10:00 AM based on your peak energy.`);
      }
    } else if (isShortBreaks) {
      const breakItem = sched.items.find((i) => i.kind === 'break');
      if (breakItem) {
        breakItem.end_time = isoTime(candidateDate, 20, 15);
        whatChanged.push(`Extended recovery break on ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })} to 45 minutes.`);
      }
    }
  }

  if (whatChanged.length === 0) {
    whatChanged.push('Reviewed upcoming days from tomorrow onward. Your schedule is well balanced with no immediate shifts required.');
  }

  persistState();

  return {
    success: true,
    what_changed: whatChanged,
  };
}

/**
 * Checks if note is vague (needs clarifying modal before re-planning)
 */
export function checkNoteVague(text) {
  const lower = (text || '').toLowerCase();
  const knownKeywords = [
    'too much', 'plate', 'tired', 'exhaust', 'wrong time', 'morning', 'evening',
    'break', 'rest', 'sick', 'heavy', 'light', 'guitar', 'gym', 'os practical',
    'prefer', 'deadline', 'assignment', 'homework', 'drained'
  ];
  const hasKeyword = knownKeywords.some((k) => lower.includes(k));
  return !hasKeyword;
}

export async function disrupt(text, date) {
  await delay();
  const dateStr = date ? (typeof date === 'string' ? date : ymd(date)) : ymd(todayDate());
  const targetIdx = schedules.findIndex((s) => s.date === dateStr);
  const target = targetIdx >= 0 ? schedules[targetIdx] : schedules[0];

  if (!target) {
    const fresh = buildScheduleItems(todayDate(), 1);
    schedules.push(fresh);
    persistState();
    return {
      schedule: fresh,
      what_changed: ['Generated a new schedule for today.'],
      at_risk: [],
    };
  }

  // Clone the schedule and bump version
  const updated = JSON.parse(JSON.stringify(target));
  updated.version += 1;

  const isOsPractical = text.toLowerCase().includes('os practical') || text.toLowerCase().includes('practical');
  const isExhausted = text.toLowerCase().includes('exhaust') || text.toLowerCase().includes('tired') || text.toLowerCase().includes('sick');

  const what_changed = [];
  const at_risk = [];

  if (isOsPractical) {
    const osPracticalTask = {
      id: uid(), title: 'OS Practical Prep', category: 'academic',
      task_type: 'deadline', tier: 'have_to', deadline: isoTime(addDays(todayDate(), 1), 9),
      estimated_duration: 120, priority: 5, status: 'pending', is_fixed: false,
    };
    tasks.push(osPracticalTask);

    const mathsIdx = updated.items.findIndex((i) => i.title === 'Maths Revision');
    if (mathsIdx >= 0) {
      updated.items[mathsIdx].displaced_by_task_id = osPracticalTask.id;
      updated.items[mathsIdx].displacement_reason =
        'Moved to tomorrow evening because your OS practical came up and needs priority today.';
      updated.items[mathsIdx].status = 'displaced';
    }

    updated.items.push({
      id: uid(), task_id: osPracticalTask.id, title: 'OS Practical Prep',
      kind: 'deep', tier: 'have_to',
      start_time: isoTime(new Date(target.date + 'T00:00'), 22, 15),
      end_time: isoTime(new Date(target.date + 'T00:00'), 23, 45),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    });

    what_changed.push(
      'Added "OS Practical Prep" (2 hours) to your evening deep-work slot.',
      'Moved "Maths Revision" to tomorrow evening — your OS practical needs priority today.',
      'Everything else stays the same. Your DBMS session and gym are untouched.'
    );

    at_risk.push({
      id: MATHS_ID,
      title: 'Maths Revision',
      reason: 'Pushed to tomorrow — make sure you have a free slot then.',
    });
  } else if (isExhausted) {
    const mathsIdx = updated.items.findIndex((i) => i.title === 'Maths Revision');
    if (mathsIdx >= 0) {
      updated.items[mathsIdx].displacement_reason =
        'Moved to tomorrow because you need recovery time tonight.';
      updated.items[mathsIdx].status = 'displaced';
    }

    updated.items.push({
      id: uid(), task_id: null, title: 'Extra Rest',
      kind: 'decompression', tier: 'like_to',
      start_time: isoTime(new Date(target.date + 'T00:00'), 22, 15),
      end_time: isoTime(new Date(target.date + 'T00:00'), 23),
      status: 'scheduled', is_fixed: false, done: false,
      displaced_by_task_id: null, displacement_reason: null, move_count: 0,
    });

    what_changed.push(
      'Removed "Maths Revision" from tonight and moved it to tomorrow.',
      'Added extra rest time in the evening to help you recover.',
      "Your DBMS session stays — it's closer to the deadline. But take it easy."
    );
  } else {
    const deepBlocks = updated.items.filter((i) => (i.kind === 'deep' || i.kind === 'short') && !i.is_fixed);
    if (deepBlocks.length > 0) {
      const lowest = deepBlocks.reduce((a, b) => {
        const aTask = tasks.find((t) => t.id === a.task_id);
        const bTask = tasks.find((t) => t.id === b.task_id);
        return (aTask?.priority || 3) <= (bTask?.priority || 3) ? a : b;
      });
      const idx = updated.items.findIndex((i) => i.id === lowest.id);
      if (idx >= 0) {
        updated.items[idx].displacement_reason =
          `Moved to the next available slot because: "${text}"`;
        updated.items[idx].status = 'displaced';
      }
      what_changed.push(
        `Reorganised your schedule based on: "${text}"`,
        `Moved "${lowest.title}" to a later slot to make room.`,
        'The rest of your plan stays on track.'
      );
    } else {
      what_changed.push(
        `Noted: "${text}". Your schedule looks manageable as-is — no changes needed right now.`
      );
    }
  }

  if (targetIdx >= 0) {
    schedules[targetIdx] = updated;
  }
  persistState();

  return {
    schedule: updated,
    what_changed,
    at_risk,
  };
}

export async function sendFeedback(text) {
  await delay();

  const isExhausted = text.toLowerCase().includes('exhaust') ||
                       text.toLowerCase().includes('tired') ||
                       text.toLowerCase().includes('couldn\'t study') ||
                       text.toLowerCase().includes('rough');

  if (isExhausted) {
    const todaySchedule = schedules.find((s) => s.date === ymd(todayDate()));
    if (todaySchedule) {
      const mathsIdx = todaySchedule.items.findIndex((i) => i.title === 'Maths Revision' && i.status !== 'displaced');
      if (mathsIdx >= 0) {
        todaySchedule.items[mathsIdx].displacement_reason =
          'Moved to your next deep-work block so you can recover tonight.';
        todaySchedule.items[mathsIdx].status = 'displaced';
      }
      persistState();
    }

    return {
      message: "That's completely okay. Everyone has days like that. I've lightened your evening — your Maths revision moved to your next free deep-work slot. Focus on rest tonight; you'll pick it up fresh tomorrow.",
      schedule_updated: true,
    };
  }

  const isGood = text.toLowerCase().includes('good') ||
                  text.toLowerCase().includes('great') ||
                  text.toLowerCase().includes('works') ||
                  text.toLowerCase().includes('productive');

  if (isGood) {
    return {
      message: "Glad to hear it went well! I'll keep a similar rhythm for tomorrow. Consistency is everything.",
      schedule_updated: false,
    };
  }

  return {
    message: "Thanks for sharing. I'll factor this into your upcoming plans. Small adjustments add up to something sustainable.",
    schedule_updated: false,
  };
}

export async function sendNote(text) {
  await delay();
  const lower = (text || '').toLowerCase();

  const isExhausted = lower.includes('exhaust') ||
                      lower.includes('tired') ||
                      lower.includes('drained') ||
                      lower.includes('burnout') ||
                      lower.includes('sick');

  if (isExhausted) {
    return {
      kind: 'feedback',
      understood: 'You are feeling exhausted and need a lighter evening with work shifted to your next deep-work block.',
      message: "That's completely okay. Everyone has days like that. I'll lighten your evening and move non-urgent work to your next deep-work block so you can rest.",
    };
  }

  const isPref = lower.includes('prefer') ||
                 lower.includes('like to study') ||
                 lower.includes('morning') ||
                 lower.includes('evening') ||
                 lower.includes('always') ||
                 lower.includes('never');

  if (isPref) {
    return {
      kind: 'preference',
      understood: `You want Orbit to remember this working preference: "${text.trim()}".`,
      message: "Got it. I'll remember this preference for how you work best and keep it in mind when planning future days.",
    };
  }

  const isTask = lower.includes('need to') ||
                 lower.includes('have to') ||
                 lower.includes('finish') ||
                 lower.includes('assignment') ||
                 lower.includes('homework') ||
                 lower.includes('submit') ||
                 lower.includes('due');

  if (isTask) {
    return {
      kind: 'task',
      understood: `You have an upcoming commitment or task: "${text.trim()}".`,
      message: "Understood. I will add this to your tasks and carve out dedicated focus time for it in your schedule.",
    };
  }

  const isFeedback = lower.includes('felt') ||
                     lower.includes('today') ||
                     lower.includes('paced') ||
                     lower.includes('too heavy') ||
                     lower.includes('good') ||
                     lower.includes('great') ||
                     lower.includes('hard');

  if (isFeedback) {
    return {
      kind: 'feedback',
      understood: `You are sharing a reflection on today's pace and rhythm: "${text.trim()}".`,
      message: "Thank you for the reflection. Orbit adapts future rhythms based on how sustainable your days feel.",
    };
  }

  return {
    kind: 'note',
    understood: `You shared a note: "${text.trim()}".`,
    message: "Noted. I'll keep this in mind as we organise your upcoming weeks.",
  };
}

export async function saveNote({ text, kind, rating }) {
  await delay();
  const entry = {
    id: uid(),
    text,
    kind,
    rating: rating || null,
    created_at: new Date().toISOString(),
  };
  notes.push(entry);

  const lower = (text || '').toLowerCase();
  const isExhausted = lower.includes('exhaust') || lower.includes('tired') || lower.includes('sick');

  if (isExhausted) {
    const todaySchedule = schedules.find((s) => s.date === ymd(todayDate()));
    if (todaySchedule) {
      const mathsIdx = todaySchedule.items.findIndex((i) => i.title === 'Maths Revision' && i.status !== 'displaced');
      if (mathsIdx >= 0) {
        todaySchedule.items[mathsIdx].displacement_reason =
          'Moved to your next deep-work block so you can recover tonight.';
        todaySchedule.items[mathsIdx].status = 'displaced';
      }
    }
  }

  persistState();
  return { success: true, entry };
}

export async function getPreferences() {
  await delay();
  return { ...preferences };
}

export async function savePreferences(prefs) {
  await delay();
  preferences = { ...preferences, ...prefs };
  onboarded = true;
  persistState();
  return preferences;
}

export async function saveOnboarding(answers) {
  await delay();
  if (answers.wake_time) preferences.wake_time = answers.wake_time;
  if (answers.sleep_time) preferences.sleep_time = answers.sleep_time;
  if (answers.focus_length) preferences.focus_length = answers.focus_length;
  if (answers.prefer_long_sessions !== undefined) preferences.prefer_long_sessions = answers.prefer_long_sessions;
  if (answers.allow_splitting !== undefined) preferences.allow_splitting = answers.allow_splitting;
  if (answers.juggles) preferences.juggles = answers.juggles;
  if (answers.anything_else) preferences.anything_else = answers.anything_else;
  if (answers.daily_load_cap_mins) preferences.daily_load_cap_mins = answers.daily_load_cap_mins;
  if (answers.protected_hobby_mins_week) preferences.protected_hobby_mins_week = answers.protected_hobby_mins_week;
  if (answers.best_time_of_day) preferences.best_time_of_day = answers.best_time_of_day;
  onboarded = true;
  persistState();
  return preferences;
}
