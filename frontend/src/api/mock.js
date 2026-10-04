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
let _id = 100;
const uid = () => ++_id;
const delay = () => new Promise((r) => setTimeout(r, 600 + Math.random() * 300));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d, h, m = 0) =>
  `${ymd(d)}T${pad(h)}:${pad(m)}:00`;

function todayDate() {
  return new Date();
}

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

/* ---------- Seed Data ---------- */

const today = todayDate();
const tomorrow = tomorrowDate();
const friday = (() => {
  const d = new Date();
  const diff = 5 - d.getDay();
  d.setDate(d.getDate() + (diff <= 0 ? diff + 7 : diff));
  return d;
})();

const INITIAL_TASKS = [
  {
    id: uid(), title: 'Classes', category: 'academic', task_type: 'fixed',
    deadline: isoTime(today, 9), estimated_duration: 420, priority: 3,
    status: 'scheduled', is_fixed: true,
  },
  {
    id: uid(), title: 'Gym', category: 'health', task_type: 'fixed',
    deadline: isoTime(today, 18), estimated_duration: 60, priority: 3,
    status: 'scheduled', is_fixed: true,
  },
  {
    id: uid(), title: 'Classes', category: 'academic', task_type: 'fixed',
    deadline: isoTime(tomorrow, 9), estimated_duration: 420, priority: 3,
    status: 'scheduled', is_fixed: true,
  },
  {
    id: uid(), title: 'Gym', category: 'health', task_type: 'fixed',
    deadline: isoTime(tomorrow, 18), estimated_duration: 60, priority: 3,
    status: 'scheduled', is_fixed: true,
  },
  {
    id: uid(), title: 'DSA Practice', category: 'academic', task_type: 'growth',
    deadline: null, estimated_duration: 120, priority: 3,
    status: 'pending', is_fixed: false,
  },
  {
    id: uid(), title: 'DBMS Assignment', category: 'academic', task_type: 'deadline',
    deadline: isoTime(friday, 23, 59), estimated_duration: 180, priority: 4,
    status: 'pending', is_fixed: false,
  },
  {
    id: uid(), title: 'Maths Revision', category: 'academic', task_type: 'growth',
    deadline: null, estimated_duration: 90, priority: 2,
    status: 'pending', is_fixed: false,
  },
];

const DSA_ID = INITIAL_TASKS[4].id;
const DBMS_ID = INITIAL_TASKS[5].id;
const MATHS_ID = INITIAL_TASKS[6].id;

function buildScheduleItems(dateObj, version) {
  const date = ymd(dateObj);
  const items = [
    // Sleep (shown as context)
    {
      id: uid(), task_id: null, title: 'Sleep',
      kind: 'fixed', start_time: isoTime(dateObj, 0), end_time: isoTime(dateObj, 7),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // Morning classes
    {
      id: uid(), task_id: null, title: 'Classes',
      kind: 'fixed', start_time: isoTime(dateObj, 9), end_time: isoTime(dateObj, 16),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // Deep work: DSA
    {
      id: uid(), task_id: DSA_ID, title: 'DSA Practice',
      kind: 'deep', start_time: isoTime(dateObj, 16, 15), end_time: isoTime(dateObj, 18),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // Gym
    {
      id: uid(), task_id: null, title: 'Gym',
      kind: 'fixed', start_time: isoTime(dateObj, 18), end_time: isoTime(dateObj, 19),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // Break
    {
      id: uid(), task_id: null, title: 'Dinner & Rest',
      kind: 'break', start_time: isoTime(dateObj, 19), end_time: isoTime(dateObj, 19, 45),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // DBMS session
    {
      id: uid(), task_id: DBMS_ID, title: 'DBMS Assignment',
      kind: 'deep', start_time: isoTime(dateObj, 19, 45), end_time: isoTime(dateObj, 21, 45),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // Decompression
    {
      id: uid(), task_id: null, title: 'Wind Down',
      kind: 'decompression', start_time: isoTime(dateObj, 21, 45), end_time: isoTime(dateObj, 22, 15),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
    // Maths (short session)
    {
      id: uid(), task_id: MATHS_ID, title: 'Maths Revision',
      kind: 'short', start_time: isoTime(dateObj, 22, 15), end_time: isoTime(dateObj, 23),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    },
  ];
  return {
    id: uid(),
    date,
    version: version || 1,
    items,
  };
}

/* ---------- Mutable state ---------- */

let tasks = JSON.parse(JSON.stringify(INITIAL_TASKS));
let schedules = [buildScheduleItems(today, 1), buildScheduleItems(tomorrow, 1)];
let preferences = {
  wake_time: '07:00',
  sleep_time: '23:30',
  focus_length: 90,
  prefer_long_sessions: true,
  allow_splitting: true,
  juggles: ['classes', 'gym', 'assignments'],
};
let onboarded = false;

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
    deadline: data.deadline || null,
    estimated_duration: data.estimated_duration || 60,
    priority: data.priority || 3,
    status: 'pending',
    is_fixed: data.is_fixed || false,
  };
  tasks.push(task);
  return task;
}

export async function getSchedule(date) {
  await delay();
  const dateStr = typeof date === 'string' ? date : ymd(date);
  const found = schedules.find((s) => s.date === dateStr);
  if (found) return found;
  // Return today's schedule by default
  return schedules[0] || null;
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
  return newSchedule;
}

export async function disrupt(text, date) {
  await delay();
  const dateStr = date ? (typeof date === 'string' ? date : ymd(date)) : ymd(todayDate());
  const targetIdx = schedules.findIndex((s) => s.date === dateStr);
  const target = targetIdx >= 0 ? schedules[targetIdx] : schedules[0];

  if (!target) {
    return {
      schedule: buildScheduleItems(todayDate(), 1),
      what_changed: ['Generated a new schedule for today.'],
      at_risk: [],
    };
  }

  // Clone the schedule and bump version
  const updated = JSON.parse(JSON.stringify(target));
  updated.version += 1;

  // Check if this is an "OS practical" type disruption
  const isOsPractical = text.toLowerCase().includes('os practical') ||
                         text.toLowerCase().includes('practical');
  const isExhausted = text.toLowerCase().includes('exhaust') ||
                       text.toLowerCase().includes('tired') ||
                       text.toLowerCase().includes('sick');

  const what_changed = [];
  const at_risk = [];

  if (isOsPractical) {
    // Add an OS practical task
    const osPracticalTask = {
      id: uid(), title: 'OS Practical Prep', category: 'academic',
      task_type: 'deadline', deadline: isoTime(tomorrowDate(), 9),
      estimated_duration: 120, priority: 5, status: 'pending', is_fixed: false,
    };
    tasks.push(osPracticalTask);

    // Find the Maths block (lowest priority) and displace it
    const mathsIdx = updated.items.findIndex((i) => i.title === 'Maths Revision');
    if (mathsIdx >= 0) {
      updated.items[mathsIdx].displaced_by_task_id = osPracticalTask.id;
      updated.items[mathsIdx].displacement_reason =
        'Moved to tomorrow evening because your OS practical came up and needs priority today.';
      updated.items[mathsIdx].status = 'displaced';
    }

    // Insert OS practical in the evening slot
    updated.items.push({
      id: uid(), task_id: osPracticalTask.id, title: 'OS Practical Prep',
      kind: 'deep', start_time: isoTime(new Date(target.date + 'T00:00'), 22, 15),
      end_time: isoTime(new Date(target.date + 'T00:00'), 23, 45),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
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
    // Lighter schedule: remove Maths, shorten DBMS
    const mathsIdx = updated.items.findIndex((i) => i.title === 'Maths Revision');
    if (mathsIdx >= 0) {
      updated.items[mathsIdx].displaced_by_task_id = null;
      updated.items[mathsIdx].displacement_reason =
        'Moved to tomorrow because you need recovery time tonight.';
      updated.items[mathsIdx].status = 'displaced';
    }

    // Add extra decompression
    updated.items.push({
      id: uid(), task_id: null, title: 'Extra Rest',
      kind: 'decompression', start_time: isoTime(new Date(target.date + 'T00:00'), 22, 15),
      end_time: isoTime(new Date(target.date + 'T00:00'), 23),
      status: 'scheduled', displaced_by_task_id: null, displacement_reason: null,
    });

    what_changed.push(
      'Removed "Maths Revision" from tonight and moved it to tomorrow.',
      'Added extra rest time in the evening to help you recover.',
      'Your DBMS session stays — it\'s closer to the deadline. But take it easy.'
    );
  } else {
    // Generic disruption: move one block, add a buffer
    const deepBlocks = updated.items.filter((i) => i.kind === 'deep' || i.kind === 'short');
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

  // Update the schedule in our store
  if (targetIdx >= 0) {
    schedules[targetIdx] = updated;
  }

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
    // Lighten tonight's load
    const todaySchedule = schedules.find((s) => s.date === ymd(todayDate()));
    if (todaySchedule) {
      const mathsIdx = todaySchedule.items.findIndex((i) => i.title === 'Maths Revision' && i.status !== 'displaced');
      if (mathsIdx >= 0) {
        todaySchedule.items[mathsIdx].displacement_reason =
          'Moved to your next deep-work block so you can recover tonight.';
        todaySchedule.items[mathsIdx].status = 'displaced';
      }
    }

    return {
      message: "That's completely okay. Everyone has days like that. I've lightened your evening — your Maths revision moved to your next free deep-work slot. Focus on rest tonight; you'll pick it up fresh tomorrow.",
      schedule_updated: true,
    };
  }

  const isGood = text.toLowerCase().includes('good') ||
                  text.toLowerCase().includes('great') ||
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

export async function getPreferences() {
  await delay();
  return { ...preferences };
}

export async function savePreferences(prefs) {
  await delay();
  preferences = { ...preferences, ...prefs };
  onboarded = true;
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
  onboarded = true;
  return preferences;
}
