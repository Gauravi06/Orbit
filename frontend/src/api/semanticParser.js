/**
 * Lightweight Semantic Parser for Orbit task notes.
 *
 * Interprets informal, abbreviated, or misspelled user natural-language notes
 * into structured semantic preferences for the deterministic scheduler.
 *
 * Interface contract:
 *   parseTaskSemantics(note, taskContext) -> {
 *     estimated_duration: number | null,
 *     frequency: string | null,
 *     split_preference: boolean | null,
 *     preferred_session_count: number | null,
 *     preferred_time: string[],
 *     avoid_time: string[],
 *     after_commitment: string | null,
 *     before_commitment: string | null,
 *     avoid_last_task: boolean,
 *     avoid_after_long_day: boolean,
 *     anchor_aware: boolean,
 *     flexible_timing: boolean,
 *     strength: 'preferred' | 'required' | 'flexible',
 *     user_note: string,
 *     summary: string | null,
 *   }
 */

// Common text contractions & slang expansion
function normalizeText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.toLowerCase().trim();

  // Expand contractions and common abbreviations
  text = text
    .replace(/\bclg\b/g, 'college')
    .replace(/\basg\b|\basgn\b|\basgmt\b/g, 'assignment')
    .replace(/\btmrw\b|\btom\b/g, 'tomorrow')
    .replace(/\bwk\b/g, 'week')
    .replace(/\bwks\b/g, 'weeks')
    .replace(/\bwknd\b/g, 'weekend')
    .replace(/\bwknds\b/g, 'weekends')
    .replace(/\bb\/w\b/g, 'between')
    .replace(/\bw\/\b/g, 'with')
    .replace(/\bw\/o\b/g, 'without')
    .replace(/\bapprox\b|\bapprox\.\b|\barnd\b/g, 'around')
    .replace(/\bpref\b/g, 'prefer')
    .replace(/\bprefs\b/g, 'prefers')
    .replace(/\bprob\b|\bprblm\b/g, 'problem')
    .replace(/\brevisn\b/g, 'revision')
    .replace(/\bsess\b|\bsessn\b/g, 'session')
    .replace(/\bblk\b|\bblks\b/g, 'block')
    .replace(/don['’]t/g, 'dont')
    .replace(/can['’]t/g, 'cant')
    .replace(/won['’]t/g, 'wont');

  return text;
}

function parseWordNumber(str) {
  if (!str) return null;
  const num = parseInt(str, 10);
  if (!isNaN(num)) return num;
  const map = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    a: 1,
    couple: 2,
  };
  return map[str.toLowerCase()] || null;
}

export function parseTaskSemantics(note, taskContext = {}) {
  if (!note || typeof note !== 'string' || !note.trim()) {
    return {
      isEmpty: true,
      estimated_duration: null,
      frequency: null,
      split_preference: null,
      preferred_session_count: null,
      preferred_time: [],
      avoid_time: [],
      after_commitment: null,
      before_commitment: null,
      avoid_last_task: false,
      avoid_after_long_day: false,
      anchor_aware: false,
      flexible_timing: false,
      strength: 'preferred',
      user_note: '',
      summary: null,
    };
  }

  const clean = normalizeText(note);
  const preferredTime = [];
  const avoidTime = [];
  let estimatedDuration = null;
  let frequency = null;
  let splitPreference = null;
  let preferredSessionCount = null;
  let afterCommitment = null;
  let beforeCommitment = null;
  let avoidLastTask = false;
  let avoidAfterLongDay = false;
  let anchorAware = false;
  let flexibleTiming = false;
  let strength = 'preferred';

  // 1. DURATION PARSING
  // Match patterns like "240 mins", "90m", "1 hour", "2 hrs", "1.5h", "around an hour", "half an hour"
  const hrMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minMatch = clean.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  const halfHr = clean.includes('half an hour') || clean.includes('half hour') || clean.includes('30m');
  const aroundHr = clean.includes('around an hour') || clean.includes('about an hour') || clean.includes('around 1 hour');
  const coupleHr = clean.includes('couple of hours') || clean.includes('couple hours');

  if (hrMatch) {
    estimatedDuration = Math.round(parseFloat(hrMatch[1]) * 60);
  } else if (minMatch) {
    estimatedDuration = parseInt(minMatch[1], 10);
  } else if (halfHr) {
    estimatedDuration = 30;
  } else if (aroundHr) {
    estimatedDuration = 60;
  } else if (coupleHr) {
    estimatedDuration = 120;
  }

  // 2. FREQUENCY PARSING (RULE 1: Explicit recurrence only)
  if (/\b(?:daily|every\s*day|everyday)\b/.test(clean)) {
    frequency = 'Daily';
  } else if (/\b(?:weekdays|weekdays\s*only|mon\s*(?:to|–|-)\s*fri)\b/.test(clean)) {
    frequency = 'Weekdays';
  } else if (/\b(?:weekends|weekends\s*only|sat\s*(?:and|&)?\s*sun)\b/.test(clean)) {
    frequency = 'Weekends';
  } else if (/\b(?:twice\s*a\s*week|2x\s*(?:a\s*)?week|2x\/week|2\s*times\s*a\s*week)\b/.test(clean)) {
    frequency = '2x a week';
  } else if (/\b(?:3-4x\s*(?:a\s*)?week|3\s*to\s*4\s*times\s*a\s*week|3x\s*(?:a\s*)?week)\b/.test(clean)) {
    frequency = '3-4x a week';
  } else if (/\b(?:weekly|once\s*a\s*week|1x\s*(?:a\s*)?week|every\s*week)\b/.test(clean)) {
    frequency = 'Weekly';
  } else if (/\b(?:regularly|recurring)\b/.test(clean)) {
    frequency = 'Regularly';
  } else if (/\b(?:one-time|one-off|once|just\s*once)\b/.test(clean)) {
    frequency = 'One-time';
  } else {
    // RULE 1: Unspecified recurrence is One-time by default
    frequency = 'One-time';
  }

  // 3. PRIORITY TIER PARSING (RULES 2, 4, 5)
  let tier = 'have_to';
  // Check explicit priority first (RULE 5)
  if (/\b(?:need\s*to|must\s*(?:do|finish)?|have\s*to|urgent|high\s*priority|important|critical|top\s*priority)\b/.test(clean)) {
    tier = 'have_to'; // Need To
  } else if (/\b(?:should\s*do|should|medium\s*priority|normal\s*priority)\b/.test(clean)) {
    tier = 'need_to'; // Should Do
  } else if (/\b(?:like\s*to|hobby|low\s*priority|optional|fun|when\s*free|leisure)\b/.test(clean)) {
    tier = 'like_to'; // Like To
  } else {
    // Deliverable / academic cues (RULE 2, 4) -> Need To (have_to)
    if (/\b(?:assignment|asg|asgn|asgmt|project|submission|submit|exam|test|quiz|midterm|final|prep|deadline|report|paper|lab|lab\s*work|presentation|slides|application|dissertation|thesis|homework|problem\s*set|pset)\b/.test(clean)) {
      tier = 'have_to';
    } else if (/\b(?:reading|book|novel|journal|journalling|game|gaming|relax|meditate|meditation|walk|guitar|music|movie|draw|drawing|sketch|podcast)\b/.test(clean)) {
      tier = 'like_to';
    } else if (/\b(?:gym|workout|exercise|swim|run|yoga|dsa|coding|practice|maths|revision|coursework|study)\b/.test(clean)) {
      tier = 'need_to';
    } else {
      tier = 'need_to';
    }
  }

  // 4. PREFERENCE STRENGTH & ANCHORS
  if (/\b(?:must|strictly|only|mandatory|have\s*to)\b/.test(clean)) {
    strength = 'required';
  } else if (/\b(?:flexible|whenever|anytime|any\s*time)\b/.test(clean)) {
    strength = 'flexible';
    flexibleTiming = true;
  } else {
    strength = 'preferred';
  }

  if (
    clean.includes('contradict') ||
    clean.includes('conflict') ||
    clean.includes('fixed anchor') ||
    clean.includes('anchor') ||
    clean.includes('unless clg') ||
    clean.includes('unless college')
  ) {
    anchorAware = true;
  }

  // 4. TIMING & TIME-OF-DAY
  // Avoid timings
  if (/\b(?:not|avoid|dont\s*do|no)\s*(?:at\s*)?(?:late\s*)?nights?\b/.test(clean) || clean.includes('avoid night') || clean.includes('not at night')) {
    avoidTime.push('night');
  }
  if (/\b(?:not|avoid|dont\s*do|no)\s*(?:in\s*the\s*)?mornings?\b/.test(clean)) {
    avoidTime.push('morning');
  }
  if (/\b(?:not|avoid|dont\s*do|no)\s*afternoons?\b/.test(clean)) {
    avoidTime.push('afternoon');
  }
  if (/\b(?:not|avoid|dont\s*do|no)\s*evenings?\b/.test(clean)) {
    avoidTime.push('evening');
  }

  // Avoid last task
  if (
    /\b(?:not|avoid|dont\s*(?:put|do|schedule))\s*(?:as\s*)?(?:the\s*)?last\s*task\b/.test(clean) ||
    clean.includes('not as last task') ||
    clean.includes('not last task') ||
    clean.includes('avoid last') ||
    clean.includes('not as the last')
  ) {
    avoidLastTask = true;
    avoidTime.push('last_task_of_day');
  }

  if (clean.includes('avoid after a long day') || clean.includes('not after a heavy day') || clean.includes('avoid after long day')) {
    avoidAfterLongDay = true;
  }

  // Preferred timings
  if (
    (/\bmornings?\b/.test(clean) || /\bearly\b/.test(clean)) &&
    !avoidTime.includes('morning')
  ) {
    preferredTime.push('morning');
  }

  if (
    (/\bafternoons?\b/.test(clean) || /\bmidday\b/.test(clean) || /\bpost\s*noon\b/.test(clean)) &&
    !avoidTime.includes('afternoon')
  ) {
    preferredTime.push('afternoon');
  }

  if (
    /\bevenings?\b/.test(clean) &&
    !avoidTime.includes('evening')
  ) {
    preferredTime.push('evening');
  }

  // Commitments & recovery relative timing
  const afterCommitMatch = clean.match(/after\s+(?:a\s+break\s+after\s+)?(college|classes|clg|gym|dinner|lunch|work)/);
  if (afterCommitMatch) {
    afterCommitment = afterCommitMatch[1] === 'clg' ? 'college' : afterCommitMatch[1];
    if (clean.includes('after a break') || clean.includes('after break') || clean.includes('recovery')) {
      preferredTime.push('after_fixed_commitment_recovery');
    } else {
      preferredTime.push('after_commitment');
    }
  } else if (clean.includes('after a break') || clean.includes('after break')) {
    preferredTime.push('after_fixed_commitment_recovery');
  }

  const beforeCommitMatch = clean.match(/before\s+(college|classes|clg|gym|dinner|lunch|work)/);
  if (beforeCommitMatch) {
    beforeCommitment = beforeCommitMatch[1] === 'clg' ? 'college' : beforeCommitMatch[1];
    preferredTime.push('before_commitment');
  }

  // 5. SPLITTING PREFERENCES
  // Check explicit single session / no-splitting FIRST
  if (
    clean.includes('one continuous') ||
    clean.includes('single block') ||
    clean.includes('single session') ||
    clean.includes('all at once') ||
    clean.includes('dont split') ||
    clean.includes('do not split') ||
    clean.includes('no split')
  ) {
    splitPreference = false;
    preferredSessionCount = 1;
  } else {
    // "complete this in two block", "split into 2 blocks", "split into 3 sessions"
    const splitCountMatch = clean.match(/(?:split\s*(?:in|into)?|complete\s*(?:this\s*)?in|in|prefer\s*(?:to\s*)?do\s*(?:in)?)\s*(\d+|one|two|three|four)\s*(?:blocks?|sessions?|chunks?|parts?)/);
    if (splitCountMatch) {
      splitPreference = true;
      preferredSessionCount = parseWordNumber(splitCountMatch[1]);
    } else if (clean.includes('two block') || clean.includes('two session') || clean.includes('2 block') || clean.includes('2 session') || clean.includes('two chunks')) {
      splitPreference = true;
      preferredSessionCount = 2;
    } else if (clean.includes('three block') || clean.includes('3 block') || clean.includes('three session')) {
      splitPreference = true;
      preferredSessionCount = 3;
    } else if (
      clean.includes('in chunks') ||
      clean.includes('dont do all at once') ||
      clean.includes('not all at once') ||
      clean.includes('split')
    ) {
      splitPreference = true;
    }
  }

  // 6. SPACING
  let spacingPreference = null;
  if (clean.includes('non-consecutive') || clean.includes('alternate day') || clean.includes('space them out') || clean.includes('skip a day')) {
    spacingPreference = 'non_consecutive';
  } else if (clean.includes('consecutive day')) {
    spacingPreference = 'consecutive';
  }

  // 7. BUILD HUMAN-READABLE CONFIRMATION SUMMARY
  const summaryParts = [];

  if (preferredTime.includes('morning')) summaryParts.push('Morning preferred');
  if (preferredTime.includes('afternoon')) summaryParts.push('Afternoon preferred');
  if (preferredTime.includes('evening')) summaryParts.push('Evening preferred');
  if (afterCommitment) {
    if (preferredTime.includes('after_fixed_commitment_recovery')) {
      summaryParts.push(`After ${afterCommitment} recovery`);
    } else {
      summaryParts.push(`After ${afterCommitment}`);
    }
  }
  if (beforeCommitment) summaryParts.push(`Before ${beforeCommitment}`);

  if (splitPreference === true) {
    if (preferredSessionCount) {
      summaryParts.push(`Split into ${preferredSessionCount} sessions`);
    } else {
      summaryParts.push('Split into chunks');
    }
  } else if (splitPreference === false) {
    summaryParts.push('Keep as single session');
  }

  if (spacingPreference === 'non_consecutive') summaryParts.push('Non-consecutive days');
  if (avoidLastTask) summaryParts.push('Avoid last task of day');
  if (avoidTime.includes('night')) summaryParts.push('Avoid late night');
  if (avoidAfterLongDay) summaryParts.push('Avoid after long days');
  if (anchorAware) summaryParts.push('Anchor aware');
  if (flexibleTiming) summaryParts.push('Flexible timing');

  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : null;

  const isExplicitRecurring = frequency && frequency !== 'One-time';
  const taskType = isExplicitRecurring ? 'growth' : 'deadline';
  const priority = tier === 'have_to' ? 5 : tier === 'need_to' ? 3 : 1;

  return {
    isEmpty: false,
    tier: tier,
    priority: priority,
    task_type: taskType,
    estimated_duration: estimatedDuration,
    frequency: frequency,
    split_preference: splitPreference,
    preferred_session_count: preferredSessionCount,
    preferred_time: preferredTime,
    avoid_time: avoidTime,
    after_commitment: afterCommitment,
    before_commitment: beforeCommitment,
    avoid_last_task: avoidLastTask,
    avoid_after_long_day: avoidAfterLongDay,
    spacing_preference: spacingPreference,
    anchor_aware: anchorAware,
    flexible_timing: flexibleTiming,
    strength: strength,
    user_note: note.trim(),
    summary: summary,
  };
}

/**
 * Async interface for future LLM integration.
 * Defaults deterministically to local rule-based parsing.
 */
export async function parseTaskSemanticsAsync(note, taskContext = {}) {
  // If an external LLM endpoint is plugged in future, it can be awaited here
  return parseTaskSemantics(note, taskContext);
}
