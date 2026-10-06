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
const INITIAL_TASKS = [];

const DEFAULT_PREFERENCES = {
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
};

let preferences = { ...DEFAULT_PREFERENCES };
let tasks = [];
let schedules = [];
let onboarded = false;
let notes = [];

function buildScheduleItems(dateObj, version, overridePrefs) {
  const date = ymd(dateObj);
  const prefs = overridePrefs || preferences || DEFAULT_PREFERENCES;

  const wakeStr = prefs.wake_time || '07:00';
  const sleepStr = prefs.sleep_time || '23:30';
  const wakeMins = parseTimeToMins(wakeStr);
  let sleepMins = parseTimeToMins(sleepStr);
  if (sleepMins <= wakeMins) {
    sleepMins = 23 * 60 + 59;
  }

  const dayOfWeek = dateObj.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dayOfWeek];
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Focus & behavioral preferences
  const focusLen = Number(prefs.focus_length) || (prefs.focus_style === 'short' ? 40 : prefs.focus_style === 'long' ? 100 : 60);
  const isShortFocus = prefs.focus_style === 'short' || focusLen <= 45;
  const isLongFocus = prefs.focus_style === 'long' || focusLen >= 100;
  const allowSplit = prefs.allow_splitting !== false || prefs.task_splitting === 'yes' || prefs.task_splitting === 'large';
  const shouldSplit = allowSplit && (isShortFocus || prefs.task_initiation === 'tiny_step');

  const breakMins = prefs.break_preference === 'frequent' ? 20 : prefs.break_preference === 'fewer_longer' ? 10 : 15;
  const windDownMins = 30;

  const items = [];

  const addBlock = ({ taskId, title, kind, tier, startMins, endMins, isFixed = false, displacementReason = null, status = 'scheduled' }) => {
    const safeStart = Math.max(wakeMins, Math.min(sleepMins - 10, startMins));
    const safeEnd = Math.max(safeStart + 10, Math.min(sleepMins, endMins));
    if (safeEnd <= safeStart) return;

    const startH = Math.floor(safeStart / 60);
    const startM = safeStart % 60;
    const endH = Math.floor(safeEnd / 60);
    const endM = safeEnd % 60;

    items.push({
      id: uid(),
      task_id: taskId || null,
      title,
      kind,
      tier,
      start_time: isoTime(dateObj, startH, startM),
      end_time: isoTime(dateObj, endH, endM),
      status,
      is_fixed: isFixed,
      done: false,
      displaced_by_task_id: null,
      displacement_reason: displacementReason,
      move_count: 0,
    });
  };

  // 1. Filter fixed commitments for this day
  const rawCommitments = Array.isArray(prefs.fixed_commitments) ? prefs.fixed_commitments : [];
  const dayCommitments = rawCommitments.filter((c) => {
    if (!c.days || c.days === 'Daily') return true;
    if (c.days === 'Monday–Friday' || c.days === 'Weekdays') return !isWeekend;
    if (c.days === 'Weekends') return isWeekend;
    return c.days.toLowerCase() === dayName.toLowerCase();
  });

  // Track unavailable intervals (including commute buffers)
  const busyIntervals = [];

  dayCommitments.forEach((c) => {
    const cStart = parseTimeToMins(c.start_time);
    const cEnd = parseTimeToMins(c.end_time);
    const cBefore = Number(c.commute_before) || 0;
    const cAfter = Number(c.commute_after) || 0;

    // Add commute before if specified
    if (cBefore > 0 && cStart - cBefore >= wakeMins) {
      addBlock({
        taskId: null,
        title: `Travel: ${c.name}`,
        kind: 'break',
        tier: 'have_to',
        startMins: cStart - cBefore,
        endMins: cStart,
        isFixed: true,
      });
    }

    // Add fixed commitment block
    addBlock({
      taskId: null,
      title: c.name,
      kind: 'fixed',
      tier: 'have_to',
      startMins: cStart,
      endMins: cEnd,
      isFixed: true,
    });

    // Add commute after if specified
    if (cAfter > 0 && cEnd + cAfter <= sleepMins) {
      addBlock({
        taskId: null,
        title: `Transition: ${c.name}`,
        kind: 'break',
        tier: 'have_to',
        startMins: cEnd,
        endMins: cEnd + cAfter,
        isFixed: true,
      });
    }

    busyIntervals.push({
      start: Math.max(wakeMins, cStart - cBefore),
      end: Math.min(sleepMins, cEnd + cAfter),
    });
  });

  // Sort & merge busy intervals
  busyIntervals.sort((a, b) => a.start - b.start);
  const mergedBusy = [];
  for (const interval of busyIntervals) {
    if (mergedBusy.length === 0) {
      mergedBusy.push({ ...interval });
    } else {
      const last = mergedBusy[mergedBusy.length - 1];
      if (interval.start <= last.end) {
        last.end = Math.max(last.end, interval.end);
      } else {
        mergedBusy.push({ ...interval });
      }
    }
  }

  // Calculate free intervals
  const availableSlots = [];
  let currentPointer = wakeMins;
  const latestWorkTime = sleepMins - windDownMins;

  for (const b of mergedBusy) {
    if (b.start > currentPointer) {
      const freeStart = currentPointer;
      const freeEnd = Math.min(latestWorkTime, b.start);
      if (freeEnd - freeStart >= 20) {
        availableSlots.push({ start: freeStart, end: freeEnd, duration: freeEnd - freeStart });
      }
    }
    currentPointer = Math.max(currentPointer, b.end);
  }

  if (currentPointer < latestWorkTime && latestWorkTime - currentPointer >= 20) {
    availableSlots.push({ start: currentPointer, end: latestWorkTime, duration: latestWorkTime - currentPointer });
  }

  // 2. Queue actual user-defined tasks
  const needToList = Array.isArray(prefs.need_to_items) ? prefs.need_to_items : [];
  const shouldDoList = Array.isArray(prefs.should_do_items) ? prefs.should_do_items : [];
  const likeToList = Array.isArray(prefs.like_to_items) ? prefs.like_to_items : [];

  const taskQueue = [];

  needToList.forEach((item) => {
    taskQueue.push({
      title: item.name,
      tier: 'have_to',
      kind: 'deep',
      duration: Number(item.duration) || (isShortFocus ? 45 : isLongFocus ? 105 : 90),
    });
  });

  shouldDoList.forEach((item) => {
    taskQueue.push({
      title: item.name,
      tier: 'need_to',
      kind: 'deep',
      duration: Number(item.duration) || (isShortFocus ? 35 : isLongFocus ? 90 : 60),
    });
  });

  likeToList.forEach((item) => {
    taskQueue.push({
      title: item.name,
      tier: 'like_to',
      kind: 'short',
      duration: Number(item.duration) || (isShortFocus ? 30 : 45),
    });
  });

  // Schedule queue into open slots
  for (const slot of availableSlots) {
    let slotPtr = slot.start;
    const slotEnd = slot.end;

    while (taskQueue.length > 0 && slotPtr + 20 <= slotEnd) {
      const task = taskQueue.shift();
      const remainingSlot = slotEnd - slotPtr;
      const taskDur = Math.min(task.duration, remainingSlot);

      if (taskDur < 20) break;

      if (shouldSplit && taskDur >= 50 && task.tier !== 'like_to') {
        const step1Dur = Math.round(taskDur * 0.4);
        const step2Dur = taskDur - step1Dur - breakMins;

        addBlock({
          taskId: null,
          title: `Start ${task.title}`,
          kind: task.kind,
          tier: task.tier,
          startMins: slotPtr,
          endMins: slotPtr + step1Dur,
        });
        slotPtr += step1Dur;

        if (step2Dur >= 20 && slotPtr + breakMins + step2Dur <= slotEnd) {
          addBlock({
            taskId: null,
            title: 'Rest & Pause',
            kind: 'break',
            tier: 'like_to',
            startMins: slotPtr,
            endMins: slotPtr + breakMins,
          });
          slotPtr += breakMins;

          addBlock({
            taskId: null,
            title: `${task.title} (Deep Work)`,
            kind: task.kind,
            tier: task.tier,
            startMins: slotPtr,
            endMins: slotPtr + step2Dur,
          });
          slotPtr += step2Dur;
        }
      } else {
        addBlock({
          taskId: null,
          title: task.title,
          kind: task.kind,
          tier: task.tier,
          startMins: slotPtr,
          endMins: slotPtr + taskDur,
        });
        slotPtr += taskDur;
      }

      if (slotPtr + breakMins < slotEnd && taskQueue.length > 0) {
        addBlock({
          taskId: null,
          title: 'Break',
          kind: 'break',
          tier: 'like_to',
          startMins: slotPtr,
          endMins: slotPtr + breakMins,
        });
        slotPtr += breakMins;
      }
    }
  }

  // 3. Add Wind Down before bedtime
  const lastTaskEnd = items.length > 0
    ? Math.max(...items.map((i) => {
        const d = new Date(i.end_time);
        return d.getHours() * 60 + d.getMinutes();
      }))
    : wakeMins;

  const windDownStart = Math.max(lastTaskEnd, sleepMins - windDownMins);
  if (windDownStart < sleepMins) {
    addBlock({
      taskId: null,
      title: 'Wind Down',
      kind: 'decompression',
      tier: 'like_to',
      startMins: windDownStart,
      endMins: sleepMins,
    });
  }

  // Sort chronologically
  items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

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
    const rawPrefs = localStorage.getItem(STORAGE_KEY_PREFS);
    if (rawPrefs) loadedPrefs = JSON.parse(rawPrefs);
  } catch { /* ignore */ }

  if (loadedPrefs) {
    preferences = { ...DEFAULT_PREFERENCES, ...loadedPrefs };
  } else {
    preferences = { ...DEFAULT_PREFERENCES };
  }

  try {
    const rawTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (rawTasks) loadedTasks = JSON.parse(rawTasks);
  } catch { /* ignore */ }

  try {
    const rawSchedules = localStorage.getItem(STORAGE_KEY_SCHEDULES);
    if (rawSchedules) loadedSchedules = JSON.parse(rawSchedules);
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
    preferences: preferences,
    onboarded: loadedOnboarded ?? false,
  };
}

const initialState = loadStoredState();
tasks = initialState.tasks;
schedules = initialState.schedules;
preferences = initialState.preferences;
onboarded = initialState.onboarded;

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
  await delay(150);
  const todayObj = todayDate();

  if (date) {
    const dateStr = typeof date === 'string' ? date : ymd(date);
    const targetDate = new Date(dateStr + 'T00:00:00');
    const newSchedule = buildScheduleItems(targetDate, 1);
    const existing = schedules.findIndex((s) => s.date === dateStr);
    if (existing >= 0) {
      schedules[existing] = newSchedule;
    } else {
      schedules.push(newSchedule);
    }
    persistState();
    return newSchedule;
  }

  // When called without date (e.g. from onboarding finish), generate 7-day week
  let todaySchedule = null;
  for (let i = 0; i < 7; i++) {
    const targetDate = addDays(todayObj, i);
    const dateStr = ymd(targetDate);
    const daySched = buildScheduleItems(targetDate, 1);
    const existing = schedules.findIndex((s) => s.date === dateStr);
    if (existing >= 0) {
      schedules[existing] = daySched;
    } else {
      schedules.push(daySched);
    }
    if (i === 0) {
      todaySchedule = daySched;
    }
  }

  persistState();
  return todaySchedule;
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
    if (item.is_fixed || item.kind === 'break' || item.kind === 'decompression') return;
    if (item.done) {
      doneItems.push(item);
    } else {
      untickedItems.push(item);
    }
  });

  // Sort unticked items by tier priority: have_to -> need_to -> like_to
  const tierRank = { have_to: 1, need_to: 2, like_to: 3 };
  untickedItems.sort((a, b) => (tierRank[a.tier] || 2) - (tierRank[b.tier] || 2));

  const movedList = [];
  const edgeCases = [];

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

    let placed = false;

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const candidateDate = addDays(startDate, dayOffset);
      const candidateDateStr = ymd(candidateDate);

      // Find or build candidate schedule
      let candSched = schedules.find((s) => s.date === candidateDateStr);
      if (!candSched) {
        candSched = buildScheduleItems(candidateDate, 1);
        schedules.push(candSched);
      }

      // Check if candidate schedule already contains an active occurrence of this task
      const existingCandItem = candSched.items.find(
        (i) => i.title && i.title.toLowerCase() === item.title.toLowerCase() && !i.is_fixed && i.status !== 'displaced'
      );

      if (existingCandItem) {
        // Already scheduled on candidate day — update metadata/move_count to avoid duplicate copy
        existingCandItem.move_count = moveCount;
        existingCandItem.displacement_reason = `Left from ${weekdayName}, so carried forward.`;
        candSched.version = (candSched.version || 1) + 1;

        // Mark item in current day as displaced
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

      // Check daily load cap
      const currentStudyMins = candSched.items
        .filter((i) => !i.is_fixed && i.kind !== 'break' && i.kind !== 'decompression')
        .reduce((sum, i) => sum + calcMins(i.start_time, i.end_time), 0);

      const cap = preferences.daily_load_cap_mins || 360;
      if (currentStudyMins + itemDuration > cap && dayOffset < 6) {
        continue;
      }

      // Find open interval inside candidate day
      const candWake = parseTimeToMins(preferences.wake_time || '07:00');
      const candSleep = parseTimeToMins(preferences.sleep_time || '23:30');
      const latestWork = candSleep - 30;

      // Collect busy periods
      const candBusy = [];
      candSched.items.forEach((it) => {
        const s = parseTimeToMins(it.start_time.split('T')[1].slice(0, 5));
        const e = parseTimeToMins(it.end_time.split('T')[1].slice(0, 5));
        candBusy.push({ start: s, end: e });
      });
      candBusy.sort((a, b) => a.start - b.start);

      let freeStart = null;
      let ptr = candWake;

      for (const b of candBusy) {
        if (b.start - ptr >= itemDuration) {
          freeStart = ptr;
          break;
        }
        ptr = Math.max(ptr, b.end);
      }

      if (freeStart === null && latestWork - ptr >= itemDuration) {
        freeStart = ptr;
      }

      if (freeStart !== null) {
        const newStartH = Math.floor(freeStart / 60);
        const newStartM = freeStart % 60;
        const freeEnd = freeStart + itemDuration;
        const newEndH = Math.floor(freeEnd / 60);
        const newEndM = freeEnd % 60;

        const displacedReason = `Left from ${weekdayName}, so I put it here.`;

        candSched.items.push({
          id: uid(),
          task_id: item.task_id || null,
          title: item.title,
          kind: item.kind,
          tier: item.tier,
          start_time: isoTime(candidateDate, newStartH, newStartM),
          end_time: isoTime(candidateDate, newEndH, newEndM),
          status: 'scheduled',
          is_fixed: false,
          done: false,
          displaced_by_task_id: null,
          displacement_reason: displacedReason,
          move_count: moveCount,
        });

        candSched.items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        candSched.version = (candSched.version || 1) + 1;

        // Mark item in current day as displaced
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
    moved: movedList,
    movedList,
    edge_cases: edgeCases,
    edgeCases,
    summary: summarySentence,
    what_changed: whatChanged,
    closed_date: dateStr,
    weekday: weekdayName,
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
        if (item.tier === 'like_to') {
          totalHobbyMins += mins;
        }
      });
    }

    days.push(dayInfo);
  }

  // Groups for 7-circle rows derived dynamically from user preferences or scheduled items
  const userItems = [
    ...(preferences.need_to_items || []),
    ...(preferences.should_do_items || []),
    ...(preferences.like_to_items || []),
  ];

  let groupDefinitions = userItems.slice(0, 4).map((item) => {
    const title = typeof item === 'string' ? item : item.name || item.title;
    return {
      key: title.toLowerCase().replace(/\s+/g, '_'),
      title: title,
      test: (i) => i.title && i.title.toLowerCase().includes(title.toLowerCase()),
    };
  });

  if (groupDefinitions.length === 0) {
    const distinctTitles = new Set();
    days.forEach((d) =>
      d.items.forEach((i) => {
        if (!i.is_fixed && i.kind !== 'break' && i.kind !== 'decompression' && i.title) {
          distinctTitles.add(i.title);
        }
      })
    );
    groupDefinitions = Array.from(distinctTitles)
      .slice(0, 4)
      .map((title) => ({
        key: title.toLowerCase().replace(/\s+/g, '_'),
        title: title,
        test: (i) => i.title && i.title.toLowerCase() === title.toLowerCase(),
      }));
  }

  if (groupDefinitions.length === 0) {
    groupDefinitions = [
      { key: 'deep', title: 'Focus Sessions', test: (i) => i.kind === 'deep' },
      { key: 'like_to', title: 'Protected Free Time', test: (i) => i.tier === 'like_to' },
    ];
  }

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
      ? `Orbit noticed you preserved solid focus blocks during your day without cutting into sleep. Your personal buffer and protected time stayed intact.`
      : `Orbit noticed your rhythms leaned toward shorter, adaptive blocks this week to keep energy sustainable while commitments shifted.`;

  const suggestion =
    Number(deepWorkHours) >= 6
      ? `Next week, consider adding an extra 15-minute decompression cushion after long commitments to keep your evenings calm.`
      : `Next week, we can protect one uninterrupted 90-minute morning window before midday commitments.`;

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
   4 & 5. RE-PLANNING ENGINE (Tomorrow onward & active days, triggered by notes/feedback)
   ========================================================================= */

export async function replanSchedule({ reason, feedbackText, clarification }) {
  await delay(400);

  const whatChanged = [];
  const textLower = `${feedbackText || ''} ${clarification || ''} ${reason || ''}`.toLowerCase();

  // Helper to find known task title referenced in text
  const allKnownTaskTitles = [];
  const userItems = [
    ...(preferences.need_to_items || []),
    ...(preferences.should_do_items || []),
    ...(preferences.like_to_items || []),
  ];
  userItems.forEach((it) => {
    const name = typeof it === 'string' ? it : it.name || it.title;
    if (name) allKnownTaskTitles.push(name);
  });
  schedules.forEach((s) => {
    s.items.forEach((it) => {
      if (!it.is_fixed && it.title && !allKnownTaskTitles.includes(it.title)) {
        allKnownTaskTitles.push(it.title);
      }
    });
  });

  // Check if text mentions a specific task
  let matchedTaskTitle = null;
  for (const title of allKnownTaskTitles) {
    if (textLower.includes(title.toLowerCase())) {
      matchedTaskTitle = title;
      break;
    }
  }

  // Check for commitment mentions (e.g. "hospital rotation", "classes", "lecture")
  let mentionedCommitment = null;
  const fixedList = [
    ...(preferences.fixed_commitments || []),
    ...(preferences.monday_commitments || []),
    ...(preferences.tuesday_commitments || []),
    ...(preferences.wednesday_commitments || []),
    ...(preferences.thursday_commitments || []),
    ...(preferences.friday_commitments || []),
  ];
  for (const fc of fixedList) {
    const cName = fc.name || fc.title;
    if (cName && textLower.includes(cName.toLowerCase())) {
      mentionedCommitment = cName;
      break;
    }
  }

  const isMoveRequest =
    textLower.includes('move') ||
    textLower.includes('tired') ||
    textLower.includes('exhaust') ||
    textLower.includes('after') ||
    textLower.includes('later') ||
    textLower.includes('shift') ||
    textLower.includes('reschedule') ||
    textLower.includes('too heavy');

  // Case 1: Specific task relocation requested
  if (matchedTaskTitle && isMoveRequest) {
    let movedSuccessfully = false;

    // Search across all unclosed schedules (today + next 4 days)
    for (let offset = 0; offset <= 4; offset++) {
      const sourceDate = addDays(todayDate(), offset);
      const sourceDateStr = ymd(sourceDate);
      const sourceSched = schedules.find((s) => s.date === sourceDateStr);
      if (!sourceSched || sourceSched.is_closed) continue;

      const itemIdx = sourceSched.items.findIndex(
        (i) => i.title && i.title.toLowerCase() === matchedTaskTitle.toLowerCase() && i.status !== 'displaced'
      );

      if (itemIdx >= 0) {
        const itemToMove = sourceSched.items[itemIdx];
        const itemDuration = calcMins(itemToMove.start_time, itemToMove.end_time) || 60;
        const sourceDayName = sourceDate.toLocaleDateString('en-US', { weekday: 'long' });

        // Find candidate destination day (starting next day)
        for (let destOffset = offset + 1; destOffset <= offset + 4; destOffset++) {
          const destDate = addDays(todayDate(), destOffset);
          const destDateStr = ymd(destDate);
          let destSched = schedules.find((s) => s.date === destDateStr);
          if (!destSched) {
            destSched = buildScheduleItems(destDate, 1);
            schedules.push(destSched);
          }
          if (destSched.is_closed) continue;

          const destDayName = destDate.toLocaleDateString('en-US', { weekday: 'long' });

          // Check if destination schedule already contains an active occurrence of this task
          const existingDestItem = destSched.items.find(
            (i) => i.title && i.title.toLowerCase() === itemToMove.title.toLowerCase() && !i.is_fixed && i.status !== 'displaced'
          );

          if (existingDestItem) {
            // Already scheduled on destination day — update metadata/move count to avoid duplicate
            existingDestItem.move_count = (existingDestItem.move_count || 0) + 1;
            existingDestItem.displacement_reason = `Rescheduled from ${sourceDayName} based on your feedback.`;
            destSched.version = (destSched.version || 1) + 1;

            // Remove/displace from sourceSched
            sourceSched.items.splice(itemIdx, 1);
            sourceSched.version = (sourceSched.version || 1) + 1;

            const reasonContext = mentionedCommitment ? ` to protect your recovery time after ${mentionedCommitment}` : ' to protect your recovery time';
            whatChanged.push(`Moved "${matchedTaskTitle}" from ${sourceDayName} to ${destDayName}${reasonContext}.`);

            movedSuccessfully = true;
            break;
          }

          // Find open slot in destSched
          const destWake = parseTimeToMins(preferences.wake_time || '07:00');
          const destSleep = parseTimeToMins(preferences.sleep_time || '23:30');
          const latestDestWork = destSleep - 30;

          const busy = [];
          destSched.items.forEach((it) => {
            const s = parseTimeToMins(it.start_time.split('T')[1].slice(0, 5));
            const e = parseTimeToMins(it.end_time.split('T')[1].slice(0, 5));
            busy.push({ start: s, end: e });
          });
          busy.sort((a, b) => a.start - b.start);

          let freeStart = null;
          let ptr = destWake;
          for (const b of busy) {
            if (b.start - ptr >= itemDuration) {
              freeStart = ptr;
              break;
            }
            ptr = Math.max(ptr, b.end);
          }
          if (freeStart === null && latestDestWork - ptr >= itemDuration) {
            freeStart = ptr;
          }

          if (freeStart !== null) {
            const destDayName = destDate.toLocaleDateString('en-US', { weekday: 'long' });
            const newStartH = Math.floor(freeStart / 60);
            const newStartM = freeStart % 60;
            const freeEnd = freeStart + itemDuration;
            const newEndH = Math.floor(freeEnd / 60);
            const newEndM = freeEnd % 60;

            destSched.items.push({
              id: uid(),
              task_id: itemToMove.task_id || null,
              title: itemToMove.title,
              kind: itemToMove.kind || 'deep',
              tier: itemToMove.tier || 'need_to',
              start_time: isoTime(destDate, newStartH, newStartM),
              end_time: isoTime(destDate, newEndH, newEndM),
              status: 'scheduled',
              is_fixed: false,
              done: false,
              displaced_by_task_id: null,
              displacement_reason: `Rescheduled from ${sourceDayName} based on your feedback.`,
              move_count: (itemToMove.move_count || 0) + 1,
            });

            destSched.items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
            destSched.version = (destSched.version || 1) + 1;

            // Remove/displace from sourceSched
            sourceSched.items.splice(itemIdx, 1);
            sourceSched.version = (sourceSched.version || 1) + 1;

            const reasonContext = mentionedCommitment ? ` to protect your recovery time after ${mentionedCommitment}` : ' to protect your recovery time';
            whatChanged.push(`Moved "${matchedTaskTitle}" from ${sourceDayName} to ${destDayName}${reasonContext}.`);

            movedSuccessfully = true;
            break;
          }
        }

        if (movedSuccessfully) break;
      }
    }
  }

  // Case 2: General fatigue / overload
  const isTiredOrOverwhelmed =
    textLower.includes('too much') ||
    textLower.includes('tired') ||
    textLower.includes('exhaust') ||
    textLower.includes('drained') ||
    textLower.includes('plate') ||
    textLower.includes('overwhelm');

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

  if (whatChanged.length === 0) {
    for (let offset = 1; offset <= 4; offset++) {
      const candidateDate = addDays(todayDate(), offset);
      const dateStr = ymd(candidateDate);
      const sched = schedules.find((s) => s.date === dateStr);
      if (!sched || sched.is_closed) continue;

      sched.version = (sched.version || 1) + 1;

      if (isTiredOrOverwhelmed) {
        preferences.daily_load_cap_mins = Math.max(180, (preferences.daily_load_cap_mins || 360) - 60);

        const lowerItem = sched.items.find((i) => !i.is_fixed && i.tier !== 'have_to' && i.status !== 'displaced');
        if (lowerItem) {
          lowerItem.status = 'displaced';
          lowerItem.displacement_reason = `Moved to your next deep-work block to prevent overload.`;
          whatChanged.push(
            `Lightened ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })}: shifted "${lowerItem.title}" to protect your energy.`
          );
        }
      } else if (isWrongTime) {
        const deepItem = sched.items.find((i) => i.kind === 'deep' && !i.is_fixed);
        if (deepItem) {
          deepItem.start_time = isoTime(candidateDate, 10, 0);
          deepItem.end_time = isoTime(candidateDate, 11, 30);
          whatChanged.push(
            `Adjusted deep focus on ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })} to 10:00 AM based on your peak energy.`
          );
        }
      } else if (isShortBreaks) {
        const breakItem = sched.items.find((i) => i.kind === 'break');
        if (breakItem) {
          breakItem.end_time = isoTime(candidateDate, 20, 15);
          whatChanged.push(
            `Extended recovery break on ${candidateDate.toLocaleDateString('en-US', { weekday: 'short' })} to 45 minutes.`
          );
        }
      }
    }
  }

  if (whatChanged.length === 0) {
    whatChanged.push(
      'Reviewed upcoming days from tomorrow onward. Your schedule is well balanced with no immediate shifts required.'
    );
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
    'break', 'rest', 'sick', 'heavy', 'light', 'move', 'shift', 'reschedule',
    'prefer', 'deadline', 'assignment', 'homework', 'drained', 'overwhelm', 'rotation', 'practice'
  ];
  const hasKeyword = knownKeywords.some((k) => lower.includes(k));
  return !hasKeyword;
}

export async function disrupt(text, date) {
  await delay();
  const dateStr = date ? (typeof date === 'string' ? date : ymd(date)) : ymd(todayDate());
  const targetIdx = schedules.findIndex((s) => s.date === dateStr);
  let target = targetIdx >= 0 ? schedules[targetIdx] : schedules[0];

  if (!target) {
    target = buildScheduleItems(todayDate(), 1);
    schedules.push(target);
    persistState();
  }

  // Clone the schedule and bump version
  const updated = JSON.parse(JSON.stringify(target));
  updated.version = (updated.version || 1) + 1;

  const textLower = (text || '').toLowerCase();
  const isExhausted = textLower.includes('exhaust') || textLower.includes('tired') || textLower.includes('sick');

  const what_changed = [];
  const at_risk = [];

  if (isExhausted) {
    const nonFixedItems = updated.items.filter((i) => !i.is_fixed && i.kind !== 'break' && i.kind !== 'decompression');
    if (nonFixedItems.length > 0) {
      const itemToDisplace = nonFixedItems[nonFixedItems.length - 1];
      itemToDisplace.displacement_reason = 'Moved to tomorrow because you need recovery time tonight.';
      itemToDisplace.status = 'displaced';

      what_changed.push(`Removed "${itemToDisplace.title}" from tonight and moved it to tomorrow.`);
      what_changed.push('Added extra rest time in the evening to help you recover.');
    } else {
      what_changed.push('Added extra recovery time to tonight to help you rest.');
    }
  } else {
    // Check if user is adding an urgent task / assignment
    const newTaskTitle = text.length > 30 ? text.slice(0, 30) + '…' : text;
    const deepBlocks = updated.items.filter((i) => (i.kind === 'deep' || i.kind === 'short') && !i.is_fixed);

    if (deepBlocks.length > 0) {
      const lowest = deepBlocks[deepBlocks.length - 1];
      lowest.displacement_reason = `Moved to make room for your priority: "${newTaskTitle}"`;
      lowest.status = 'displaced';

      what_changed.push(`Reorganised your schedule based on: "${text}"`);
      what_changed.push(`Moved "${lowest.title}" to a later slot to make room.`);
      what_changed.push('The rest of your plan stays on track.');

      at_risk.push({
        id: lowest.id,
        title: lowest.title,
        reason: 'Pushed to a later slot — make sure you have a free window.',
      });
    } else {
      what_changed.push(`Noted: "${text}". Your schedule looks manageable as-is — no changes needed right now.`);
    }
  }

  if (targetIdx >= 0) {
    schedules[targetIdx] = updated;
  } else {
    schedules.push(updated);
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
  const textLower = (text || '').toLowerCase();
  const isExhausted =
    textLower.includes('exhaust') ||
    textLower.includes('tired') ||
    textLower.includes("couldn't study") ||
    textLower.includes('rough');

  if (isExhausted) {
    const todaySchedule = schedules.find((s) => s.date === ymd(todayDate()));
    if (todaySchedule) {
      const candidate = todaySchedule.items.find((i) => !i.is_fixed && i.status !== 'displaced');
      if (candidate) {
        candidate.displacement_reason = 'Moved to your next deep-work block so you can recover tonight.';
        candidate.status = 'displaced';
        persistState();
        return {
          message: `That's completely okay. Everyone has days like that. I've lightened your evening — your "${candidate.title}" moved to your next free deep-work slot. Focus on rest tonight; you'll pick it up fresh tomorrow.`,
          schedule_updated: true,
        };
      }
    }

    return {
      message: "That's completely okay. Everyone has days like that. I've lightened your evening. Focus on rest tonight; you'll pick it up fresh tomorrow.",
      schedule_updated: true,
    };
  }

  const isGood =
    textLower.includes('good') ||
    textLower.includes('great') ||
    textLower.includes('works') ||
    textLower.includes('productive');

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
      const candidate = todaySchedule.items.find((i) => !i.is_fixed && i.kind !== 'break' && i.kind !== 'decompression' && i.status !== 'displaced');
      if (candidate) {
        candidate.displacement_reason =
          'Moved to your next deep-work block so you can recover tonight.';
        candidate.status = 'displaced';
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
  preferences = {
    ...preferences,
    ...answers,
  };
  onboarded = true;
  persistState();
  return preferences;
}
