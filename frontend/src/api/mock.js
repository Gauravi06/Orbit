/**
 * Mock API layer for Orbit.
 *
 * Provides realistic fake data so the full demo works without a backend.
 * Every function returns a Promise that resolves after a 600-900ms delay
 * to make loading states visible.
 *
 * Shape contracts match the FastAPI backend exactly.
 */

import { parseTaskSemantics, parseDeadline, extractCleanTitle } from './semanticParser.js';
export { parseTaskSemantics, parseTaskSemanticsAsync, parseDeadline, extractCleanTitle } from './semanticParser.js';

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
let proposals = {}; // proposal_id -> { id, status, snapshot, what_changed, at_risk, summary, created_at }
let interventions = [];

export const DEFAULT_INSIGHTS = [
  {
    id: 'morning-peak-focus',
    title: 'Morning Deep Focus Peak Rhythm',
    badge: 'Productivity Rhythm',
    observation: 'You complete 85% of deep focus sessions scheduled before 11:00 AM, compared to 35% in late afternoons.',
    evidence: 'Over the last 14 days, 9 of 11 morning sessions were completed on time. Late afternoon sessions (especially after 4 PM) faced frequent fatigue delays and postponements.',
    adaptation: 'Orbit prioritizes challenging, high-cognitive coursework (such as DSA and Systems) in your morning window before college, keeping late afternoons for lighter tasks or recovery.',
    howAffectsProposals: 'When disruptions occur or time opens up, Orbit prioritizes morning study sessions and shields late afternoons from heavy cognitive loads.',
    appliedExample: 'When college cancelled today, Orbit automatically scheduled DSA in your morning slot.',
    userFeedback: null,
    feedbackMessage: null,
  },
  {
    id: 'lecture-fatigue-cushion',
    title: 'Post-Lecture Cognitive Fatigue Cushioning',
    badge: 'Energy Protection',
    observation: 'Days with 5+ hours of lectures (like Thursdays) consistently exhaust cognitive energy by 4 PM.',
    evidence: 'On Thursdays and heavy lab days in your 14-day history, scheduled evening study sessions were missed or deferred 3 times, accompanied by fatigue feedback notes.',
    adaptation: 'Orbit automatically cushions post-lecture returns with a mandatory 30-minute decompression buffer and defers demanding deliverables to the following morning.',
    howAffectsProposals: 'Orbit rejects back-to-back study blocks immediately following college returns and protects evening rest.',
    appliedExample: 'Avoids back-to-back study blocks immediately following college commute returns.',
    userFeedback: null,
    feedbackMessage: null,
  },
  {
    id: 'sustainable-session-capping',
    title: 'Sustainable 90-Minute Focus Capping',
    badge: 'Cognitive Capacity',
    observation: 'Focus sessions strictly capped at 90 minutes have a 92% completion rate, while marathon blocks show steep fatigue.',
    evidence: 'Sessions scheduled beyond 90 minutes were abandoned or cut short 60% of the time, whereas 60–90m focused blocks with recovery buffers had consistent follow-through.',
    adaptation: 'Orbit limits all continuous focus sessions to a maximum of 90 minutes and pairs them with an automatic 15-minute recovery buffer.',
    howAffectsProposals: 'All proposed schedule changes split long backlog tasks into 60–90 minute sessions separated by recovery buffers.',
    appliedExample: 'All deep focus blocks are strictly partitioned into 60–90m segments with recovery buffers.',
    userFeedback: null,
    feedbackMessage: null,
  },
];

let insights = JSON.parse(JSON.stringify(DEFAULT_INSIGHTS));

const CURRENT_SCHEDULER_VERSION = '2026.10.balanced_v8_live';

function inferTaskMeta(task) {
  const title = (task.title || task.name || 'Untitled').trim();
  const lowerTitle = title.toLowerCase();
  const note = (task.natural_language_note || '').toLowerCase();

  // If semantic_preferences is missing but natural_language_note exists, parse on the fly!
  let semPref = task.semantic_preferences;
  if ((!semPref || semPref.isEmpty) && task.natural_language_note) {
    const parsed = parseTaskSemantics(task.natural_language_note, task);
    semPref = parsed.isEmpty ? null : parsed;
  }
  semPref = semPref || {};

  // Duration
  const dur = Number(task.estimated_duration || task.duration || task.estimated_minutes || semPref.estimated_duration || 60);

  // Frequency & isOneTime
  // A task is a one-time deadline task if:
  // - It has an explicit deadline property (deliverable with a due date)
  // - Or frequency is explicitly 'one-time', 'one-off', 'once'
  const freq = (task.frequency || semPref.frequency || '').toLowerCase().trim();
  const hasDeadline = Boolean(task.deadline);
  const isOneTime =
    freq === 'one-time' ||
    freq === 'one-off' ||
    freq === 'once' ||
    hasDeadline;

  // Cognitive load / category
  let load = 'medium'; // 'high' | 'medium' | 'low' | 'physical' | 'flexible'
  if (
    lowerTitle.includes('gym') ||
    lowerTitle.includes('workout') ||
    lowerTitle.includes('exercise') ||
    lowerTitle.includes('swim') ||
    lowerTitle.includes('run') ||
    lowerTitle.includes('yoga')
  ) {
    load = 'physical';
  } else if (
    lowerTitle.includes('journal') ||
    lowerTitle.includes('plan') ||
    lowerTitle.includes('reflect') ||
    lowerTitle.includes('email') ||
    lowerTitle.includes('admin') ||
    dur <= 20
  ) {
    load = 'low';
  } else if (
    task.tier === 'have_to' ||
    task.priority >= 4 ||
    lowerTitle.includes('dsa') ||
    lowerTitle.includes('exam') ||
    lowerTitle.includes('assignment') ||
    lowerTitle.includes('problem set') ||
    lowerTitle.includes('project') ||
    lowerTitle.includes('coding') ||
    lowerTitle.includes('cat prep') ||
    lowerTitle.includes('gate prep') ||
    lowerTitle.includes('maths') ||
    lowerTitle.includes('deep work') ||
    lowerTitle.includes('practice')
  ) {
    load = 'high';
  }

  if (task.tier === 'like_to' || task.category === 'hobby' || task.category === 'personal') {
    load = 'flexible';
  }

  // Preferred time of day from note / semantics
  const prefTimes = Array.isArray(semPref.preferred_time) ? semPref.preferred_time : [];
  let preferredTime = semPref.time_of_day || null;
  if (prefTimes.includes('morning')) preferredTime = 'morning';
  else if (prefTimes.includes('afternoon')) preferredTime = 'afternoon';
  else if (prefTimes.includes('evening')) preferredTime = 'evening';

  if (!preferredTime) {
    if (note.includes('morning') || note.includes('early')) preferredTime = 'morning';
    else if (note.includes('afternoon') || note.includes('midday')) preferredTime = 'afternoon';
    else if (note.includes('evening') || note.includes('night') || note.includes('late')) preferredTime = 'evening';
  }

  // Habits usually prefer morning/evening
  if (!preferredTime && load === 'physical') {
    preferredTime = 'morning';
  }
  if (!preferredTime && load === 'low') {
    preferredTime = 'evening';
  }

  return {
    id: task.id,
    title,
    duration: dur,
    tier: task.tier || (task.priority >= 4 ? 'have_to' : task.priority === 3 ? 'need_to' : 'like_to'),
    kind: load === 'high' ? 'deep' : load === 'physical' ? 'short' : load === 'flexible' ? 'short' : 'short',
    load,
    frequency: freq || 'One-time',
    isOneTime,
    days: task.days || task.day || task.weekday || null,
    deadline: task.deadline || null,
    done: Boolean(task.done),
    preferredTime,
    natural_language_note: task.natural_language_note || null,
    semantic_preferences: semPref,
  };
}

/**
 * Calculates target scheduled date string(s) for a one-time deadline task across the week horizon.
 */
function getOneTimeTargetDates(taskMeta, baseDateObj) {
  const dur = taskMeta.duration;
  const today = todayDate();
  const todayStr = ymd(today);

  // If explicit day was set (e.g. Wednesday)
  if (taskMeta.days && typeof taskMeta.days === 'string') {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDayIdx = dayNames.indexOf(taskMeta.days.toLowerCase().trim());
    if (targetDayIdx >= 0) {
      const currentDayOfWeek = today.getDay();
      const monDiff = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
      const monday = addDays(today, monDiff);
      const dDiff = (targetDayIdx === 0 ? 7 : targetDayIdx) - 1;
      const candidate = ymd(addDays(monday, dDiff));
      return [{ dateStr: candidate, duration: dur }];
    }
  }

  // Determine max single session length based on focus length (default ~60-90m)
  const focusLen = Number(preferences.focus_length) || (preferences.focus_style === 'short' ? 45 : preferences.focus_style === 'long' ? 90 : 60);
  const maxSession = Math.max(45, Math.min(90, focusLen));

  // Splitting logic guided by semantic preferences and focus length
  const semPref = taskMeta.semantic_preferences || {};
  const wantsSplit = semPref.split_preference;
  const requestedCount = semPref.preferred_session_count;

  const shouldSplit = (dur > maxSession && preferences.allow_splitting !== false && wantsSplit !== false) ||
                      (wantsSplit === true && dur >= 30);

  if (taskMeta.deadline) {
    const deadlineDateStr = taskMeta.deadline.split('T')[0];
    const deadlineDate = new Date(deadlineDateStr + 'T00:00:00');

    if (shouldSplit) {
      let numSessions;
      if (requestedCount && requestedCount >= 2) {
        numSessions = Math.min(4, Math.max(2, requestedCount));
      } else {
        numSessions = Math.min(4, Math.max(2, Math.ceil(dur / maxSession)));
      }
      const sessionDur = Math.round(dur / numSessions);

      // Available days from today up to the deadline day (inclusive)
      const dDays = Math.max(1, Math.round((deadlineDate.getTime() - today.getTime()) / (24 * 3600 * 1000)));
      const maxOffset = Math.min(6, dDays);
      const candidateDates = [];

      // Spacing preference
      const forceConsecutive = semPref.spacing_preference === 'consecutive';
      if (!forceConsecutive && maxOffset + 1 >= numSessions * 2 - 1) {
        const startOffset = (maxOffset + 1 > numSessions * 2) ? 1 : 0;
        for (let s = 0; s < numSessions; s++) {
          const off = Math.min(maxOffset, startOffset + s * 2);
          candidateDates.push(ymd(addDays(today, off)));
        }
      } else {
        const step = maxOffset / Math.max(1, numSessions - 1);
        for (let s = 0; s < numSessions; s++) {
          const off = Math.min(maxOffset, Math.round(s * step));
          candidateDates.push(ymd(addDays(today, off)));
        }
      }

      // Ensure sum equals exact duration
      const result = [];
      let rem = dur;
      for (let s = 0; s < numSessions; s++) {
        const chunk = s === numSessions - 1 ? rem : sessionDur;
        rem -= chunk;
        result.push({ dateStr: candidateDates[s] || ymd(deadlineDate), duration: chunk });
      }
      return result;
    }

    // Small or medium task (<= maxSession): distribute between today and deadline
    const hash = (taskMeta.title || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const dDays = Math.max(0, Math.round((deadlineDate.getTime() - today.getTime()) / (24 * 3600 * 1000)));
    const targetOffset = dDays === 0 ? 0 : (hash % (dDays + 1));
    const targetDate = addDays(today, targetOffset);
    const targetDateStr = ymd(targetDate <= deadlineDate ? targetDate : deadlineDate);
    return [{ dateStr: targetDateStr, duration: dur }];
  }

  // No deadline: one-time task
  if (shouldSplit) {
    let numSessions = requestedCount && requestedCount >= 2 ? Math.min(4, requestedCount) : Math.min(4, Math.ceil(dur / maxSession));
    const sessionDur = Math.round(dur / numSessions);
    const candidateDates = [];
    for (let s = 0; s < numSessions; s++) {
      candidateDates.push(ymd(addDays(today, s * 2)));
    }
    const result = [];
    let rem = dur;
    for (let s = 0; s < numSessions; s++) {
      const chunk = s === numSessions - 1 ? rem : sessionDur;
      rem -= chunk;
      result.push({ dateStr: candidateDates[s] || todayStr, duration: chunk });
    }
    return result;
  }

  // Single one-time task without deadline: schedule directly on today
  return [{ dateStr: todayStr, duration: dur }];
}

function isTaskApplicableToDate(task, dateObj) {
  const dateStr = ymd(dateObj);
  const dayOfWeek = dateObj.getDay(); // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dayOfWeek];
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // If task is explicitly completed, do not schedule
  if (task.done) {
    return false;
  }

  // If task has a deadline and current date is strictly after deadline, do not schedule
  if (task.deadline) {
    const deadlineDateStr = task.deadline.split('T')[0];
    if (dateStr > deadlineDateStr) {
      return false;
    }
  }

  const meta = inferTaskMeta(task);

  // 1. One-time deadline tasks: check allocated target dates
  if (meta.isOneTime) {
    const semPref = meta.semantic_preferences || {};
    const wantsSplit = semPref.split_preference;
    const focusLen = Number(preferences.focus_length) || 60;
    const maxSession = Math.max(45, Math.min(90, focusLen));
    const isSplittable =
      (meta.duration > maxSession && preferences.allow_splitting !== false && wantsSplit !== false) ||
      (wantsSplit === true && meta.duration >= 30);

    if (!isSplittable) {
      // Single-session task: ensure it is not already scheduled on another active unclosed day
      const alreadyActiveElsewhere = schedules.some((s) => {
        if (s.date === dateStr || s.is_closed) return false;
        return (s.items || []).some((it) => {
          if (it.status === 'displaced' || it.is_fixed || it.done) return false;
          if (task.id && it.task_id && task.id === it.task_id) return true;
          if (it.title && task.title && it.title.toLowerCase() === task.title.toLowerCase()) return true;
          return false;
        });
      });
      if (alreadyActiveElsewhere) return false;
    }

    const targetAllocations = getOneTimeTargetDates(meta, dateObj);
    return targetAllocations.some((alloc) => alloc.dateStr === dateStr);
  }

  // 2. Explicit days array or string for recurring tasks
  const rawDays = meta.days;
  if (rawDays) {
    const dayAbbr = dayName.toLowerCase().slice(0, 3);
    if (Array.isArray(rawDays) && rawDays.length > 0) {
      return rawDays.some((d) => {
        if (typeof d !== 'string') return false;
        const dl = d.toLowerCase().trim();
        return dl === dayName.toLowerCase() || dl === dayAbbr;
      });
    }
    if (typeof rawDays === 'string' && rawDays.trim()) {
      const dLower = rawDays.toLowerCase().trim();
      if (dLower === 'daily' || dLower === 'every day') return true;
      if (dLower === 'weekdays' || dLower === 'monday–friday' || dLower === 'monday-friday' || dLower === 'weekdays only') return !isWeekend;
      if (dLower === 'weekends' || dLower === 'weekends only') return isWeekend;
      if (dLower === dayName.toLowerCase() || dLower.includes(dayName.toLowerCase())) return true;
      const tokens = dLower.split(/[\s,–\-/]+/).map((t) => t.trim());
      if (tokens.includes(dayAbbr) || dLower.includes(dayAbbr)) return true;
      return false;
    }
  }

  // 3. Frequency check
  const freq = meta.frequency.toLowerCase();
  if (freq === 'daily' || freq === 'every day') return true;
  if (freq === 'weekdays' || freq === 'monday–friday' || freq === 'monday-friday' || freq === 'weekdays only') return !isWeekend;
  if (freq === 'weekends' || freq === 'weekends only') return isWeekend;
  if (freq === 'weekly' || freq === '1x a week' || freq === 'once a week') {
    return dayOfWeek === 1; // Default Monday if no day specified
  }
  if (freq === '2x a week' || freq === 'twice a week') {
    return dayOfWeek === 2 || dayOfWeek === 4; // Tue & Thu
  }
  if (freq === '2-3x a week' || freq === '3-4x a week' || freq === '3x a week') {
    return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5; // Mon, Wed, Fri
  }
  if (freq === 'regularly') {
    return !isWeekend;
  }
  if (freq === dayName.toLowerCase()) return true;

  return true;
}

function buildScheduleItems(dateObj, version, overridePrefs) {
  const date = ymd(dateObj);
  const prefs = overridePrefs || preferences || DEFAULT_PREFERENCES;

  const wakeStr = prefs.wake_time && prefs.wake_time !== 'no_pref' ? prefs.wake_time : '07:00';
  const sleepStr = prefs.sleep_time && prefs.sleep_time !== 'no_pref' ? prefs.sleep_time : '23:30';
  const wakeMins = parseTimeToMins(wakeStr);
  let sleepMins = parseTimeToMins(sleepStr);
  if (sleepMins <= wakeMins) {
    sleepMins = 23 * 60 + 59;
  }

  const dayOfWeek = dateObj.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[dayOfWeek];
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Behavioral & Energy Preferences
  const energyPeak = (prefs.energy || prefs.best_time_of_day || 'morning').toLowerCase();
  const focusLen = Number(prefs.focus_length) || (prefs.focus_style === 'short' ? 45 : prefs.focus_style === 'long' ? 90 : 60);
  const breakMins = prefs.break_preference === 'frequent' ? 20 : prefs.break_preference === 'fewer_longer' ? 25 : 15;

  const items = [];

  const addBlock = ({
    taskId = null,
    title,
    kind,
    tier = 'need_to',
    startMins,
    endMins,
    isFixed = false,
    displacementReason = null,
    suggestion = null,
    status = 'scheduled',
  }) => {
    const safeStart = Math.max(wakeMins, Math.min(sleepMins - 10, startMins));
    const safeEnd = Math.max(safeStart + 10, Math.min(sleepMins, endMins));
    if (safeEnd <= safeStart) return;

    const startH = Math.floor(safeStart / 60);
    const startM = safeStart % 60;
    const endH = Math.floor(safeEnd / 60);
    const endM = safeEnd % 60;

    items.push({
      id: uid(),
      task_id: taskId,
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
      suggestion,
      move_count: 0,
    });
  };

  // 1. Fixed Commitments and Buffers
  const prefCommitments = Array.isArray(prefs.fixed_commitments) ? prefs.fixed_commitments : [];
  const taskFixed = tasks.filter((t) => t.is_fixed).map((t) => ({
    id: t.id,
    name: t.title,
    start_time: t.start_time || (t.deadline ? t.deadline.split('T')[1]?.slice(0, 5) : '09:00'),
    end_time: t.end_time || '10:00',
    commute_before: t.commute_before || 0,
    commute_after: t.commute_after || 0,
    days: t.days || 'Daily',
  }));

  const allRawCommitments = [...prefCommitments, ...taskFixed];
  const seenCommSignatures = new Set();
  const dedupedCommitments = [];
  allRawCommitments.forEach((c) => {
    const name = (c.name || c.title || '').trim();
    const days = (c.days || 'Daily').trim();
    const start = c.start_time || '';
    const end = c.end_time || '';
    const cBefore = Number(c.commute_before) || 0;
    const cAfter = Number(c.commute_after) || 0;
    const sig = `${name}|${days}|${start}|${end}|${cBefore}|${cAfter}`.toLowerCase();
    if (name && !seenCommSignatures.has(sig)) {
      seenCommSignatures.add(sig);
      dedupedCommitments.push({ ...c, name, days, start_time: start, end_time: end, commute_before: cBefore, commute_after: cAfter });
    }
  });

  const dayCommitments = dedupedCommitments.filter((c) => {
    const dLower = (c.days || 'Daily').toLowerCase().trim();
    if (!c.days || dLower === 'daily' || dLower === 'every day') return true;
    if (dLower === 'monday–friday' || dLower === 'monday-friday' || dLower === 'weekdays' || dLower === 'weekdays only') return !isWeekend;
    if (dLower === 'weekends' || dLower === 'weekends only') return isWeekend;
    return dLower === dayName.toLowerCase() || dLower.includes(dayName.toLowerCase());
  });

  const busyIntervals = [];
  let totalFixedCommitmentMins = 0;

  dayCommitments.forEach((c) => {
    const cStart = parseTimeToMins(c.start_time);
    const cEnd = parseTimeToMins(c.end_time);
    const cBefore = Number(c.commute_before) || 0;
    const cAfter = Number(c.commute_after) || 0;
    const cDuration = cEnd - cStart;
    totalFixedCommitmentMins += cDuration;

    // Commute before
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

    // Fixed commitment
    addBlock({
      taskId: null,
      title: c.name,
      kind: 'fixed',
      tier: 'have_to',
      startMins: cStart,
      endMins: cEnd,
      isFixed: true,
    });

    // Commute after / Decompression buffer
    const postBuffer = cAfter > 0 ? cAfter : (cDuration >= 180 ? 20 : 0);
    if (postBuffer > 0 && cEnd + postBuffer <= sleepMins) {
      addBlock({
        taskId: null,
        title: cAfter > 0 ? `Transition: ${c.name}` : `Buffer after ${c.name}`,
        kind: 'break',
        tier: 'have_to',
        startMins: cEnd,
        endMins: cEnd + postBuffer,
        isFixed: true,
      });
    }

    busyIntervals.push({
      start: Math.max(wakeMins, cStart - cBefore),
      end: Math.min(sleepMins, cEnd + postBuffer),
    });
  });

  // 2. Human Meals (Nourishment & Routine)
  const isSlotFree = (start, end) => {
    return !busyIntervals.some((b) => Math.max(start, b.start) < Math.min(end, b.end));
  };

  // Breakfast (target ~08:00–08:45, 30–45m)
  if (wakeMins <= 510) {
    let bStart = Math.max(wakeMins + 15, 480); // ~08:00
    let bEnd = bStart + 35;
    if (isSlotFree(bStart, bEnd)) {
      addBlock({
        taskId: null,
        title: 'Breakfast',
        kind: 'routine',
        tier: 'have_to',
        startMins: bStart,
        endMins: bEnd,
        isFixed: true,
      });
      busyIntervals.push({ start: bStart, end: bEnd });
    }
  }

  // Lunch (target ~12:15–13:00 or 12:30–13:15, 45m)
  if (wakeMins <= 750 && sleepMins >= 810) {
    let lStart = 750; // 12:30
    let lEnd = 795;   // 13:15
    if (!isSlotFree(lStart, lEnd)) {
      if (isSlotFree(735, 780)) { lStart = 735; lEnd = 780; } // 12:15-13:00
      else if (isSlotFree(800, 845)) { lStart = 800; lEnd = 845; } // 13:20-14:05
    }
    if (isSlotFree(lStart, lEnd)) {
      addBlock({
        taskId: null,
        title: 'Lunch',
        kind: 'routine',
        tier: 'have_to',
        startMins: lStart,
        endMins: lEnd,
        isFixed: true,
      });
      busyIntervals.push({ start: lStart, end: lEnd });
    }
  }

  // Dinner (target ~19:30–20:15, 45m)
  if (sleepMins >= 1230) {
    let dStart = 1170; // 19:30
    let dEnd = 1215;   // 20:15
    if (!isSlotFree(dStart, dEnd)) {
      if (isSlotFree(1140, 1185)) { dStart = 1140; dEnd = 1185; } // 19:00-19:45
      else if (isSlotFree(1200, 1245)) { dStart = 1200; dEnd = 1245; } // 20:00-20:45
    }
    if (isSlotFree(dStart, dEnd)) {
      addBlock({
        taskId: null,
        title: 'Dinner',
        kind: 'routine',
        tier: 'have_to',
        startMins: dStart,
        endMins: dEnd,
        isFixed: true,
      });
      busyIntervals.push({ start: dStart, end: dEnd });
    }
  }

  // Wind Down (30 min before bedtime)
  const windDownStart = sleepMins - 30;
  if (isSlotFree(windDownStart, sleepMins)) {
    addBlock({
      taskId: null,
      title: 'Wind Down',
      kind: 'decompression',
      tier: 'like_to',
      startMins: windDownStart,
      endMins: sleepMins,
      isFixed: true,
    });
    busyIntervals.push({ start: windDownStart, end: sleepMins });
  }

  // Merge busy intervals
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

  // Compute available free intervals
  const availableSlots = [];
  let currentPtr = wakeMins;
  const latestWorkTime = sleepMins - 30;

  for (const b of mergedBusy) {
    if (b.start > currentPtr) {
      const freeStart = currentPtr;
      const freeEnd = Math.min(latestWorkTime, b.start);
      if (freeEnd - freeStart >= 15) {
        availableSlots.push({ start: freeStart, end: freeEnd, duration: freeEnd - freeStart });
      }
    }
    currentPtr = Math.max(currentPtr, b.end);
  }
  if (currentPtr < latestWorkTime && latestWorkTime - currentPtr >= 15) {
    availableSlots.push({ start: currentPtr, end: latestWorkTime, duration: latestWorkTime - currentPtr });
  }

  // 3. Cognitive Load Budget
  // After substantial fixed commitments, reduce cognitive study capacity!
  let maxCognitiveStudyMins = 270; // Default 4.5 hours max
  let maxHighCognitiveBlocks = 3;

  if (totalFixedCommitmentMins >= 360) {
    // Heavy fixed day (e.g. 6-8 hours Hospital Rotation / College)
    maxCognitiveStudyMins = 120;
    maxHighCognitiveBlocks = 2;
  } else if (totalFixedCommitmentMins >= 180) {
    // Moderate fixed day (e.g. 3-4 hours College)
    maxCognitiveStudyMins = 210;
    maxHighCognitiveBlocks = 3; // 1 substantial deep work + 1-2 smaller coursework
  } else if (isWeekend) {
    maxCognitiveStudyMins = prefs.weekend_mode === 'off' ? 60 : 180;
    maxHighCognitiveBlocks = 2;
  }

  // 4. Queue Applicable User Tasks
  const needToList = Array.isArray(prefs.need_to_items) ? prefs.need_to_items.map((i) => ({ ...i, tier: 'have_to' })) : [];
  const shouldDoList = Array.isArray(prefs.should_do_items) ? prefs.should_do_items.map((i) => ({ ...i, tier: 'need_to' })) : [];
  const likeToList = Array.isArray(prefs.like_to_items) ? prefs.like_to_items.map((i) => ({ ...i, tier: 'like_to' })) : [];
  const standaloneTasks = tasks.filter((t) => !t.is_fixed);

  const allRawTasks = [...standaloneTasks, ...needToList, ...shouldDoList, ...likeToList];
  const seenTaskTitles = new Set();
  const dedupedUserTasks = [];
  allRawTasks.forEach((t) => {
    const title = (t.title || t.name || '').trim();
    if (title && !seenTaskTitles.has(title.toLowerCase())) {
      seenTaskTitles.add(title.toLowerCase());
      dedupedUserTasks.push(t);
    }
  });

  const dailyTaskQueue = [];

  dedupedUserTasks.forEach((t) => {
    if (isTaskApplicableToDate(t, dateObj)) {
      const meta = inferTaskMeta(t);
      let effectiveDuration = meta.duration;
      if (meta.isOneTime) {
        const targets = getOneTimeTargetDates(meta, dateObj);
        const match = targets.find((alloc) => alloc.dateStr === date);
        if (match) {
          effectiveDuration = match.duration;
        }
      }

      dailyTaskQueue.push({
        ...meta,
        duration: effectiveDuration,
      });
    }
  });

  // Sort queue: Habits first, then High-Cognitive, Medium, Low, Flexible last
  dailyTaskQueue.sort((a, b) => {
    const loadWeight = { physical: 1, high: 2, medium: 3, low: 4, flexible: 5 };
    return (loadWeight[a.load] || 3) - (loadWeight[b.load] || 3);
  });

  let scheduledCognitiveMins = 0;
  let scheduledHighCognitiveCount = 0;

  for (const task of dailyTaskQueue) {
    if (task.load === 'high') {
      if (scheduledHighCognitiveCount >= maxHighCognitiveBlocks) continue;
      if (scheduledCognitiveMins + task.duration > maxCognitiveStudyMins + 15) continue;
    } else if (task.load === 'medium') {
      if (scheduledCognitiveMins + task.duration > maxCognitiveStudyMins + 30) continue;
    } else if (task.load === 'flexible') {
      if (scheduledCognitiveMins >= maxCognitiveStudyMins - 30) continue;
    }

    // Find best slot
    let bestSlotIdx = -1;
    let bestScore = -999;

    availableSlots.forEach((slot, idx) => {
      if (slot.duration < Math.min(task.duration, 30)) return;

      let score = 10;
      const slotMid = (slot.start + slot.end) / 2;
      const isMorning = slotMid < 720;
      const isAfternoon = slotMid >= 720 && slotMid < 1020;
      const isEvening = slotMid >= 1020;

      if (slot.duration >= task.duration) score += 25;

      if (task.load === 'high') {
        if (energyPeak === 'morning' && isMorning) score += 20;
        if (energyPeak === 'afternoon' && isAfternoon) score += 20;
        if (energyPeak === 'evening' && isEvening) score += 20;
      }

      // Semantic preferences scoring
      const semPref = task.semantic_preferences || {};
      const prefTimes = Array.isArray(semPref.preferred_time) ? semPref.preferred_time : [];
      const avoidTimes = Array.isArray(semPref.avoid_time) ? semPref.avoid_time : [];

      const isPrefMorning = prefTimes.includes('morning') || task.preferredTime === 'morning';
      const isPrefAfternoon = prefTimes.includes('afternoon') || task.preferredTime === 'afternoon';
      const isPrefEvening = prefTimes.includes('evening') || task.preferredTime === 'evening';

      const prefBonus = semPref.strength === 'required' ? 45 : 30;

      if (isPrefMorning && isMorning) score += prefBonus;
      if (isPrefAfternoon && isAfternoon) score += prefBonus;
      if (isPrefEvening && isEvening) score += prefBonus;

      if (task.load === 'physical' && (isMorning || isEvening)) score += 15;

      // After fixed commitment (e.g. "after college", "after a break after clg")
      if (semPref.after_commitment || prefTimes.includes('after_fixed_commitment_recovery') || prefTimes.includes('after_commitment')) {
        const targetName = (semPref.after_commitment || 'college').toLowerCase();
        const matchComm = dayCommitments.find((c) => (c.name || '').toLowerCase().includes(targetName));
        if (matchComm) {
          const commEnd = parseTimeToMins(matchComm.end_time) + (matchComm.commute_after || 0);
          if (slot.start >= commEnd) {
            score += 40;
            // Extra bonus if scheduled within 2.5 hours of ending (ideal recovery focus window)
            if (slot.start <= commEnd + 150) {
              score += 15;
            }
          } else {
            // Penalize slots before the commitment when user requested after
            score -= 40;
          }
        }
      }

      // Before fixed commitment
      if (semPref.before_commitment || prefTimes.includes('before_commitment')) {
        const targetName = (semPref.before_commitment || 'college').toLowerCase();
        const matchComm = dayCommitments.find((c) => (c.name || '').toLowerCase().includes(targetName));
        if (matchComm) {
          const commStart = parseTimeToMins(matchComm.start_time) - (matchComm.commute_before || 0);
          if (slot.end <= commStart) {
            score += 40;
          } else {
            score -= 40;
          }
        }
      }

      // Avoid last task of the day
      if (semPref.avoid_last_task || avoidTimes.includes('last_task_of_day')) {
        if (slot.end >= latestWorkTime - 60 || idx === availableSlots.length - 1) {
          score -= 50;
        }
      }

      // Avoid specific times
      if (avoidTimes.includes('night') && slotMid >= 1260) score -= 50;
      if (avoidTimes.includes('morning') && isMorning) score -= 50;
      if (avoidTimes.includes('afternoon') && isAfternoon) score -= 50;
      if (avoidTimes.includes('evening') && isEvening) score -= 50;

      if (score > bestScore) {
        bestScore = score;
        bestSlotIdx = idx;
      }
    });

    if (bestSlotIdx >= 0) {
      const slot = availableSlots[bestSlotIdx];
      const maxBlockLimit = Math.min(task.duration, focusLen);
      const taskDur = Math.min(task.duration, Math.min(slot.duration, maxBlockLimit));

      addBlock({
        taskId: task.id || null,
        title: task.title,
        kind: task.kind,
        tier: task.tier,
        startMins: slot.start,
        endMins: slot.start + taskDur,
      });

      slot.start += taskDur;
      slot.duration -= taskDur;

      if (task.load === 'high') {
        scheduledHighCognitiveCount++;
        scheduledCognitiveMins += taskDur;

        // Insert 15m recovery buffer if remaining slot has space
        if (slot.duration >= breakMins) {
          addBlock({
            taskId: null,
            title: 'Recovery Buffer',
            kind: 'break',
            tier: 'like_to',
            startMins: slot.start,
            endMins: slot.start + breakMins,
            isFixed: true,
          });
          slot.start += breakMins;
          slot.duration -= breakMins;
        }
      } else if (task.load === 'medium') {
        scheduledCognitiveMins += taskDur;
      }
    }
  }

  // 5. Open Blocks: Transform all remaining continuous free windows >= 45m into Open Blocks
  availableSlots.forEach((slot) => {
    if (slot.duration >= 45) {
      const mid = (slot.start + slot.end) / 2;
      const isEvening = mid >= 1020;
      const isMidday = mid >= 720 && mid < 1020;

      const suggestion = isEvening
        ? 'Use this time flexibly: catch up, spend time with friends or family, work on a preferred hobby, or simply decompress.'
        : isMidday
        ? 'Unstructured personal time: take a walk, read, recharge, or handle personal errands.'
        : 'Open personal window: ease into your day, personal projects, or quiet reflection.';

      addBlock({
        taskId: null,
        title: 'Open Block',
        kind: 'open',
        tier: 'like_to',
        startMins: slot.start,
        endMins: slot.end,
        isFixed: true,
        suggestion,
      });
    }
  });

  // Chronological sort
  items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  return {
    id: uid(),
    date,
    scheduler_version: CURRENT_SCHEDULER_VERSION,
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
      // Mark past items as done for demo realism without fake displacement reasons
      sched.items.forEach((item) => {
        if (!item.is_fixed) {
          item.done = true;
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
const STORAGE_KEY_PROPOSALS = 'orbit_mock_proposals';
const STORAGE_KEY_INSIGHTS = 'orbit_mock_insights';
const STORAGE_KEY_INTERVENTIONS = 'orbit_demo_interventions';

export function loadStoredState() {
  let loadedTasks = null;
  let loadedSchedules = null;
  let loadedPrefs = null;
  let loadedOnboarded = null;

  try {
    const rawInsights = localStorage.getItem(STORAGE_KEY_INSIGHTS);
    if (rawInsights) insights = JSON.parse(rawInsights);
  } catch { /* ignore */ }

  try {
    const rawProposals = localStorage.getItem(STORAGE_KEY_PROPOSALS);
    if (rawProposals) proposals = JSON.parse(rawProposals);
  } catch { /* ignore */ }

  try {
    const rawInterventions = localStorage.getItem(STORAGE_KEY_INTERVENTIONS);
    if (rawInterventions) interventions = JSON.parse(rawInterventions);
  } catch { /* ignore */ }

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

  // Deduplicate fixed commitments in loadedTasks by canonical signature
  if (Array.isArray(loadedTasks)) {
    const seenFixedSignatures = new Set();
    const cleanTasks = [];
    for (const t of loadedTasks) {
      if (t.is_fixed) {
        const title = (t.title || t.name || '').trim();
        const days = (t.days || 'Daily').trim();
        const start = t.start_time || '';
        const end = t.end_time || '';
        const cBefore = Number(t.commute_before) || 0;
        const cAfter = Number(t.commute_after) || 0;
        const sig = `${title}|${days}|${start}|${end}|${cBefore}|${cAfter}`.toLowerCase();
        if (!seenFixedSignatures.has(sig)) {
          seenFixedSignatures.add(sig);
          cleanTasks.push(t);
        }
      } else {
        cleanTasks.push(t);
      }
    }
    loadedTasks = cleanTasks;
  }

  try {
    const rawSchedules = localStorage.getItem(STORAGE_KEY_SCHEDULES);
    if (rawSchedules) loadedSchedules = JSON.parse(rawSchedules);
  } catch { /* ignore */ }

  try {
    const rawOnboarded = localStorage.getItem(STORAGE_KEY_ONBOARDED);
    if (rawOnboarded !== null) loadedOnboarded = JSON.parse(rawOnboarded);
  } catch { /* ignore */ }

  tasks = loadedTasks || JSON.parse(JSON.stringify(INITIAL_TASKS));
  onboarded = loadedOnboarded ?? false;

  let finalSchedules = loadedSchedules;
  if (finalSchedules && Array.isArray(finalSchedules)) {
    // Regenerate any schedules that have an outdated or missing scheduler_version
    finalSchedules = finalSchedules.map((s) => {
      if (s.scheduler_version !== CURRENT_SCHEDULER_VERSION) {
        const dateObj = new Date(s.date + 'T00:00:00');
        const fresh = buildScheduleItems(dateObj, s.version || 1);
        fresh.is_closed = !!s.is_closed;
        fresh.closed_at = s.closed_at || null;
        if (Array.isArray(s.items)) {
          const doneTitles = new Set(s.items.filter((it) => it.done).map((it) => (it.title || '').toLowerCase()));
          fresh.items.forEach((it) => {
            if (it.title && doneTitles.has(it.title.toLowerCase())) {
              it.done = true;
            }
          });
        }
        return fresh;
      }
      return s;
    });
  }

  if (!finalSchedules) {
    finalSchedules = buildSeedPastDays();
    // Ensure today and tomorrow exist in fallbackSchedules
    const todayStr = ymd(todayDate());
    if (!finalSchedules.some((s) => s.date === todayStr)) {
      finalSchedules.push(buildScheduleItems(todayDate(), 1));
    }
    const tomStr = ymd(addDays(todayDate(), 1));
    if (!finalSchedules.some((s) => s.date === tomStr)) {
      finalSchedules.push(buildScheduleItems(addDays(todayDate(), 1), 1));
    }
  }

  schedules = finalSchedules;

  return {
    tasks: tasks,
    schedules: finalSchedules,
    preferences: preferences,
    onboarded: onboarded,
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
  try {
    localStorage.setItem(STORAGE_KEY_PROPOSALS, JSON.stringify(proposals));
  } catch { /* ignore */ }
  try {
    localStorage.setItem(STORAGE_KEY_INSIGHTS, JSON.stringify(insights));
  } catch { /* ignore */ }
  try {
    localStorage.setItem(STORAGE_KEY_INTERVENTIONS, JSON.stringify(interventions));
  } catch { /* ignore */ }
}

export function resetDemoState() {
  try {
    localStorage.removeItem(STORAGE_KEY_TASKS);
    localStorage.removeItem(STORAGE_KEY_SCHEDULES);
    localStorage.removeItem(STORAGE_KEY_PREFS);
    localStorage.removeItem(STORAGE_KEY_ONBOARDED);
    localStorage.removeItem(STORAGE_KEY_NOTES);
    localStorage.removeItem(STORAGE_KEY_PROPOSALS);
    localStorage.removeItem(STORAGE_KEY_INSIGHTS);
    localStorage.removeItem(STORAGE_KEY_INTERVENTIONS);
  } catch { /* ignore */ }

  proposals = {};
  interventions = [];
  insights = JSON.parse(JSON.stringify(DEFAULT_INSIGHTS));

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

/**
 * 14-Day Demo Seed: Isolated, repeatable demo student.
 * Creates realistic tasks, deadlines, 14-day schedule history (7 past, today, 6 future),
 * past completion/missed states, disruptions, and feedback observations.
 */
export function seedDemoStudent() {
  const now = todayDate();

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
    fixed_commitments: [
      {
        id: 2001,
        name: 'College Lectures',
        days: 'Mon, Tue, Wed, Thu, Fri',
        start_time: '09:00',
        end_time: '15:00',
        commute_before: 45,
        commute_after: 30,
      },
      {
        id: 2002,
        name: 'Algorithms Seminar',
        days: 'Tuesday',
        start_time: '15:30',
        end_time: '17:00',
        commute_before: 0,
        commute_after: 0,
      },
    ],
  };

  tasks = [
    {
      id: 3001,
      title: 'DSA Problem Set: Dynamic Programming',
      deadline: `${ymd(addDays(now, 2))}T23:59:00`,
      duration: 90,
      estimated_duration: 90,
      priority: 4,
      tier: 'have_to',
      category: 'study',
      done: false,
      natural_language_note: 'high focus, best in the morning before lectures',
    },
    {
      id: 3002,
      title: 'Operating Systems Lab Report',
      deadline: `${ymd(addDays(now, 4))}T23:59:00`,
      duration: 90,
      estimated_duration: 90,
      priority: 4,
      tier: 'have_to',
      category: 'study',
      done: false,
      natural_language_note: 'virtual memory benchmarks',
    },
    {
      id: 3003,
      title: 'Database Architecture Project',
      deadline: `${ymd(addDays(now, 7))}T23:59:00`,
      duration: 90,
      estimated_duration: 90,
      priority: 3,
      tier: 'need_to',
      category: 'study',
      done: false,
    },
    {
      id: 3004,
      title: 'Linear Algebra Problem Set',
      deadline: `${ymd(addDays(now, 10))}T23:59:00`,
      duration: 60,
      estimated_duration: 60,
      priority: 3,
      tier: 'need_to',
      category: 'study',
      done: false,
    },
    {
      id: 3005,
      title: 'Morning Gym & Mobility',
      duration: 60,
      estimated_duration: 60,
      priority: 3,
      tier: 'need_to',
      category: 'fitness',
      frequency: 'daily',
      done: false,
    },
    {
      id: 3006,
      title: 'Guitar Practice',
      duration: 45,
      estimated_duration: 45,
      priority: 2,
      tier: 'like_to',
      category: 'hobby',
      frequency: 'twice_weekly',
      done: false,
    },
    {
      id: 3007,
      title: 'Weekly Reflection & Journaling',
      duration: 30,
      estimated_duration: 30,
      priority: 2,
      tier: 'like_to',
      category: 'personal',
      done: false,
    },
  ];

  // 14-day history: 7 past days (-7 to -1), today (0), 6 upcoming days (1 to 6)
  schedules = [];
  for (let offset = -7; offset <= 6; offset++) {
    const d = addDays(now, offset);
    const sched = buildScheduleItems(d, 1);

    if (offset < 0) {
      sched.is_closed = true;
      sched.closed_at = isoTime(d, 23, 15);

      const dayOfWeek = d.getDay(); // 0 Sun ... 4 Thu

      sched.items.forEach((item) => {
        if (item.is_fixed) return;

        const startH = Number(item.start_time.split('T')[1].slice(0, 2));

        // Morning deep work sessions (before 12:00) had an 85% completion rate!
        if (startH < 12) {
          item.done = true;
        } else if (dayOfWeek === 2 && offset === -5) {
          if (item.title === 'College Lectures') {
            item.status = 'cancelled';
          }
          item.done = true;
        } else {
          item.done = offset % 2 === 0;
        }
      });

      if (dayOfWeek === 4) {
        // Thursday evening study session: missed due to post-lecture fatigue
        sched.items.push({
          id: uid(),
          task_id: 3004,
          title: 'Linear Algebra Problem Set',
          kind: 'deep',
          tier: 'need_to',
          start_time: isoTime(d, 17, 0),
          end_time: isoTime(d, 18, 0),
          status: 'displaced',
          is_fixed: false,
          done: false,
          displacement_reason: 'Displaced to Friday: heavy Thursday lecture fatigue.',
          move_count: 1,
        });
      }
    } else {
      sched.is_closed = false;
      sched.closed_at = null;
    }

    schedules.push(sched);
  }

  notes = [
    {
      id: uid(),
      date: ymd(addDays(now, -6)),
      text: 'Morning focus on DSA felt sharp. Completed recursive graph search before 9 AM lectures.',
      kind: 'reflection',
      created_at: isoTime(addDays(now, -6), 21, 30),
    },
    {
      id: uid(),
      date: ymd(addDays(now, -4)),
      text: 'Heavy Thursday lecture block left me drained by 4 PM. Could not focus on evening reading.',
      kind: 'feedback',
      created_at: isoTime(addDays(now, -4), 19, 0),
    },
    {
      id: uid(),
      date: ymd(addDays(now, -3)),
      text: 'Having a 30-minute decompression cushion after returning from college helped recharge for dinner.',
      kind: 'reflection',
      created_at: isoTime(addDays(now, -3), 22, 10),
    },
    {
      id: uid(),
      date: ymd(addDays(now, -1)),
      text: 'Protected 45 mins of guitar practice kept my week feeling balanced instead of all work.',
      kind: 'reflection',
      created_at: isoTime(addDays(now, -1), 21, 0),
    },
  ];

  insights = JSON.parse(JSON.stringify(DEFAULT_INSIGHTS));
  onboarded = true;
  proposals = {};

  persistState();
  return { tasks, schedules, preferences, notes, insights };
}

export async function getInsights() {
  await delay(100);
  return JSON.parse(JSON.stringify(insights));
}

export async function submitInsightFeedback(insightId, feedbackType) {
  await delay(100);
  const ins = insights.find((i) => i.id === insightId);
  if (ins) {
    ins.userFeedback = feedbackType;
    ins.feedbackMessage = feedbackType === 'yes'
      ? 'Preference confirmed: Orbit will continue prioritizing this rhythm in future schedule changes.'
      : 'Noted: Orbit has adjusted this weighting and will observe your updated preferences.';
    persistState();
    return { ...ins };
  }
  return null;
}

/* ---------- Interventions API ---------- */

export async function getInterventions(status = 'active') {
  await delay(100);
  const now = new Date();

  // 1. Awaken snoozed interventions whose time has arrived
  for (const inv of interventions) {
    if (inv.status === 'snoozed' && inv.snoozed_until && new Date(inv.snoozed_until) <= now) {
      inv.status = 'active';
      inv.snoozed_until = null;
      inv.updated_at = now.toISOString();
    }
  }

  // 2. Evaluate tasks for overdue and approaching deadlines (<24h)
  for (const task of tasks) {
    if (task.is_fixed) continue;

    // Resolve interventions if task is finished or cancelled
    if (task.done || ['completed', 'done', 'cancelled', 'deleted'].includes(task.status)) {
      for (const inv of interventions) {
        if (inv.task_id === task.id && (inv.status === 'active' || inv.status === 'snoozed')) {
          inv.status = 'resolved';
          inv.resolved_at = now.toISOString();
          inv.updated_at = now.toISOString();
        }
      }
      continue;
    }

    if (!task.deadline) {
      for (const inv of interventions) {
        if (inv.task_id === task.id && (inv.intervention_type === 'approaching_deadline' || inv.intervention_type === 'overdue') && (inv.status === 'active' || inv.status === 'snoozed')) {
          inv.status = 'resolved';
          inv.resolved_at = now.toISOString();
          inv.updated_at = now.toISOString();
        }
      }
    } else {
      const dStr = task.deadline.includes('T') ? task.deadline : `${task.deadline}T23:59:00`;
      const deadlineDate = new Date(dStr);
      if (!isNaN(deadlineDate.getTime())) {
        const diffHours = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (diffHours < 0) {
          // Overdue
          const dedupKey = `mock-user:${task.id}:overdue`;
          for (const inv of interventions) {
            if (inv.task_id === task.id && inv.intervention_type === 'approaching_deadline' && (inv.status === 'active' || inv.status === 'snoozed')) {
              inv.status = 'resolved';
              inv.resolved_at = now.toISOString();
              inv.updated_at = now.toISOString();
            }
          }
          let existing = interventions.find((i) => i.dedup_key === dedupKey);
          const title = `Overdue: ${task.title || task.name}`;
          const message = `'${task.title || task.name}' was due on ${deadlineDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}. Review your plan to reschedule or finish it.`;

          if (existing) {
            if (existing.status === 'active') {
              existing.title = title;
              existing.message = message;
              existing.updated_at = now.toISOString();
            } else if (existing.status === 'snoozed') {
              if (existing.snoozed_until && new Date(existing.snoozed_until) <= now) {
                existing.status = 'active';
                existing.snoozed_until = null;
                existing.title = title;
                existing.message = message;
                existing.updated_at = now.toISOString();
              }
            } else if (existing.status === 'resolved') {
              existing.status = 'active';
              existing.resolved_at = null;
              existing.title = title;
              existing.message = message;
              existing.updated_at = now.toISOString();
            }
          } else {
            interventions.unshift({
              id: String(uid()),
              user_id: 'mock-user',
              task_id: task.id,
              intervention_type: 'overdue',
              title,
              message,
              status: 'active',
              dedup_key: dedupKey,
              snoozed_until: null,
              dismissed_at: null,
              resolved_at: null,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          }
        } else if (diffHours <= 24) {
          // Approaching deadline
          const dedupKey = `mock-user:${task.id}:approaching_deadline`;
          for (const inv of interventions) {
            if (inv.task_id === task.id && inv.intervention_type === 'overdue' && (inv.status === 'active' || inv.status === 'snoozed')) {
              inv.status = 'resolved';
              inv.resolved_at = now.toISOString();
              inv.updated_at = now.toISOString();
            }
          }
          let existing = interventions.find((i) => i.dedup_key === dedupKey);
          const title = `Approaching deadline: ${task.title || task.name}`;
          const hoursRemaining = Math.max(0.1, Math.round(diffHours * 10) / 10);
          const hoursStr = Number.isInteger(hoursRemaining) ? `${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}` : `${hoursRemaining} hours`;
          const message = `'${task.title || task.name}' is due in ${hoursStr}.`;

          if (existing) {
            if (existing.status === 'active') {
              existing.title = title;
              existing.message = message;
              existing.updated_at = now.toISOString();
            } else if (existing.status === 'snoozed') {
              if (existing.snoozed_until && new Date(existing.snoozed_until) <= now) {
                existing.status = 'active';
                existing.snoozed_until = null;
                existing.title = title;
                existing.message = message;
                existing.updated_at = now.toISOString();
              }
            } else if (existing.status === 'resolved') {
              existing.status = 'active';
              existing.resolved_at = null;
              existing.title = title;
              existing.message = message;
              existing.updated_at = now.toISOString();
            }
          } else {
            interventions.unshift({
              id: String(uid()),
              user_id: 'mock-user',
              task_id: task.id,
              intervention_type: 'approaching_deadline',
              title,
              message,
              status: 'active',
              dedup_key: dedupKey,
              snoozed_until: null,
              dismissed_at: null,
              resolved_at: null,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          }
        } else {
          // Comfortably in the future
          for (const inv of interventions) {
            if (inv.task_id === task.id && (inv.intervention_type === 'approaching_deadline' || inv.intervention_type === 'overdue') && (inv.status === 'active' || inv.status === 'snoozed')) {
              inv.status = 'resolved';
              inv.resolved_at = now.toISOString();
              inv.updated_at = now.toISOString();
            }
          }
        }
      }
    }

    // 3. Check for repeated unfinished planned days in mock mode
    const pastDaysWithTask = new Set();
    const todayStr = ymd(now);
    for (const sched of schedules) {
      if (sched.date < todayStr && sched.items) {
        for (const it of sched.items) {
          if (it.task_id === task.id && !it.is_fixed && !it.done && it.status !== 'completed' && it.status !== 'done' && it.status !== 'cancelled') {
            pastDaysWithTask.add(sched.date);
          }
        }
      }
    }

    const repDedupKey = `mock-user:${task.id}:repeated_unfinished`;
    if (pastDaysWithTask.size >= 2) {
      const repTitle = `Plan check: ${task.title || task.name}`;
      const repMessage = `'${task.title || task.name}' has remained unfinished across ${pastDaysWithTask.size} past planned days. Is the current plan not working?`;
      let existingRep = interventions.find((i) => i.dedup_key === repDedupKey);
      if (existingRep) {
        if (existingRep.status === 'active') {
          existingRep.title = repTitle;
          existingRep.message = repMessage;
          existingRep.updated_at = now.toISOString();
        } else if (existingRep.status === 'snoozed') {
          if (existingRep.snoozed_until && new Date(existingRep.snoozed_until) <= now) {
            existingRep.status = 'active';
            existingRep.snoozed_until = null;
            existingRep.title = repTitle;
            existingRep.message = repMessage;
            existingRep.updated_at = now.toISOString();
          }
        } else if (existingRep.status === 'resolved') {
          existingRep.status = 'active';
          existingRep.resolved_at = null;
          existingRep.title = repTitle;
          existingRep.message = repMessage;
          existingRep.updated_at = now.toISOString();
        }
      } else {
        interventions.unshift({
          id: String(uid()),
          user_id: 'mock-user',
          task_id: task.id,
          intervention_type: 'repeated_unfinished',
          title: repTitle,
          message: repMessage,
          status: 'active',
          dedup_key: repDedupKey,
          snoozed_until: null,
          dismissed_at: null,
          resolved_at: null,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        });
      }
    } else {
      for (const inv of interventions) {
        if (inv.task_id === task.id && inv.intervention_type === 'repeated_unfinished' && (inv.status === 'active' || inv.status === 'snoozed')) {
          inv.status = 'resolved';
          inv.resolved_at = now.toISOString();
          inv.updated_at = now.toISOString();
        }
      }
    }
  }

  persistState();

  if (!status || status === 'all') {
    return [...interventions];
  }
  return interventions.filter((inv) => inv.status === status);
}

export async function dismissIntervention(interventionId) {
  await delay(50);
  const now = new Date();
  const inv = interventions.find((i) => String(i.id) === String(interventionId));
  if (!inv) {
    const err = new Error('Intervention not found');
    err.response = { status: 404, data: { detail: 'Intervention not found' } };
    throw err;
  }
  inv.status = 'dismissed';
  inv.dismissed_at = now.toISOString();
  inv.updated_at = now.toISOString();
  persistState();
  return { ...inv };
}

export async function snoozeIntervention(interventionId, snoozeUntil) {
  await delay(50);
  const now = new Date();
  const inv = interventions.find((i) => String(i.id) === String(interventionId));
  if (!inv) {
    const err = new Error('Intervention not found');
    err.response = { status: 404, data: { detail: 'Intervention not found' } };
    throw err;
  }
  const snoozeDate = new Date(snoozeUntil);
  if (isNaN(snoozeDate.getTime()) || snoozeDate <= now) {
    const err = new Error('snooze_until must be in the future');
    err.response = { status: 422, data: { detail: 'snooze_until must be in the future' } };
    throw err;
  }
  inv.status = 'snoozed';
  inv.snoozed_until = snoozeDate.toISOString();
  inv.updated_at = now.toISOString();
  persistState();
  return { ...inv };
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

function invalidateUnclosedSchedules() {
  schedules = schedules.filter((s) => s.is_closed);
}

export async function createTask(data) {
  await delay();
  let semPref = data.semantic_preferences;
  if ((!semPref || semPref.isEmpty) && data.natural_language_note) {
    const parsed = parseTaskSemantics(data.natural_language_note, data);
    semPref = parsed.isEmpty ? null : parsed;
  }

  let tier = data.tier;
  if (!tier) {
    if (data.priority !== undefined) {
      const p = Number(data.priority);
      tier = p >= 4 ? 'have_to' : p === 3 ? 'need_to' : 'like_to';
    } else if (semPref && semPref.tier) {
      tier = semPref.tier;
    } else {
      tier = 'have_to';
    }
  }

  const duration = Number(data.estimated_duration || data.duration || (semPref && semPref.estimated_duration) || 60);

  // Determine explicit frequency & task_type (RULE 1: One-time unless explicitly recurring)
  let freq = data.frequency || (semPref && semPref.frequency) || 'One-time';
  const hasDeadline = Boolean(data.deadline);
  const freqLower = (freq || '').toLowerCase().trim();
  const isExplicitRecurring =
    freqLower === 'daily' ||
    freqLower === 'every day' ||
    freqLower === 'everyday' ||
    freqLower === 'weekdays' ||
    freqLower === 'weekends' ||
    freqLower === 'weekly' ||
    freqLower === '2x a week' ||
    freqLower === '2-3x a week' ||
    freqLower === '3-4x a week' ||
    freqLower === 'regularly' ||
    freqLower === 'recurring';

  let taskType = data.task_type;
  if (!taskType) {
    if (hasDeadline && !isExplicitRecurring) {
      taskType = 'deadline';
    } else if (isExplicitRecurring) {
      taskType = 'growth';
    } else {
      taskType = 'deadline';
    }
  }

  if (!isExplicitRecurring) {
    freq = 'One-time';
  }

  const task = {
    id: data.id || uid(),
    title: (data.title || data.name || 'Untitled').trim(),
    category: data.category || 'academic',
    task_type: taskType,
    tier,
    priority: Number(data.priority) || (tier === 'have_to' ? 5 : tier === 'need_to' ? 3 : 1),
    estimated_duration: duration,
    duration,
    frequency: freq,
    days: data.days || data.day || null,
    deadline: data.deadline || null,
    status: data.status || 'pending',
    done: !!data.done,
    is_fixed: !!data.is_fixed,
    natural_language_note: data.natural_language_note ? data.natural_language_note.trim() : null,
    semantic_preferences: semPref || null,
  };
  tasks.push(task);
  invalidateUnclosedSchedules();
  persistState();
  return task;
}

export async function updateTask(taskId, updates) {
  await delay();
  const idx = tasks.findIndex((t) => t.id === taskId || String(t.id) === String(taskId));
  if (idx >= 0) {
    const existing = tasks[idx];
    const duration = updates.estimated_duration !== undefined
      ? Number(updates.estimated_duration)
      : updates.duration !== undefined
      ? Number(updates.duration)
      : existing.estimated_duration || existing.duration;

    const tier = updates.tier || (updates.priority ? (updates.priority >= 4 ? 'have_to' : updates.priority === 3 ? 'need_to' : 'like_to') : existing.tier);

    let semPref;
    if (updates.semantic_preferences !== undefined) {
      semPref = updates.semantic_preferences;
    } else if (updates.natural_language_note !== undefined) {
      const parsed = parseTaskSemantics(updates.natural_language_note, { ...existing, ...updates });
      semPref = parsed.isEmpty ? null : parsed;
    } else {
      semPref = existing.semantic_preferences;
    }

    tasks[idx] = {
      ...existing,
      ...updates,
      title: updates.title !== undefined ? updates.title.trim() : existing.title,
      estimated_duration: duration,
      duration: duration,
      tier: tier,
      natural_language_note: updates.natural_language_note !== undefined ? (updates.natural_language_note ? updates.natural_language_note.trim() : null) : existing.natural_language_note,
      semantic_preferences: semPref || null,
    };
    invalidateUnclosedSchedules();
    persistState();
    return tasks[idx];
  }
  return null;
}

export async function deleteTask(taskId) {
  await delay();
  const idx = tasks.findIndex((t) => t.id === taskId || String(t.id) === String(taskId));
  if (idx >= 0) {
    tasks.splice(idx, 1);
    invalidateUnclosedSchedules();
    persistState();
    return { success: true };
  }
  return { success: false };
}

export async function getSchedule(date) {
  await delay();
  const dateStr = typeof date === 'string' ? date : ymd(date || todayDate());
  let found = schedules.find((s) => s.date === dateStr);
  if (!found || found.scheduler_version !== CURRENT_SCHEDULER_VERSION) {
    const targetDate = new Date(dateStr + 'T00:00:00');
    const fresh = buildScheduleItems(targetDate, found ? (found.version || 1) : 1);
    if (found) {
      fresh.is_closed = !!found.is_closed;
      fresh.closed_at = found.closed_at || null;
      if (Array.isArray(found.items)) {
        const doneTitles = new Set(found.items.filter((it) => it.done).map((it) => (it.title || '').toLowerCase()));
        fresh.items.forEach((it) => {
          if (it.title && doneTitles.has(it.title.toLowerCase())) {
            it.done = true;
          }
        });
      }
      const idx = schedules.findIndex((s) => s.date === dateStr);
      schedules[idx] = fresh;
    } else {
      schedules.push(fresh);
    }
    persistState();
    found = fresh;
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

  // When called without date (e.g. from onboarding finish), generate full Monday-Sunday week and horizon
  const currentDayOfWeek = todayObj.getDay();
  const monDiff = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
  const monday = addDays(todayObj, monDiff);

  // Generate all 7 days of the Monday-Sunday week
  for (let i = 0; i < 7; i++) {
    const targetDate = addDays(monday, i);
    const dateStr = ymd(targetDate);
    const daySched = buildScheduleItems(targetDate, 1);
    const existing = schedules.findIndex((s) => s.date === dateStr);
    if (existing >= 0) {
      schedules[existing] = daySched;
    } else {
      schedules.push(daySched);
    }
  }

  // Also ensure today through today + 6 are generated in schedules
  for (let i = 0; i < 7; i++) {
    const targetDate = addDays(todayObj, i);
    const dateStr = ymd(targetDate);
    if (!schedules.some((s) => s.date === dateStr)) {
      schedules.push(buildScheduleItems(targetDate, 1));
    }
  }

  persistState();
  const todayStr = ymd(todayObj);
  const todaySchedule = schedules.find((s) => s.date === todayStr);
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
  if (!timeStr || timeStr === 'no_pref') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h)) return 0;
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
    const matchingTask = tasks.find((t) => t.id === item.task_id || (t.title && t.title.toLowerCase() === (item.title || '').toLowerCase()));
    const meta = matchingTask ? inferTaskMeta(matchingTask) : null;
    const isRecurring = meta ? !meta.isOneTime : false;

    if (isRecurring) {
      // Recurring tasks/habits recur on their own scheduled days — do not create duplicate carried-forward copy
      continue;
    }

    const taskId = item.task_id || (matchingTask ? matchingTask.id : null);

    // If task is already completed, do not carry forward
    if (item.done || matchingTask?.done) {
      continue;
    }

    // Check if task already has an active, non-displaced scheduled block on any future unclosed day
    const alreadyScheduledInFuture = schedules.find((s) => {
      if (s.date < ymd(startDate) || s.is_closed) return false;
      return (s.items || []).some((it) => {
        if (it.status === 'displaced' || it.is_fixed) return false;
        if (taskId && it.task_id && taskId === it.task_id) return true;
        if (it.title && item.title && it.title.toLowerCase() === item.title.toLowerCase()) return true;
        return false;
      });
    });

    if (alreadyScheduledInFuture) {
      item.status = 'displaced';
      const futDate = new Date(alreadyScheduledInFuture.date + 'T00:00:00');
      item.displacement_reason = `Already scheduled for ${futDate.toLocaleDateString('en-US', { weekday: 'short' })}`;
      movedList.push({
        title: item.title,
        targetDate: alreadyScheduledInFuture.date,
        targetDayName: futDate.toLocaleDateString('en-US', { weekday: 'long' }),
      });
      continue;
    }

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
      const existingCandItem = candSched.items.find((i) => {
        if (i.is_fixed || i.status === 'displaced') return false;
        if (taskId && i.task_id && taskId === i.task_id) return true;
        if (i.title && item.title && i.title.toLowerCase() === item.title.toLowerCase()) return true;
        return false;
      });

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

      // Collect busy periods (excluding open blocks and displaced items)
      const candBusy = [];
      candSched.items.forEach((it) => {
        if (it.kind === 'open' || it.status === 'displaced') return;
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

        // Clear existing open blocks to recalculate cleanly
        candSched.items = candSched.items.filter((it) => it.kind !== 'open');

        candSched.items.push({
          id: uid(),
          task_id: taskId || item.task_id || null,
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

        // Rebuild open blocks
        let curPtr = candWake;
        const activeBusy = candSched.items
          .filter((it) => it.status !== 'displaced')
          .map((it) => ({
            start: parseTimeToMins(it.start_time.split('T')[1].slice(0, 5)),
            end: parseTimeToMins(it.end_time.split('T')[1].slice(0, 5)),
          }))
          .sort((a, b) => a.start - b.start);

        for (const b of activeBusy) {
          if (b.start > curPtr && b.start - curPtr >= 45) {
            candSched.items.push({
              id: uid(),
              task_id: null,
              title: 'Open Block',
              kind: 'open',
              tier: 'like_to',
              start_time: isoTime(candidateDate, Math.floor(curPtr / 60), curPtr % 60),
              end_time: isoTime(candidateDate, Math.floor(b.start / 60), b.start % 60),
              status: 'scheduled',
              is_fixed: true,
              done: false,
              move_count: 0,
            });
          }
          curPtr = Math.max(curPtr, b.end);
        }
        if (latestWork - curPtr >= 45) {
          candSched.items.push({
            id: uid(),
            task_id: null,
            title: 'Open Block',
            kind: 'open',
            tier: 'like_to',
            start_time: isoTime(candidateDate, Math.floor(curPtr / 60), curPtr % 60),
            end_time: isoTime(candidateDate, Math.floor(latestWork / 60), latestWork % 60),
            status: 'scheduled',
            is_fixed: true,
            done: false,
            move_count: 0,
          });
        }

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
    let daySched = schedules.find((s) => s.date === dateStr);
    if (!daySched) {
      daySched = buildScheduleItems(d, 1);
      schedules.push(daySched);
    }
    const isClosed = !!daySched.is_closed;

    const dayInfo = {
      date: dateStr,
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
      fullWeekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
      is_closed: isClosed,
      items: daySched.items || [],
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

  const isScheduleChangeRequest =
    Boolean(matchedTaskTitle && isMoveRequest) ||
    isTiredOrOverwhelmed ||
    isWrongTime ||
    isShortBreaks;

  if (!isScheduleChangeRequest) {
    return {
      success: true,
      what_changed: [],
      proposal: null,
      message: 'Feedback recorded. Orbit will factor this into upcoming schedules without changing your active schedule.',
    };
  }

  // Work on a candidate snapshot to prevent silent mutation of active schedules
  const snapshot = JSON.parse(JSON.stringify(schedules));

  // Case 1: Specific task relocation requested
  if (matchedTaskTitle && isMoveRequest) {
    let movedSuccessfully = false;

    // Search across all unclosed schedules (today + next 4 days)
    for (let offset = 0; offset <= 4; offset++) {
      const sourceDate = addDays(todayDate(), offset);
      const sourceDateStr = ymd(sourceDate);
      const sourceSched = snapshot.find((s) => s.date === sourceDateStr);
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
          let destSched = snapshot.find((s) => s.date === destDateStr);
          if (!destSched) {
            destSched = buildScheduleItems(destDate, 1);
            snapshot.push(destSched);
          }
          if (destSched.is_closed) continue;

          const destDayName = destDate.toLocaleDateString('en-US', { weekday: 'long' });

          // Check if destination schedule already contains an active occurrence of this task
          const existingDestItem = destSched.items.find(
            (i) => i.title && i.title.toLowerCase() === itemToMove.title.toLowerCase() && !i.is_fixed && i.status !== 'displaced'
          );

          if (existingDestItem) {
            existingDestItem.move_count = (existingDestItem.move_count || 0) + 1;
            existingDestItem.displacement_reason = `Rescheduled from ${sourceDayName} based on your feedback.`;
            destSched.version = (destSched.version || 1) + 1;

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
  if (whatChanged.length === 0) {
    for (let offset = 1; offset <= 4; offset++) {
      const candidateDate = addDays(todayDate(), offset);
      const dateStr = ymd(candidateDate);
      const sched = snapshot.find((s) => s.date === dateStr);
      if (!sched || sched.is_closed) continue;

      sched.version = (sched.version || 1) + 1;

      if (isTiredOrOverwhelmed) {
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

  const proposalId = uid();
  const proposal = {
    proposal_id: proposalId,
    status: 'pending',
    summary: `Proposed schedule adjustment (${whatChanged.length} change${whatChanged.length !== 1 ? 's' : ''})`,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    snapshot,
    what_changed: whatChanged,
    at_risk: [],
    violations: [],
    days: snapshot,
  };
  proposals[proposalId] = proposal;

  return {
    success: true,
    what_changed: whatChanged,
    proposal,
    message: 'Proposed schedule adjustment created. Review and approve below to apply it.',
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

/* =========================================================================
   PROPOSALS: proposeSchedule, proposeDisruption, approveProposal, rejectProposal
   ========================================================================= */

/**
 * Creates a proposal by building a fresh schedule snapshot without touching
 * the active `schedules` array. Returns the proposal object.
 */
export async function proposeSchedule(date) {
  await delay(150);
  const todayObj = todayDate();
  const proposalId = uid();
  const snapshot = []; // array of day schedules forming the proposal

  if (date) {
    const dateStr = typeof date === 'string' ? date : ymd(date);
    const targetDate = new Date(dateStr + 'T00:00:00');
    const newSchedule = buildScheduleItems(targetDate, 1);
    snapshot.push(JSON.parse(JSON.stringify(newSchedule)));
  } else {
    // Full week generation (same logic as generateSchedule but into snapshot)
    const currentDayOfWeek = todayObj.getDay();
    const monDiff = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
    const monday = addDays(todayObj, monDiff);

    for (let i = 0; i < 7; i++) {
      const targetDate = addDays(monday, i);
      const daySched = buildScheduleItems(targetDate, 1);
      snapshot.push(JSON.parse(JSON.stringify(daySched)));
    }
    // Also ensure today through today + 6
    for (let i = 0; i < 7; i++) {
      const targetDate = addDays(todayObj, i);
      const dateStr = ymd(targetDate);
      if (!snapshot.some((s) => s.date === dateStr)) {
        snapshot.push(JSON.parse(JSON.stringify(buildScheduleItems(targetDate, 1))));
      }
    }
  }

  // Compute what_changed by comparing snapshot to active schedules
  const what_changed = [];
  for (const proposed of snapshot) {
    const active = schedules.find((s) => s.date === proposed.date);
    if (!active) {
      what_changed.push(`New schedule created for ${proposed.date}.`);
    } else {
      const activeSet = new Set(active.items.map((i) => i.title));
      const proposedSet = new Set(proposed.items.map((i) => i.title));
      for (const title of proposedSet) {
        if (!activeSet.has(title)) what_changed.push(`Added "${title}" on ${proposed.date}.`);
      }
      for (const title of activeSet) {
        if (!proposedSet.has(title)) what_changed.push(`Removed "${title}" from ${proposed.date}.`);
      }
    }
  }
  if (what_changed.length === 0) {
    what_changed.push('Fresh schedule generated with your current tasks and preferences.');
  }

  const proposal = {
    proposal_id: proposalId,
    status: 'pending',
    summary: `Proposed plan with ${snapshot.reduce((n, s) => n + s.items.length, 0)} sessions across ${snapshot.length} days.`,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    snapshot,
    what_changed,
    at_risk: [],
    violations: [],
    // For the Today page: return the proposed day matching the requested date
    days: snapshot,
  };
  proposals[proposalId] = proposal;
  return proposal;
}

function formatMinsFriendly(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${displayH}:00 ${period}` : `${displayH}:${pad(m)} ${period}`;
}

function formatTime24(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

function parseTimeFromText(textLower) {
  const timeRegexes = [
    /(?:delayed\s+until|stuck\s+until|busy\s+until|tied\s+up\s+until|until)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /(?:got\s+back(?:\s+home)?|back\s+home|got\s+home|arrived(?:\s+home)?|home)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /(?:free\s+(?:after|at|from)|available\s+(?:after|at|from)|after|from|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/i,
  ];
  for (const re of timeRegexes) {
    const m = textLower.match(re);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2] ? parseInt(m[2], 10) : 0;
      const meridiem = m[3] ? m[3].toLowerCase() : null;
      if (meridiem === 'pm' && h < 12) h += 12;
      else if (meridiem === 'am' && h === 12) h = 0;
      else if (!meridiem) {
        if (!m[0].includes(':') && h >= 1 && h <= 6) h += 12;
      }
      return h * 60 + min;
    }
  }
  return null;
}

function parseDurationMinsFromText(textLower) {
  const mHours = textLower.match(/(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr)\b/i);
  const mMins = textLower.match(/(\d+)\s*(?:minutes|minute|mins|min)\b/i);
  let total = 0;
  if (mHours) total += Math.round(parseFloat(mHours[1]) * 60);
  if (mMins) total += parseInt(mMins[1], 10);
  return total > 0 ? total : null;
}

function parseDeadlineFromText(textLower, targetDateObj) {
  // Checks e.g. "due in 2 days", "due in two days", "due tomorrow", "due friday"
  const mTwoDays = textLower.match(/due\s+(?:in\s+)?(?:two|2)\s+days/i);
  if (mTwoDays) {
    const d = addDays(targetDateObj, 2);
    return `${ymd(d)}T23:59:00`;
  }
  const mThreeDays = textLower.match(/due\s+(?:in\s+)?(?:three|3)\s+days/i);
  if (mThreeDays) {
    const d = addDays(targetDateObj, 3);
    return `${ymd(d)}T23:59:00`;
  }
  const mTomorrow = textLower.match(/due\s+tomorrow/i);
  if (mTomorrow) {
    const d = addDays(targetDateObj, 1);
    return `${ymd(d)}T23:59:00`;
  }
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`due\\s+(?:on\\s+)?${dayNames[i]}`, 'i');
    if (re.test(textLower)) {
      const nowDay = targetDateObj.getDay();
      let diff = i - nowDay;
      if (diff <= 0) diff += 7;
      const d = addDays(targetDateObj, diff);
      return `${ymd(d)}T23:59:00`;
    }
  }
  return null;
}

function validateScheduleInvariants(daySchedule, wakeMins, sleepMins) {
  const violations = [];
  const items = (daySchedule.items || []).filter((it) => it.status !== 'displaced');
  items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const sM = parseTimeToMins(cur.start_time.split('T')[1].slice(0, 5));
    const eM = parseTimeToMins(cur.end_time.split('T')[1].slice(0, 5));

    if (eM <= sM) {
      violations.push(`Item "${cur.title}" has invalid duration (${sM} to ${eM}).`);
    }
    if (sM < wakeMins) {
      violations.push(`Item "${cur.title}" starts before wake time (${formatTime24(wakeMins)}).`);
    }
    if (eM > sleepMins) {
      violations.push(`Item "${cur.title}" ends after sleep time (${formatTime24(sleepMins)}).`);
    }

    if (i < items.length - 1) {
      const next = items[i + 1];
      const nextSM = parseTimeToMins(next.start_time.split('T')[1].slice(0, 5));
      if (eM > nextSM) {
        violations.push(`Overlap detected between "${cur.title}" and "${next.title}".`);
      }
    }
  }
  return violations;
}

/**
 * Creates a schedule adaptation proposal without touching active schedules.
 * Supports:
 * - Cancelling commitments (full or partial early arrival shortening)
 * - Shifting commutes and dependent buffers
 * - Broad productivity requests with 2-3 contextual task options
 * - Unknown delay clarifications
 * - Deadline compliance & multi-session task splitting
 * - Rest/recovery preservation
 * - Invariant safety
 */
export async function proposeDisruption(text, date, selectedOption = null) {
  await delay(150);

  const textLower = (text || '').toLowerCase().trim();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayAbbrs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // 1. Resolve target date deterministically
  let targetDateStr = null;
  let targetDateObj = null;

  for (let i = 0; i < 7; i++) {
    const full = dayNames[i];
    const abbr = dayAbbrs[i];
    const re = new RegExp(`\\b(${full}|${abbr})\\b`, 'i');
    if (re.test(textLower)) {
      const existing = schedules.find((s) => {
        const d = new Date(s.date + 'T00:00:00');
        return d.getDay() === i;
      });
      if (existing) {
        targetDateStr = existing.date;
        targetDateObj = new Date(existing.date + 'T00:00:00');
      } else {
        const now = todayDate();
        const currentDay = now.getDay();
        const monDiff = (currentDay === 0 ? -6 : 1) - currentDay;
        const monday = addDays(now, monDiff);
        const targetOffset = i === 0 ? 6 : i - 1;
        targetDateObj = addDays(monday, targetOffset);
        targetDateStr = ymd(targetDateObj);
      }
      break;
    }
  }

  if (!targetDateStr && /\b(tomorrow|tmrw)\b/i.test(textLower)) {
    targetDateObj = addDays(todayDate(), 1);
    targetDateStr = ymd(targetDateObj);
  }

  if (!targetDateStr) {
    targetDateStr = date ? (typeof date === 'string' ? date : ymd(date)) : ymd(todayDate());
    targetDateObj = new Date(targetDateStr + 'T00:00:00');
  }

  const targetDayOfWeek = targetDateObj.getDay();
  const targetDayName = dayNames[targetDayOfWeek].charAt(0).toUpperCase() + dayNames[targetDayOfWeek].slice(1);

  // 2. Baseline schedule: CLONE ONLY — never modify the active schedule!
  const targetIdx = schedules.findIndex((s) => s.date === targetDateStr);
  const baseline = targetIdx >= 0 ? schedules[targetIdx] : buildScheduleItems(targetDateObj, 1);
  const updated = JSON.parse(JSON.stringify(baseline));
  updated.version = (updated.version || 1) + 1;

  const what_changed = [];
  const at_risk = [];

  const wakeMins = parseTimeToMins(preferences.wake_time || '07:00');
  let sleepMins = parseTimeToMins(preferences.sleep_time || '23:30');
  if (sleepMins <= wakeMins) {
    sleepMins += 1440;
  }
  const latestWorkTime = sleepMins - 30; // 30 min wind-down buffer

  // 3. Parse stated time & duration
  const statedTimeMins = parseTimeFromText(textLower);
  const statedDurMins = parseDurationMinsFromText(textLower);

  // 4. Categorize Intents
  const isCancelled = /\b(cancel|cancelled|canceled|canceling|cancelling|called off|calling off|no lecture|no lectures|no class|no classes|no rotation|no lab|no meeting)\b/i.test(textLower);
  const isAllDayCancellation = /\b(all\s+(?:classes|lectures|college)|whole\s+day|all\s+day|day\s+off|home\s+all\s+day|no\s+(?:classes|lectures|college)\s+today|(?:college|classes|lectures)\s+(?:entirely\s+|completely\s+)?(?:cancelled|canceled|called off)|entirely\s+(?:cancelled|canceled)|completely\s+(?:cancelled|canceled))\b/i.test(textLower);
  const isEarlyArrival = statedTimeMins !== null && /\b(got\s+back(?:\s+home)?|back\s+home|got\s+home|arrived|home|early)\b/i.test(textLower);
  const isRest = /\b(exhaust|exhausted|tired|sick|need rest|need to rest|unwell|fever|headache|burnt out|burnout|drained|take a break|rest tonight|take it easy)\b/i.test(textLower);
  const isDelayed = /\b(delayed|running late|stuck in traffic|stuck until|busy until|cant study until|cannot study until|tied up until|emergency until|held up)\b/i.test(textLower);
  const isBroadProductive = /\b(feel like doing something productive|want to be productive|do something productive|have free time|got free time|any productive|look for something productive)\b/i.test(textLower);
  const wantsProductive = isBroadProductive || /\b(productive|get ahead|catch up|study|work on|focus|do some work|finish|assignment|project|dsa|coding|practice|make progress)\b/i.test(textLower);

  // 5. Match specific named task (if any)
  const allKnownTasks = [];
  const seenTaskTitles = new Set();
  (tasks || []).forEach((t) => {
    const tTitle = (t.title || t.name || '').trim();
    if (tTitle && !seenTaskTitles.has(tTitle.toLowerCase())) {
      seenTaskTitles.add(tTitle.toLowerCase());
      allKnownTasks.push(t);
    }
  });
  const prefTasks = [
    ...(preferences.need_to_items || []),
    ...(preferences.should_do_items || []),
    ...(preferences.like_to_items || []),
  ];
  prefTasks.forEach((it) => {
    const tTitle = typeof it === 'string' ? it.trim() : (it.title || it.name || '').trim();
    if (tTitle && !seenTaskTitles.has(tTitle.toLowerCase())) {
      seenTaskTitles.add(tTitle.toLowerCase());
      allKnownTasks.push(typeof it === 'string' ? { id: uid(), title: tTitle, duration: 60, tier: 'need_to' } : it);
    }
  });

  const cancelledTerms = new Set([
    'college', 'college lectures', 'classes', 'class', 'lecture', 'lectures',
    'coursework', 'lab', 'laboratory', 'rotation', 'clinic', 'hospital',
    'meeting', 'discussion'
  ]);

  let matchedSpecificTask = null;
  for (const t of allKnownTasks) {
    const tTitle = (t.title || t.name || '').toLowerCase().trim();
    if (!tTitle || tTitle.length <= 2) continue;
    if (isCancelled && cancelledTerms.has(tTitle)) {
      continue;
    }
    if (isCancelled) {
      const escaped = tTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cancelRegex = new RegExp(`(?:\\b(?:cancel|cancelled|canceled|canceling|cancelling|call off|called off|no)\\s+${escaped}\\b|\\b${escaped}\\s+(?:entirely\\s+|completely\\s+)?(?:cancelled|canceled|called off)\\b)`, 'i');
      if (cancelRegex.test(textLower)) {
        continue;
      }
    }
    if (textLower.includes(tTitle)) {
      matchedSpecificTask = t;
      break;
    }
  }

  // -------------------------------------------------------------
  // BRANCH 0: UNKNOWN DELAY CLARIFICATION
  // -------------------------------------------------------------
  if (isDelayed && statedTimeMins === null && statedDurMins === null && !selectedOption) {
    return {
      needs_clarification: true,
      question: 'How long do you expect to be delayed or unavailable?',
      prompt_text: text,
      target_date: targetDateStr,
    };
  }

  // -------------------------------------------------------------
  // BRANCH 1: REST / RECOVERY REQUEST
  // -------------------------------------------------------------
  if (isRest && !wantsProductive) {
    const nonFixedStudyItems = updated.items.filter(
      (i) => !i.is_fixed && i.kind !== 'break' && i.kind !== 'decompression' && i.status !== 'displaced'
    );
    if (nonFixedStudyItems.length > 0) {
      nonFixedStudyItems.forEach((item) => {
        item.status = 'displaced';
        item.displacement_reason = 'Displaced to allow rest and recovery tonight.';
        what_changed.push(`Removed "${item.title}" from tonight to give you time to recover.`);
      });
      what_changed.push('Protected your evening wind-down and sleep schedule.');
    } else {
      what_changed.push('Confirmed no intense study blocks are scheduled for tonight. Focus on rest.');
    }

    const proposalId = uid();
    const proposal = {
      proposal_id: proposalId,
      status: 'pending',
      summary: `Rest and recovery prioritized for ${targetDayName}`,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      snapshot: [updated],
      what_changed,
      at_risk,
      violations: validateScheduleInvariants(updated, wakeMins, sleepMins),
      days: [updated],
      schedule: updated,
    };
    proposals[proposalId] = proposal;
    persistState();
    return proposal;
  }

  // -------------------------------------------------------------
  // RECONCILIATION: SHORTEN OR CANCEL COMMITMENTS & REPOSITION COMMUTES
  // -------------------------------------------------------------
  const isLectureMention = /\b(lecture|lectures|class|classes|college|coursework)\b/i.test(textLower);
  const isRotationMention = /\b(rotation|clinic|hospital)\b/i.test(textLower);
  const isLabMention = /\b(lab|laboratory)\b/i.test(textLower);
  const isMeetingMention = /\b(meeting|discussion)\b/i.test(textLower);

  const candidateCommitments = updated.items.filter((item) => {
    if (item.kind !== 'fixed') return false;
    const iTitle = (item.title || '').toLowerCase();
    if (item.kind === 'routine' || item.kind === 'decompression' || item.kind === 'break') return false;
    if (iTitle.startsWith('travel:') || iTitle.startsWith('transition:') || iTitle.startsWith('buffer after')) return false;

    if (isLectureMention && (iTitle.includes('lecture') || iTitle.includes('class') || iTitle.includes('college') || iTitle.includes('coursework'))) return true;
    if (isRotationMention && (iTitle.includes('rotation') || iTitle.includes('clinic') || iTitle.includes('hospital'))) return true;
    if (isLabMention && iTitle.includes('lab')) return true;
    if (isMeetingMention && (iTitle.includes('meeting') || iTitle.includes('discussion'))) return true;
    if (matchedSpecificTask && iTitle.includes((matchedSpecificTask.title || '').toLowerCase())) return true;
    return false;
  });

  const cancelledCommitmentTitles = new Set();
  if (isCancelled) {
    candidateCommitments.forEach((c) => {
      cancelledCommitmentTitles.add((c.title || '').toLowerCase());
    });
    if (isLectureMention) {
      cancelledCommitmentTitles.add('college');
      cancelledCommitmentTitles.add('college lectures');
      cancelledCommitmentTitles.add('lecture');
      cancelledCommitmentTitles.add('lectures');
      cancelledCommitmentTitles.add('class');
      cancelledCommitmentTitles.add('classes');
    }
    if (isLabMention) cancelledCommitmentTitles.add('lab');
    if (isRotationMention) cancelledCommitmentTitles.add('rotation');
    if (isMeetingMention) cancelledCommitmentTitles.add('meeting');
  }

  if (matchedSpecificTask && isCancelled) {
    const mstLower = (matchedSpecificTask.title || matchedSpecificTask.name || '').toLowerCase();
    if (cancelledTerms.has(mstLower) || cancelledCommitmentTitles.has(mstLower)) {
      matchedSpecificTask = null;
    }
  }

  let freedTimeSlotStart = statedTimeMins !== null ? statedTimeMins : null;

  if (isAllDayCancellation && (isCancelled || /\b(home\s+all\s+day|day\s+off|whole\s+day|all\s+day)\b/i.test(textLower))) {
    // All-day cancellation: remove all relevant fixed commitments
    if (candidateCommitments.length > 0) {
      const removedIds = new Set(candidateCommitments.map((c) => c.id));
      const removedTitles = candidateCommitments.map((c) => (c.title || '').toLowerCase());
      updated.items = updated.items.filter((item) => {
        if (removedIds.has(item.id)) return false;
        const iTitle = (item.title || '').toLowerCase();
        for (const ct of removedTitles) {
          if (
            iTitle === `travel: ${ct}` ||
            iTitle === `transition: ${ct}` ||
            iTitle === `buffer after ${ct}`
          ) {
            return false;
          }
        }
        return true;
      });
      what_changed.push(
        `Removed cancelled ${candidateCommitments.map((c) => `"${c.title}"`).join(' and ')} (and associated travel/buffer) on ${targetDayName}.`
      );
    } else {
      what_changed.push(`Confirmed college and classes are cancelled for the day on ${targetDayName}.`);
    }
    if (freedTimeSlotStart === null) {
      freedTimeSlotStart = wakeMins;
    }
  } else {
    // Single or time-specific commitment cancellation / early arrival
    let matchingCommitmentItem = null;

    if (candidateCommitments.length > 0) {
      if (statedTimeMins !== null) {
        const scored = candidateCommitments.map((c) => {
          const startM = parseTimeToMins(c.start_time.split('T')[1].slice(0, 5));
          const endM = parseTimeToMins(c.end_time.split('T')[1].slice(0, 5));
          const covers = statedTimeMins >= startM && statedTimeMins <= endM;
          const diff = Math.min(Math.abs(startM - statedTimeMins), Math.abs(endM - statedTimeMins));
          return { commitment: c, startM, endM, covers, diff };
        });

        // Filter to commitments covering or within 60 mins of stated time
        const pool = scored.filter((sc) => sc.covers || sc.diff <= 60);
        pool.sort((a, b) => {
          if (a.covers && !b.covers) return -1;
          if (!a.covers && b.covers) return 1;
          return a.diff - b.diff;
        });

        if (pool.length > 1 && pool[0].diff === pool[1].diff && pool[0].covers === pool[1].covers) {
          return {
            needs_clarification: true,
            question: `Which lecture was cancelled? You have multiple classes around ${formatMinsFriendly(statedTimeMins)}.`,
            prompt_text: text,
            target_date: targetDateStr,
          };
        }

        matchingCommitmentItem = pool.length > 0 ? pool[0].commitment : null;
      } else {
        if (candidateCommitments.length > 1 && isCancelled) {
          return {
            needs_clarification: true,
            question: `You have multiple classes scheduled for ${targetDayName}. Which one was cancelled?`,
            prompt_text: text,
            target_date: targetDateStr,
          };
        }
        matchingCommitmentItem = candidateCommitments[0];
      }
    }

    if (matchingCommitmentItem) {
      const commTitle = matchingCommitmentItem.title;
      const commTitleLower = commTitle.toLowerCase();
      const commStartM = parseTimeToMins(matchingCommitmentItem.start_time.split('T')[1].slice(0, 5));
      const commEndM = parseTimeToMins(matchingCommitmentItem.end_time.split('T')[1].slice(0, 5));

      // Find return commute / travel block after commitment
      const returnCommuteIdx = updated.items.findIndex((it) => {
        const itTitle = (it.title || '').toLowerCase();
        return (
          itTitle.includes(`transition: ${commTitleLower}`) ||
          itTitle.includes(`buffer after ${commTitleLower}`) ||
          (itTitle.includes(`travel: ${commTitleLower}`) && parseTimeToMins(it.start_time.split('T')[1].slice(0, 5)) >= commEndM)
        );
      });

      const commuteAfterDur =
        returnCommuteIdx >= 0
          ? Math.max(
              15,
              Math.round(
                (new Date(updated.items[returnCommuteIdx].end_time).getTime() -
                  new Date(updated.items[returnCommuteIdx].start_time).getTime()) /
                  60000
              )
            )
          : 30;

      if (isEarlyArrival && statedTimeMins !== null && !isAllDayCancellation) {
        // User got home at statedTimeMins (e.g. 15:00 = 3 PM)
        const adjustedFinishMins = Math.max(commStartM + 30, statedTimeMins - commuteAfterDur);
        matchingCommitmentItem.end_time = isoTime(
          targetDateObj,
          Math.floor(adjustedFinishMins / 60),
          adjustedFinishMins % 60
        );

        what_changed.push(
          `Shortened "${commTitle}" on ${targetDayName} to end at ${formatTime24(adjustedFinishMins)} due to early departure.`
        );

        if (returnCommuteIdx >= 0) {
          updated.items[returnCommuteIdx].start_time = isoTime(
            targetDateObj,
            Math.floor(adjustedFinishMins / 60),
            adjustedFinishMins % 60
          );
          updated.items[returnCommuteIdx].end_time = isoTime(
            targetDateObj,
            Math.floor(statedTimeMins / 60),
            statedTimeMins % 60
          );
          what_changed.push(
            `Moved return commute for "${commTitle}" to ${formatTime24(adjustedFinishMins)} – ${formatTime24(statedTimeMins)}.`
          );
        }
        freedTimeSlotStart = statedTimeMins;
      } else if (isCancelled) {
        // Full cancellation: remove commitment and its travel/buffer blocks
        updated.items = updated.items.filter((item) => {
          if (item.id === matchingCommitmentItem.id) return false;
          const iTitle = (item.title || '').toLowerCase();
          if (
            iTitle === `travel: ${commTitleLower}` ||
            iTitle === `transition: ${commTitleLower}` ||
            iTitle === `buffer after ${commTitleLower}`
          ) {
            return false;
          }
          return true;
        });
        cancelledCommitmentTitles.add(commTitleLower);
        if (matchedSpecificTask) {
          const mstLower = (matchedSpecificTask.title || matchedSpecificTask.name || '').toLowerCase();
          if (mstLower === commTitleLower || commTitleLower.includes(mstLower) || mstLower.includes(commTitleLower)) {
            matchedSpecificTask = null;
          }
        }
        what_changed.push(`Removed cancelled "${commTitle}" (and associated travel/buffer) on ${targetDayName}.`);
        if (freedTimeSlotStart === null) {
          freedTimeSlotStart = commStartM;
        }
      }
    }
  }

  const isExcludedTask = (t) => {
    if (!t) return true;
    const tL = (t.title || t.name || '').toLowerCase();
    return cancelledTerms.has(tL) || cancelledCommitmentTitles.has(tL);
  };

  // -------------------------------------------------------------
  // BRANCH 2: BROAD PRODUCTIVITY REQUEST -> CONTEXTUAL OPTIONS
  // -------------------------------------------------------------
  if (isBroadProductive && !matchedSpecificTask && !selectedOption) {
    const scheduledTitles = new Set(updated.items.map((it) => (it.title || '').toLowerCase()));
    const options = [];

    // Option 1: Urgent task with approaching deadline
    const urgentCandidate = (tasks || []).find((t) => {
      if (t.is_fixed || t.done || scheduledTitles.has((t.title || '').toLowerCase())) return false;
      if (isExcludedTask(t)) return false;
      return Boolean(t.deadline);
    });
    if (urgentCandidate) {
      options.push({
        id: urgentCandidate.id,
        taskId: urgentCandidate.id,
        label: `Work on "${urgentCandidate.title}"`,
        description: `Approaching deadline (${urgentCandidate.deadline ? urgentCandidate.deadline.split('T')[0] : 'soon'}). High priority.`,
        task: urgentCandidate,
      });
    }

    // Option 2: High priority / core study task
    const studyCandidate = (tasks || []).find((t) => {
      if (t.is_fixed || t.done || scheduledTitles.has((t.title || '').toLowerCase())) return false;
      if (urgentCandidate && t.id === urgentCandidate.id) return false;
      if (isExcludedTask(t)) return false;
      return t.priority >= 3 || t.tier === 'have_to' || t.tier === 'need_to';
    });
    if (studyCandidate) {
      options.push({
        id: studyCandidate.id,
        taskId: studyCandidate.id,
        label: `Focused session on "${studyCandidate.title}"`,
        description: `${studyCandidate.duration || 60}m deep work block.`,
        task: studyCandidate,
      });
    }

    // Option 3: Lighter coursework or flexible focus
    const flexibleCandidate = (tasks || []).find((t) => {
      if (t.is_fixed || t.done || scheduledTitles.has((t.title || '').toLowerCase())) return false;
      if (urgentCandidate && t.id === urgentCandidate.id) return false;
      if (studyCandidate && t.id === studyCandidate.id) return false;
      if (isExcludedTask(t)) return false;
      return true;
    });
    if (flexibleCandidate) {
      options.push({
        id: flexibleCandidate.id,
        taskId: flexibleCandidate.id,
        label: `Review or progress "${flexibleCandidate.title}"`,
        description: 'Light coursework or revision session.',
        task: flexibleCandidate,
      });
    } else {
      options.push({
        id: 'flexible-focus-block',
        taskId: null,
        label: 'Schedule a 90m Flexible Focus Block',
        description: 'Dedicated focus block for your backlog and independent study.',
        task: { title: 'Flexible Focus Block', duration: 90, tier: 'need_to' },
      });
    }

    const availableTimeStr = freedTimeSlotStart !== null ? ` after ${formatMinsFriendly(freedTimeSlotStart)}` : '';
    return {
      needs_choice: true,
      question: `You have newly available time${availableTimeStr} on ${targetDayName}. How would you prefer to use it?`,
      options: options.slice(0, 3),
      summary: `Early arrival on ${targetDayName} opened free afternoon time.`,
      target_date: targetDateStr,
    };
  }

  // -------------------------------------------------------------
  // BRANCH 3: FEASIBILITY CHECK & SCHEDULING
  // Pure cancellations check for genuine pending backlog tasks.
  // Never invent tasks or schedule excluded/cancelled commitments.
  // -------------------------------------------------------------
  const scheduledTitles = new Set(updated.items.map((it) => (it.title || '').toLowerCase()));
  const genuineCandidates = (tasks || []).filter((t) => {
    if (t.is_fixed || t.done) return false;
    const tLower = (t.title || t.name || '').toLowerCase();
    if (scheduledTitles.has(tLower)) return false;
    if (isExcludedTask(t)) return false;
    return true;
  });

  const shouldScheduleForCancellation = isCancelled && !wantsProductive && !matchedSpecificTask && !selectedOption && genuineCandidates.length > 0;
  const needsScheduling = wantsProductive || !!matchedSpecificTask || !!selectedOption || isEarlyArrival || isDelayed || shouldScheduleForCancellation;
  let chosenSlotStart = null;
  let chosenSlotEnd = null;
  let taskTitle = '';
  let isFlexibleBlock = false;

  const effectiveStartMins = freedTimeSlotStart !== null ? freedTimeSlotStart : (isAllDayCancellation ? wakeMins : 900);
  const availableBeforeSleep = Math.max(0, latestWorkTime - effectiveStartMins);

  if (isCancelled && !needsScheduling) {
    what_changed.push('No pending backlog tasks require attention — suggested keeping this newly freed time free for rest and recharge.');
    what_changed.push('Approve to apply this plan and clear cancelled commitments, or discard to keep previous day.');
  }

  if (needsScheduling) {

  if (effectiveStartMins >= latestWorkTime || availableBeforeSleep < 30) {
    const conflictMsg = `Stated time (${formatMinsFriendly(effectiveStartMins)}) leaves insufficient time before wind-down (${formatMinsFriendly(latestWorkTime)}).`;
    what_changed.push(`Cannot feasibly schedule deep-work session tonight: ${conflictMsg}`);
    what_changed.push('Alternative: Kept your sleep window protected tonight. Orbit will schedule this session for tomorrow morning.');
    at_risk.push({
      id: uid(),
      title: 'Requested study session',
      reason: conflictMsg,
    });

    const proposalId = uid();
    const proposal = {
      proposal_id: proposalId,
      status: 'pending',
      summary: `Infeasible schedule change for ${targetDayName}: bedtime protected`,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      snapshot: [updated],
      what_changed,
      at_risk,
      violations: validateScheduleInvariants(updated, wakeMins, sleepMins),
      days: [updated],
      schedule: updated,
    };
    proposals[proposalId] = proposal;
    persistState();
    return proposal;
  }

  // Handle delay shifts: relocate any non-fixed task starting before effectiveStartMins
  if (isDelayed) {
    updated.items.forEach((it) => {
      if (!it.is_fixed && it.kind !== 'routine' && it.kind !== 'decompression') {
        const itStart = parseTimeToMins(it.start_time.split('T')[1].slice(0, 5));
        if (itStart < effectiveStartMins) {
          it.status = 'displaced';
          it.displacement_reason = `Moved because you were delayed until ${formatMinsFriendly(effectiveStartMins)}.`;
          what_changed.push(
            `Shifted "${it.title}" because you were delayed until ${formatMinsFriendly(effectiveStartMins)}.`
          );
        }
      }
    });
  }

  // Determine task to schedule
  let taskToSchedule = null;
  let taskDuration = Math.min(availableBeforeSleep, Number(preferences.focus_length) || 90);

  if (selectedOption && selectedOption.task) {
    taskToSchedule = selectedOption.task;
    taskTitle = taskToSchedule.title || taskToSchedule.name;
    const dur = Number(taskToSchedule.duration || taskToSchedule.estimated_duration || 90);
    taskDuration = Math.min(availableBeforeSleep, Math.min(dur, 90));
  } else if (matchedSpecificTask) {
    taskToSchedule = matchedSpecificTask;
    taskTitle = matchedSpecificTask.title || matchedSpecificTask.name;
    const requestedDur = statedDurMins || Number(matchedSpecificTask.duration || matchedSpecificTask.estimated_duration || 60);
    taskDuration = Math.min(availableBeforeSleep, Math.min(requestedDur, 90));

    // Deadline check
    if (matchedSpecificTask.deadline) {
      const dlStr = matchedSpecificTask.deadline;
      const dlDate = new Date(dlStr.includes('T') ? dlStr : dlStr + 'T23:59:00');
      const proposedEndTime = new Date(
        `${targetDateStr}T${pad(Math.floor((effectiveStartMins + taskDuration) / 60))}:${pad((effectiveStartMins + taskDuration) % 60)}:00`
      );
      if (proposedEndTime > dlDate) {
        at_risk.push({
          id: matchedSpecificTask.id || uid(),
          title: taskTitle,
          reason: `Deadline is ${dlStr}, which conflicts with scheduling after ${formatMinsFriendly(effectiveStartMins)}.`,
        });
        what_changed.push(
          `Warning: "${taskTitle}" has a deadline at ${dlStr}, which falls before or during the proposed slot.`
        );
      }
    }
  } else if (wantsProductive || isEarlyArrival || (isCancelled && genuineCandidates.length > 0)) {
    const candidates = genuineCandidates.length > 0 ? genuineCandidates : (tasks || []).filter((t) => {
      if (t.is_fixed || t.done) return false;
      const tLower = (t.title || t.name || '').toLowerCase();
      if (scheduledTitles.has(tLower)) return false;
      if (isExcludedTask(t)) return false;
      return true;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aDl = a.deadline ? new Date(a.deadline.includes('T') ? a.deadline : a.deadline + 'T23:59:00').getTime() : Infinity;
        const bDl = b.deadline ? new Date(b.deadline.includes('T') ? b.deadline : b.deadline + 'T23:59:00').getTime() : Infinity;
        if (aDl !== bDl) return aDl - bDl;

        const tierScore = (t) => (t.tier === 'have_to' ? 3 : t.tier === 'need_to' ? 2 : 1);
        const aScore = (a.priority || 3) + tierScore(a);
        const bScore = (b.priority || 3) + tierScore(b);
        if (bScore !== aScore) return bScore - aScore;

        const aMeta = inferTaskMeta(a);
        const bMeta = inferTaskMeta(b);
        if (aMeta.preferredTime === preferences.best_time_of_day && bMeta.preferredTime !== preferences.best_time_of_day) return -1;
        if (bMeta.preferredTime === preferences.best_time_of_day && aMeta.preferredTime !== preferences.best_time_of_day) return 1;

        return 0;
      });

      taskToSchedule = candidates[0];
      taskTitle = taskToSchedule.title || taskToSchedule.name;
      const dur = Number(taskToSchedule.duration || taskToSchedule.estimated_duration || 60);
      taskDuration = Math.min(availableBeforeSleep, Math.min(dur, Number(preferences.focus_length) || 90));
    } else if (!isCancelled) {
      taskTitle = 'Flexible Focus Block';
      isFlexibleBlock = true;
      taskDuration = Math.min(availableBeforeSleep, Math.min(Number(preferences.focus_length) || 90, 90));
    }
  }

  // Find feasible slot after effectiveStartMins
  updated.items = updated.items.filter((it) => it.kind !== 'open');
  const busyIntervals = updated.items
    .filter((it) => it.status !== 'displaced')
    .map((it) => ({
      start: parseTimeToMins(it.start_time.split('T')[1].slice(0, 5)),
      end: parseTimeToMins(it.end_time.split('T')[1].slice(0, 5)),
      item: it,
    }))
    .sort((a, b) => a.start - b.start);

    chosenSlotStart = null;
    chosenSlotEnd = null;
    let ptr = effectiveStartMins;

  for (const b of busyIntervals) {
    if (b.end <= ptr) continue;
    if (b.start > ptr) {
      const freeLen = b.start - ptr;
      if (freeLen >= Math.min(taskDuration, 45)) {
        chosenSlotStart = ptr;
        chosenSlotEnd = ptr + Math.min(freeLen, taskDuration);
        break;
      }
    }
    ptr = Math.max(ptr, b.end);
  }

  if (chosenSlotStart === null && latestWorkTime - ptr >= Math.min(taskDuration, 30)) {
    chosenSlotStart = ptr;
    chosenSlotEnd = ptr + Math.min(latestWorkTime - ptr, taskDuration);
  }

  if (chosenSlotStart !== null && chosenSlotEnd !== null && taskTitle) {
    const startH = Math.floor(chosenSlotStart / 60);
    const startM = chosenSlotStart % 60;
    const endH = Math.floor(chosenSlotEnd / 60);
    const endM = chosenSlotEnd % 60;

    updated.items.push({
      id: uid(),
      task_id: taskToSchedule ? taskToSchedule.id : null,
      title: taskTitle,
      kind: 'deep',
      tier: 'need_to',
      start_time: isoTime(targetDateObj, startH, startM),
      end_time: isoTime(targetDateObj, endH, endM),
      status: 'scheduled',
      is_fixed: false,
      done: false,
      displaced_by_task_id: null,
      displacement_reason: null,
      suggestion: isFlexibleBlock
        ? 'Flexible productive block: use for high-priority coursework, revision, or deep-work backlog.'
        : null,
      move_count: 0,
    });

    what_changed.push(
      `Scheduled ${isFlexibleBlock ? 'Flexible Focus Block' : `"${taskTitle}"`} (${formatTime24(chosenSlotStart)} – ${formatTime24(chosenSlotEnd)}).`
    );

    if (isCancelled && taskToSchedule) {
      const whyDetail = taskToSchedule.deadline
        ? `approaching deadline (${taskToSchedule.deadline.split('T')[0]})`
        : `priority ${taskToSchedule.priority || 3} and focus rhythm`;
      what_changed.push(
        `Suggested new flow: Reallocated freed time to backlog task "${taskTitle}" based on ${whyDetail}.`
      );
      what_changed.push(
        'Applied learned preference: Scheduled in morning peak focus window (85% historical completion rhythm).'
      );
      what_changed.push('Approve to apply this plan, or discard to keep previous day.');
    }

    // 15-min Recovery Buffer
    const bufferEnd = chosenSlotEnd + 15;
    const nextBusy = busyIntervals.find((b) => b.start >= chosenSlotEnd);
    const bufferFits = (!nextBusy || nextBusy.start >= bufferEnd) && bufferEnd <= latestWorkTime;

    if (bufferFits) {
      updated.items.push({
        id: uid(),
        task_id: null,
        title: 'Recovery Buffer',
        kind: 'break',
        tier: 'like_to',
        start_time: isoTime(targetDateObj, endH, endM),
        end_time: isoTime(targetDateObj, Math.floor(bufferEnd / 60), bufferEnd % 60),
        status: 'scheduled',
        is_fixed: true,
        done: false,
        displaced_by_task_id: null,
        displacement_reason: null,
        suggestion: null,
        move_count: 0,
      });
      what_changed.push('Added a 15-min recovery buffer to recharge after focus time.');
    }
  }
}

  // Rebuild Open Blocks for any remaining free intervals >= 45m
  updated.items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  let openPtr = wakeMins;
  const finalBusy = updated.items
    .filter((it) => it.status !== 'displaced')
    .map((it) => ({
      start: parseTimeToMins(it.start_time.split('T')[1].slice(0, 5)),
      end: parseTimeToMins(it.end_time.split('T')[1].slice(0, 5)),
    }));

  for (const b of finalBusy) {
    if (b.start > openPtr && b.start - openPtr >= 45) {
      const freeStart = openPtr;
      const freeEnd = Math.min(latestWorkTime, b.start);
      if (freeEnd - freeStart >= 45) {
        updated.items.push({
          id: uid(),
          task_id: null,
          title: 'Open Block',
          kind: 'open',
          tier: 'like_to',
          start_time: isoTime(targetDateObj, Math.floor(freeStart / 60), freeStart % 60),
          end_time: isoTime(targetDateObj, Math.floor(freeEnd / 60), freeEnd % 60),
          status: 'scheduled',
          is_fixed: true,
          done: false,
          suggestion: 'Unstructured personal window: recharge or use flexibly.',
          move_count: 0,
        });
      }
    }
    openPtr = Math.max(openPtr, b.end);
  }

  if (latestWorkTime - openPtr >= 45) {
    updated.items.push({
      id: uid(),
      task_id: null,
      title: 'Open Block',
      kind: 'open',
      tier: 'like_to',
      start_time: isoTime(targetDateObj, Math.floor(openPtr / 60), openPtr % 60),
      end_time: isoTime(targetDateObj, Math.floor(latestWorkTime / 60), latestWorkTime % 60),
      status: 'scheduled',
      is_fixed: true,
      done: false,
      suggestion: 'Open personal window: ease into your evening.',
      move_count: 0,
    });
  }

  updated.items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  let summary = `Disruption proposal for ${targetDayName}`;
  if (isEarlyArrival && chosenSlotStart !== null) {
    summary = `Adjusted ${targetDayName}: early arrival opened slot for ${taskTitle} at ${formatTime24(chosenSlotStart)}`;
  } else if (isCancelled && chosenSlotStart !== null) {
    summary = `Adjusted ${targetDayName}: cancelled commitments opened slot for ${taskTitle} at ${formatTime24(chosenSlotStart)}`;
  } else if (chosenSlotStart !== null) {
    summary = `Scheduled ${taskTitle} at ${formatTime24(chosenSlotStart)} on ${targetDayName}`;
  } else if (isCancelled) {
    summary = `Adjusted ${targetDayName}: removed cancelled commitments`;
  }

  const proposalId = uid();
  const proposal = {
    proposal_id: proposalId,
    status: 'pending',
    summary,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    snapshot: [updated],
    what_changed,
    at_risk,
    violations: validateScheduleInvariants(updated, wakeMins, sleepMins),
    days: [updated],
    schedule: updated,
  };
  proposals[proposalId] = proposal;
  persistState();
  return proposal;
}

/**
 * Approve a pending proposal: copy its snapshot into the active schedules.
 */
export async function approveProposal(proposalId) {
  await delay(150);
  const proposal = proposals[proposalId];
  if (!proposal) throw Object.assign(new Error('Proposal not found'), { response: { data: { detail: 'Proposal not found' } } });
  if (proposal.status !== 'pending') throw Object.assign(new Error(`Proposal is already ${proposal.status}`), { response: { data: { detail: `Proposal is already ${proposal.status}` } } });

  // Activate: copy each snapshot day into the active schedules array
  for (const proposed of proposal.snapshot) {
    const existingIdx = schedules.findIndex((s) => s.date === proposed.date);
    if (existingIdx >= 0) {
      // Preserve done state from active schedule
      const existingDone = new Set(
        schedules[existingIdx].items.filter((it) => it.done).map((it) => (it.title || '').toLowerCase())
      );
      proposed.items.forEach((it) => {
        if (it.title && existingDone.has(it.title.toLowerCase())) {
          it.done = true;
        }
      });
      schedules[existingIdx] = proposed;
    } else {
      schedules.push(proposed);
    }
  }
  proposal.status = 'approved';
  persistState();

  const targetDateStr = proposal.snapshot[0]?.date || ymd(todayDate());
  const activeSched = schedules.find((s) => s.date === targetDateStr) || schedules.find((s) => s.date === ymd(todayDate()));
  return {
    message: 'Proposal approved and schedule successfully activated',
    proposal_id: proposalId,
    status: 'approved',
    schedule: activeSched || null,
  };
}

/**
 * Reject a pending proposal: discard it, active schedule stays unchanged.
 */
export async function rejectProposal(proposalId) {
  await delay(100);
  const proposal = proposals[proposalId];
  if (!proposal) throw Object.assign(new Error('Proposal not found'), { response: { data: { detail: 'Proposal not found' } } });
  if (proposal.status !== 'pending') throw Object.assign(new Error(`Proposal is already ${proposal.status}`), { response: { data: { detail: `Proposal is already ${proposal.status}` } } });

  proposal.status = 'rejected';
  persistState();
  return {
    message: 'Proposal rejected successfully',
    proposal_id: proposalId,
    status: 'rejected',
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
  invalidateUnclosedSchedules();
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

  // Synchronize tasks collection with onboarding items
  const syncedTasks = [];
  const seenFixedSignatures = new Set();
  const seenTaskTitles = new Set();

  // 1. Fixed commitments
  const fixedList = Array.isArray(answers.fixed_commitments) ? answers.fixed_commitments : [];
  fixedList.forEach((c) => {
    const title = (c.name || c.title || 'Fixed Commitment').trim();
    const days = (c.days || 'Daily').trim();
    const startTime = c.start_time || '09:00';
    const endTime = c.end_time || '10:00';
    const commuteBefore = Number(c.commute_before) || 0;
    const commuteAfter = Number(c.commute_after) || 0;
    const sig = `${title}|${days}|${startTime}|${endTime}|${commuteBefore}|${commuteAfter}`.toLowerCase();

    if (title && !seenFixedSignatures.has(sig)) {
      seenFixedSignatures.add(sig);
      const dur = calcMins(
        `2026-01-01T${startTime}:00`,
        `2026-01-01T${endTime}:00`
      ) || 60;
      syncedTasks.push({
        id: c.id || uid(),
        title: title,
        category: 'academic',
        task_type: 'fixed',
        tier: 'have_to',
        priority: 5,
        estimated_duration: dur,
        duration: dur,
        days: days,
        deadline: startTime ? `2026-01-01T${startTime}:00` : null,
        is_fixed: true,
        done: false,
        status: 'pending',
        commute_before: commuteBefore,
        commute_after: commuteAfter,
        start_time: startTime,
        end_time: endTime,
      });
    }
  });

  // 2. Need To items
  const needList = Array.isArray(answers.need_to_items) ? answers.need_to_items : [];
  needList.forEach((it) => {
    const title = (it.name || it.title || 'Need To Item').trim();
    if (title && !seenTaskTitles.has(title.toLowerCase())) {
      seenTaskTitles.add(title.toLowerCase());
      const dur = Number(it.duration) || Number(it.estimated_minutes) || 90;
      let semPref = it.semantic_preferences;
      if ((!semPref || semPref.isEmpty) && it.natural_language_note) {
        const parsed = parseTaskSemantics(it.natural_language_note, it);
        semPref = parsed.isEmpty ? null : parsed;
      }
      const rawFreq = it.frequency || (semPref && semPref.frequency);
      const isExplicitRecurring = rawFreq && rawFreq !== 'One-time';
      const freq = isExplicitRecurring ? rawFreq : 'One-time';
      const taskType = it.deadline ? (isExplicitRecurring ? 'growth' : 'deadline') : (isExplicitRecurring ? 'growth' : 'deadline');

      syncedTasks.push({
        id: it.id || uid(),
        title: title,
        category: 'academic',
        task_type: taskType,
        tier: 'have_to',
        priority: 5,
        estimated_duration: dur,
        duration: dur,
        frequency: freq,
        days: it.days || null,
        deadline: it.deadline || null,
        is_fixed: false,
        done: false,
        status: 'pending',
        natural_language_note: it.natural_language_note || null,
        semantic_preferences: semPref || null,
      });
    }
  });

  // 3. Should Do items
  const shouldList = Array.isArray(answers.should_do_items) ? answers.should_do_items : [];
  shouldList.forEach((it) => {
    const title = (it.name || it.title || 'Should Do Item').trim();
    if (title && !seenTaskTitles.has(title.toLowerCase())) {
      seenTaskTitles.add(title.toLowerCase());
      const dur = Number(it.duration) || Number(it.estimated_minutes) || 60;
      let semPref = it.semantic_preferences;
      if ((!semPref || semPref.isEmpty) && it.natural_language_note) {
        const parsed = parseTaskSemantics(it.natural_language_note, it);
        semPref = parsed.isEmpty ? null : parsed;
      }
      const rawFreq = it.frequency || (semPref && semPref.frequency);
      const isExplicitRecurring = rawFreq && rawFreq !== 'One-time';
      const freq = isExplicitRecurring ? rawFreq : (it.deadline ? 'One-time' : 'Daily');
      const taskType = it.deadline ? (isExplicitRecurring ? 'growth' : 'deadline') : 'growth';

      syncedTasks.push({
        id: it.id || uid(),
        title: title,
        category: 'academic',
        task_type: taskType,
        tier: 'need_to',
        priority: 3,
        estimated_duration: dur,
        duration: dur,
        frequency: freq,
        days: it.days || null,
        deadline: it.deadline || null,
        is_fixed: false,
        done: false,
        status: 'pending',
        natural_language_note: it.natural_language_note || null,
        semantic_preferences: semPref || null,
      });
    }
  });

  // 4. Like To items
  const likeList = Array.isArray(answers.like_to_items) ? answers.like_to_items : [];
  likeList.forEach((it) => {
    const title = (it.name || it.title || 'Like To Item').trim();
    if (title && !seenTaskTitles.has(title.toLowerCase())) {
      seenTaskTitles.add(title.toLowerCase());
      const dur = Number(it.duration) || Number(it.estimated_minutes) || 45;
      let semPref = it.semantic_preferences;
      if ((!semPref || semPref.isEmpty) && it.natural_language_note) {
        const parsed = parseTaskSemantics(it.natural_language_note, it);
        semPref = parsed.isEmpty ? null : parsed;
      }
      const rawFreq = it.frequency || (semPref && semPref.frequency);
      const isExplicitRecurring = rawFreq && rawFreq !== 'One-time';
      const freq = isExplicitRecurring ? rawFreq : (it.deadline ? 'One-time' : 'Weekly');
      const taskType = it.deadline ? (isExplicitRecurring ? 'growth' : 'deadline') : 'growth';

      syncedTasks.push({
        id: it.id || uid(),
        title: title,
        category: 'personal',
        task_type: taskType,
        tier: 'like_to',
        priority: 1,
        estimated_duration: dur,
        duration: dur,
        frequency: freq,
        days: it.days || null,
        deadline: it.deadline || null,
        is_fixed: false,
        done: false,
        status: 'pending',
        natural_language_note: it.natural_language_note || null,
        semantic_preferences: semPref || null,
      });
    }
  });

  tasks = syncedTasks;
  invalidateUnclosedSchedules();
  persistState();
  return preferences;
}
