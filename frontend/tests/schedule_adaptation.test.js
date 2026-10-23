import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Provide in-memory localStorage for Node environment if not present
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

import {
  proposeDisruption,
  approveProposal,
  rejectProposal,
  replanSchedule,
  getSchedule,
  createTask,
  setItemDone,
  closeDay,
  savePreferences,
  resetDemoState,
  seedDemoStudent,
  getInsights,
  submitInsightFeedback,
} from '../src/api/mock.js';

describe('Orbit Schedule Adaptation & Proposals', () => {
  beforeEach(() => {
    resetDemoState();
  });

  test('1. Cancelled lectures create newly available time without removing unrelated fixed commitments', async () => {
    // Set up preferences with college lectures, doctor appointment, and dinner
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 501,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
          commute_before: 30,
          commute_after: 20,
        },
        {
          id: 502,
          name: 'Doctor Appointment',
          days: 'Daily',
          start_time: '17:00',
          end_time: '18:00',
          commute_before: 0,
          commute_after: 0,
        },
      ],
    });

    const activeBefore = await getSchedule();
    const hasDoctorBefore = activeBefore.items.some((i) => i.title === 'Doctor Appointment');
    const hasDinnerBefore = activeBefore.items.some((i) => i.title === 'Dinner');
    const hasLecturesBefore = activeBefore.items.some((i) => i.title === 'College Lectures');

    assert.equal(hasLecturesBefore, true, 'College Lectures should be in active schedule');
    assert.equal(hasDoctorBefore, true, 'Doctor Appointment should be in active schedule');
    assert.equal(hasDinnerBefore, true, 'Dinner should be in active schedule');

    // User reports lectures cancelled
    const proposal = await proposeDisruption('Lectures were cancelled today');

    assert.ok(proposal.proposal_id, 'Proposal should have proposal_id');
    assert.equal(proposal.status, 'pending', 'Proposal should be pending');

    const proposedItems = proposal.snapshot[0].items;

    // College Lectures should be removed
    const hasLecturesInProposal = proposedItems.some((i) => i.title === 'College Lectures');
    assert.equal(hasLecturesInProposal, false, 'College Lectures must be removed from proposed plan');

    // Travel / buffer for college should also be removed
    const hasTravelCollege = proposedItems.some((i) => i.title.toLowerCase().includes('college'));
    assert.equal(hasTravelCollege, false, 'Attached college travel/buffer must be removed');

    // Unrelated fixed commitments MUST remain
    const hasDoctorInProposal = proposedItems.some((i) => i.title === 'Doctor Appointment');
    const hasDinnerInProposal = proposedItems.some((i) => i.title === 'Dinner');
    assert.equal(hasDoctorInProposal, true, 'Doctor Appointment must be preserved');
    assert.equal(hasDinnerInProposal, true, 'Dinner routine must be preserved');

    // Change log must reflect cancellation
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('college lectures') || c.toLowerCase().includes('cancelled')),
      'what_changed must mention cancelled lectures'
    );
  });

  test('2. The example request proposes a meaningful change after 3 PM on Tuesday', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 601,
          name: 'College Lectures',
          days: 'Tuesday',
          start_time: '09:00',
          end_time: '15:00',
        },
      ],
    });

    const prompt = 'Got back home at 3 on Tuesday since lectures were cancelled, feel like doing something productive.';
    const choiceResponse = await proposeDisruption(prompt);
    assert.equal(choiceResponse.needs_choice, true, 'Broad productivity requests should ask the user to choose');
    assert.ok(choiceResponse.options?.length, 'At least one contextual option should be offered');
    const proposal = await proposeDisruption(prompt, null, choiceResponse.options[0]);

    assert.ok(proposal.proposal_id, 'Must return a proposal after a choice');
    assert.equal(proposal.status, 'pending');

    const daySchedule = proposal.snapshot[0];
    const tuesdayDate = new Date(daySchedule.date + 'T00:00:00');
    assert.equal(tuesdayDate.getDay(), 2, 'Proposed date must be Tuesday (day 2)');

    // An early arrival should shorten the college commitment, not delete it.
    const lectures = daySchedule.items.find((i) => i.title === 'College Lectures');
    assert.ok(lectures, 'The existing college commitment should be preserved');
    assert.equal(lectures.end_time.split('T')[1].slice(0, 5), '14:40', 'College should end at 2:40 PM so the 20-minute return buffer ends at 3 PM');

    // A productive session must be placed at or after 3 PM (15:00)
    const productiveBlock = daySchedule.items.find(
      (i) => i.kind === 'deep' && !i.is_fixed && (i.title === 'Flexible Focus Block' || i.kind === 'deep')
    );
    assert.ok(productiveBlock, 'A productive focus block must be proposed');

    const startTime = productiveBlock.start_time.split('T')[1].slice(0, 5);
    const [startH, startM] = startTime.split(':').map(Number);
    const startMins = startH * 60 + startM;
    assert.ok(startMins >= 900, `Productive block must start at or after 3:00 PM (15:00). Found: ${startTime}`);

    // Must have a recovery buffer following it
    const hasRecovery = daySchedule.items.some((i) => i.title === 'Recovery Buffer');
    assert.equal(hasRecovery, true, 'Recovery buffer should follow deep work');

    // what_changed must not say "looks manageable as-is"
    const whatChangedText = proposal.what_changed.join(' ');
    assert.ok(!whatChangedText.includes('manageable as-is'), 'Must not claim schedule looks manageable as-is');
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('3:00') || c.toLowerCase().includes('15:00') || c.toLowerCase().includes('focus')),
      'Must describe actual productive placement'
    );
  });

  test('3. A specific task with a deadline is not placed after that deadline silently', async () => {
    // Create a task with a deadline at 14:00 on Tuesday
    const now = new Date();
    const currentDay = now.getDay();
    const monDiff = (currentDay === 0 ? -6 : 1) - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + monDiff);
    const tuesday = new Date(monday);
    tuesday.setDate(monday.getDate() + 1);
    const pad = (n) => String(n).padStart(2, '0');
    const tueStr = `${tuesday.getFullYear()}-${pad(tuesday.getMonth() + 1)}-${pad(tuesday.getDate())}`;

    await createTask({
      title: 'Physics Lab Report',
      duration: 60,
      priority: 4,
      tier: 'have_to',
      deadline: `${tueStr}T14:00:00`,
    });

    // User asks to schedule Physics Lab Report after getting home at 3 PM (15:00)
    const proposal = await proposeDisruption('Got home at 3 on Tuesday, want to work on Physics Lab Report');

    assert.ok(proposal, 'Proposal created');
    // Conflict must be explicitly noted in at_risk
    const deadlineConflict = proposal.at_risk.find(
      (r) => r.title.includes('Physics Lab Report') && r.reason.toLowerCase().includes('deadline')
    );
    assert.ok(deadlineConflict, 'Conflict must be explicitly logged in at_risk when placed after deadline');

    // Warning must appear in what_changed
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('deadline') && c.includes('Physics Lab Report')),
      'Warning must be reported in what_changed'
    );
  });

  test('4. A message that requests rest does not trigger an unrelated productivity change', async () => {
    await createTask({
      title: 'Maths Problem Set',
      duration: 90,
      priority: 3,
      tier: 'need_to',
    });

    const proposal = await proposeDisruption('Feeling completely exhausted tonight and have a headache, need to rest');

    assert.ok(proposal, 'Proposal generated');
    const proposedItems = proposal.snapshot[0].items;

    // No new study or deep blocks should be added
    const newFocusBlock = proposedItems.find((i) => i.title === 'Flexible Focus Block');
    assert.equal(newFocusBlock, undefined, 'Rest request must not add Flexible Focus Block');

    // Existing non-fixed items should be marked displaced
    const displacedItem = proposedItems.find((i) => i.status === 'displaced');
    if (displacedItem) {
      assert.ok(
        displacedItem.displacement_reason.toLowerCase().includes('recovery') ||
          displacedItem.displacement_reason.toLowerCase().includes('rest'),
        'Displacement reason should cite rest/recovery'
      );
    }

    assert.ok(
      proposal.summary.toLowerCase().includes('rest') || proposal.what_changed.some((c) => c.toLowerCase().includes('rest')),
      'Summary or what_changed must state rest is prioritized'
    );
  });

  test('5. An infeasible change is reported honestly', async () => {
    // User claims getting home at 23:15 and wants a 90 minute study block (bedtime is 23:30)
    const proposal = await proposeDisruption('Got back home at 23:15, need to do a 90 minute study session');

    assert.ok(proposal, 'Proposal returned');
    assert.ok(
      proposal.at_risk.length > 0,
      'Infeasible timing must be recorded in at_risk'
    );
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('cannot') || c.toLowerCase().includes('insufficient')),
      'Infeasibility must be stated honestly in what_changed'
    );
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('alternative') || c.toLowerCase().includes('tomorrow')),
      'Reasonable alternative must be offered'
    );

    // No 90 min task placed at 23:15
    const fakePlacement = proposal.snapshot[0].items.find(
      (i) => i.start_time.includes('23:15') && i.kind === 'deep'
    );
    assert.equal(fakePlacement, undefined, 'Must not fabricate a 90-minute block after bedtime');
  });

  test('6. Generating a proposal does not change the active schedule', async () => {
    const activeBefore = await getSchedule();
    const beforeCount = activeBefore.items.length;
    const beforeTitles = activeBefore.items.map((i) => i.title);

    const choiceResponse = await proposeDisruption('Lectures were cancelled today, feel like doing something productive');
    assert.equal(choiceResponse.needs_choice, true);
    const proposal = await proposeDisruption('Lectures were cancelled today, feel like doing something productive', null, choiceResponse.options[0]);
    assert.ok(proposal.proposal_id);

    const activeAfter = await getSchedule();
    const afterCount = activeAfter.items.length;
    const afterTitles = activeAfter.items.map((i) => i.title);

    assert.equal(afterCount, beforeCount, 'Active schedule item count must not change');
    assert.deepEqual(afterTitles, beforeTitles, 'Active schedule items must remain identical');
  });

  test('7. Approval applies the proposal and rejection leaves the schedule unchanged', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 701,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
        },
      ],
    });

    const activeInitial = await getSchedule();
    assert.ok(activeInitial.items.some((i) => i.title === 'College Lectures'));

    // --- REJECTION FLOW ---
    const proposalToReject = await proposeDisruption('Lectures were cancelled today');
    const rejectResult = await rejectProposal(proposalToReject.proposal_id);

    assert.equal(rejectResult.status, 'rejected');

    const activeAfterReject = await getSchedule();
    assert.ok(
      activeAfterReject.items.some((i) => i.title === 'College Lectures'),
      'Rejection must leave College Lectures in the active schedule'
    );

    // Duplicate rejection must fail
    await assert.rejects(
      async () => rejectProposal(proposalToReject.proposal_id),
      /already rejected/,
      'Duplicate rejection must throw error'
    );

    // --- APPROVAL FLOW ---
    const proposalToApprove = await proposeDisruption('Lectures were cancelled today');
    const approveResult = await approveProposal(proposalToApprove.proposal_id);

    assert.equal(approveResult.status, 'approved');

    const activeAfterApprove = await getSchedule();
    assert.equal(
      activeAfterApprove.items.some((i) => i.title === 'College Lectures'),
      false,
      'Approval must remove College Lectures from active schedule'
    );

    // Duplicate approval must fail
    await assert.rejects(
      async () => approveProposal(proposalToApprove.proposal_id),
      /already approved/,
      'Duplicate approval must throw error'
    );
  });

  test('8. Existing completion states and unrelated items are preserved', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 801,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
        },
      ],
    });

    await createTask({
      title: 'Morning Gym',
      duration: 45,
      priority: 3,
      tier: 'have_to',
    });

    const sched = await getSchedule();
    const gymItem = sched.items.find((i) => i.title === 'Morning Gym');
    assert.ok(gymItem, 'Morning Gym must be present');

    // Mark Morning Gym as done
    await setItemDone(gymItem.id, true);

    const schedAfterDone = await getSchedule();
    const gymDone = schedAfterDone.items.find((i) => i.title === 'Morning Gym');
    assert.equal(gymDone.done, true, 'Gym item must be marked done');

    // Now propose disruption and approve it
    const choiceResponse = await proposeDisruption('Lectures were cancelled today, feel like doing something productive');
    assert.equal(choiceResponse.needs_choice, true);
    const proposal = await proposeDisruption('Lectures were cancelled today, feel like doing something productive', null, choiceResponse.options[0]);
    await approveProposal(proposal.proposal_id);

    // Check active schedule after proposal approved
    const finalSched = await getSchedule();
    const finalGym = finalSched.items.find((i) => i.title === 'Morning Gym');
    assert.ok(finalGym, 'Morning Gym must still exist');
    assert.equal(finalGym.done, true, 'Morning Gym done state must be preserved after proposal activation');
  });

  test('9. All-day cancellation opens the day without a false bedtime infeasibility error', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 901,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '17:00',
          commute_before: 30,
          commute_after: 30,
        },
      ],
    });

    const activeBefore = await getSchedule();
    assert.ok(activeBefore.items.some((i) => i.title === 'College Lectures'), 'College Lectures initially present');

    // User inputs all-day cancellation with natural variations
    const proposal = await proposeDisruption('College entirely cancelled today. Home all day');

    assert.ok(proposal.proposal_id, 'Proposal generated');
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.at_risk.length, 0, 'Must NOT mark requested study session at risk with bedtime conflict');

    const proposedItems = proposal.snapshot[0].items;
    assert.equal(proposedItems.some((i) => i.title === 'College Lectures'), false, 'College Lectures must be removed');
    assert.equal(proposedItems.some((i) => i.title.toLowerCase().includes('travel: college')), false, 'Travel must be removed');

    // Must NOT invent study session or focus block for pure cancellation
    const deepBlocks = proposedItems.filter((i) => !i.is_fixed && i.kind === 'deep');
    assert.equal(deepBlocks.length, 0, 'Pure cancellation must NOT invent a study session or focus block');
    assert.ok(proposal.summary.toLowerCase().includes('cancelled') || proposal.what_changed.some((c) => c.toLowerCase().includes('cancelled')));
  });

  test('10. Cancelling a 3 PM lecture preserves 9 AM lecture and opens afternoon slot', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 1001,
          name: 'Morning Lecture',
          days: 'Daily',
          start_time: '09:00',
          end_time: '10:30',
          commute_before: 0,
          commute_after: 0,
        },
        {
          id: 1002,
          name: 'Afternoon Lecture',
          days: 'Daily',
          start_time: '15:00',
          end_time: '16:30',
          commute_before: 0,
          commute_after: 0,
        },
      ],
    });

    const activeBefore = await getSchedule();
    assert.ok(activeBefore.items.some((i) => i.title === 'Morning Lecture'), 'Morning Lecture in active');
    assert.ok(activeBefore.items.some((i) => i.title === 'Afternoon Lecture'), 'Afternoon Lecture in active');

    const proposal = await proposeDisruption('My 3 PM lecture got cancelled today');

    assert.ok(proposal.proposal_id, 'Proposal generated');
    const proposedItems = proposal.snapshot[0].items;

    // 9 AM lecture must be preserved!
    assert.ok(proposedItems.some((i) => i.title === 'Morning Lecture'), 'Morning Lecture at 9 AM must be preserved');

    // 3 PM lecture must be removed!
    assert.equal(proposedItems.some((i) => i.title === 'Afternoon Lecture'), false, '3 PM Afternoon Lecture must be removed');

    // Cancellation without productive request should not invent study blocks
    const deepBlocks = proposedItems.filter((i) => !i.is_fixed && i.kind === 'deep');
    assert.equal(deepBlocks.length, 0, 'Pure cancellation of 3 PM lecture must NOT invent a deep work block');
  });

  test('11. Closing a day carries incomplete deadline task forward without duplicating it across days', async () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymdStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Deadline 3 days from now
    const deadlineDate = new Date(now);
    deadlineDate.setDate(now.getDate() + 3);

    const task = await createTask({
      title: 'Database Architecture Report',
      duration: 60,
      priority: 4,
      tier: 'have_to',
      deadline: `${ymdStr(deadlineDate)}T23:59:00`,
    });

    const todayStr = ymdStr(now);
    await getSchedule(todayStr);

    // Close today's schedule with the task left unticked
    await closeDay(todayStr);

    // Check next 3 days: task should appear in future schedules but NEVER duplicated on multiple days
    let futureScheduledCount = 0;
    for (let offset = 1; offset <= 3; offset++) {
      const fut = new Date(now);
      fut.setDate(now.getDate() + offset);
      const futSched = await getSchedule(ymdStr(fut));
      const hasTask = (futSched.items || []).some(
        (it) => (!it.is_fixed && it.status !== 'displaced') &&
                (it.task_id === task.id || it.title === 'Database Architecture Report')
      );
      if (hasTask) futureScheduledCount++;
    }

    assert.equal(futureScheduledCount, 1, `Single-session deadline task must be scheduled exactly once across future days, found in ${futureScheduledCount} days`);
  });

  test('12. Invariants preserved: wake/sleep boundaries and existing deadlines remain valid', async () => {
    await savePreferences({
      wake_time: '08:00',
      sleep_time: '23:00',
      focus_length: 60,
      fixed_commitments: [
        {
          id: 1201,
          name: 'Physics Lab',
          days: 'Daily',
          start_time: '14:00',
          end_time: '16:00',
        },
      ],
    });

    const proposal = await proposeDisruption('Physics Lab was cancelled today');
    assert.ok(proposal.proposal_id);
    assert.equal(proposal.violations.length, 0, 'Proposal must have 0 schedule invariant violations');

    const proposedItems = proposal.snapshot[0].items.filter((i) => i.status !== 'displaced');
    for (const item of proposedItems) {
      const startH = Number(item.start_time.split('T')[1].slice(0, 2));
      const startM = Number(item.start_time.split('T')[1].slice(3, 5));
      const endH = Number(item.end_time.split('T')[1].slice(0, 2));
      const endM = Number(item.end_time.split('T')[1].slice(3, 5));
      const sMins = startH * 60 + startM;
      const eMins = endH * 60 + endM;

      assert.ok(sMins >= 480, `Item "${item.title}" must not start before wake time 08:00 (480 mins). Found: ${sMins}`);
      assert.ok(eMins <= 1380, `Item "${item.title}" must not end after sleep time 23:00 (1380 mins). Found: ${eMins}`);
    }
  });

  test('13. Exact reproduction: "College cancelled. Home the entire day." does not invent 8 AM study session or bedtime error, and persists upon approval', async () => {
    await savePreferences({
      wake_time: '08:00',
      sleep_time: '00:00',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 1301,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
          commute_before: 60,
          commute_after: 30,
        },
        {
          id: 1302,
          name: 'Evening Doctor Appointment',
          days: 'Daily',
          start_time: '17:00',
          end_time: '18:00',
          commute_before: 0,
          commute_after: 0,
        },
      ],
    });

    const activeBefore = await getSchedule();
    assert.ok(activeBefore.items.some((i) => i.title === 'College Lectures'), 'College Lectures present before disruption');

    const proposal = await proposeDisruption('College cancelled. Home the entire day.');

    assert.ok(proposal.proposal_id, 'Proposal generated');
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.at_risk.length, 0, 'Must NOT generate false 8:00 AM or bedtime infeasibility error');

    const proposedItems = proposal.snapshot[0].items;
    // College and commute/buffer must be removed
    assert.equal(proposedItems.some((i) => i.title === 'College Lectures'), false, 'College Lectures must be removed');
    assert.equal(proposedItems.some((i) => i.title.toLowerCase().includes('travel: college')), false, 'Travel must be removed');
    assert.equal(proposedItems.some((i) => i.title.toLowerCase().includes('transition: college')), false, 'Transition buffer must be removed');

    // No invented study sessions
    const deepBlocks = proposedItems.filter((i) => !i.is_fixed && i.kind === 'deep');
    assert.equal(deepBlocks.length, 0, 'Must not invent an 8:00 AM study session or Flexible Focus Block');

    // Unrelated fixed commitment preserved
    assert.ok(proposedItems.some((i) => i.title === 'Evening Doctor Appointment'), 'Unrelated commitment must be preserved');

    // Active schedule unchanged before approval
    const activeMid = await getSchedule();
    assert.ok(activeMid.items.some((i) => i.title === 'College Lectures'), 'Active schedule must remain unchanged before approval');

    // Approve proposal and verify persistence on reload
    await approveProposal(proposal.proposal_id);
    const activeAfter = await getSchedule();
    assert.equal(activeAfter.items.some((i) => i.title === 'College Lectures'), false, 'Cancelled college must remain removed after approval');
    assert.ok(activeAfter.items.some((i) => i.title === 'Evening Doctor Appointment'), 'Unrelated commitment preserved after approval');
  });

  test('14. Explicit request: "College cancelled. Schedule DSA at 8 AM instead." schedules DSA at 8 AM', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 1401,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
          commute_before: 60,
          commute_after: 30,
        },
      ],
    });

    await createTask({
      title: 'DSA',
      duration: 60,
      priority: 4,
      tier: 'need_to',
    });

    const proposal = await proposeDisruption('College cancelled. Schedule DSA at 8 AM instead.');
    assert.ok(proposal.proposal_id);
    const proposedItems = proposal.snapshot[0].items;

    // College removed
    assert.equal(proposedItems.some((i) => i.title === 'College Lectures'), false, 'College must be removed');

    // DSA scheduled at 8:00 AM
    const dsaAt8 = proposedItems.find((i) => i.title === 'DSA' && i.start_time.split('T')[1].slice(0, 5) === '08:00');
    assert.ok(dsaAt8, 'Explicitly requested DSA session must be scheduled at 08:00');
  });

  test('15. Regression: College commitment present in task list is not scheduled as a task upon cancellation', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      focus_length: 90,
      fixed_commitments: [
        {
          id: 1501,
          name: 'College',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
          commute_before: 60,
          commute_after: 30,
        },
      ],
    });

    // A task named "college" with a past deadline exists in the task list
    await createTask({
      title: 'college',
      deadline: '2026-01-01T14:00:00',
      duration: 90,
      priority: 4,
      tier: 'need_to',
    });

    const proposal = await proposeDisruption('College cancelled. Home the entire day.');

    assert.ok(proposal.proposal_id, 'Proposal generated');
    assert.equal(proposal.status, 'pending');

    // Assert no stale college deadline warning appears in at_risk or what_changed
    assert.equal(proposal.at_risk.length, 0, 'No stale college deadline warning should appear in at_risk');
    assert.equal(
      proposal.what_changed.some((c) => c.toLowerCase().includes('deadline') && c.toLowerCase().includes('college')),
      false,
      'No college deadline warning should appear in what_changed'
    );

    const proposedItems = proposal.snapshot[0].items;
    // Assert no item named college is scheduled
    assert.equal(
      proposedItems.some((i) => (i.title || '').toLowerCase() === 'college'),
      false,
      'No item named college should be scheduled'
    );

    // Assert no study session is invented
    const deepBlocks = proposedItems.filter((i) => !i.is_fixed && i.kind === 'deep');
    assert.equal(deepBlocks.length, 0, 'No study session or Flexible Focus Block should be invented');

    // Summary reflects clean cancellation
    assert.ok(proposal.summary.toLowerCase().includes('removed cancelled') || proposal.summary.toLowerCase().includes('cancelled'));
  });

  test('16. Adaptive cancellation flow: suggests realistic flow with genuine pending tasks, explains why, and persists on approval', async () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymdStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const deadlineDate = new Date(now);
    deadlineDate.setDate(now.getDate() + 2);

    await savePreferences({
      wake_time: '08:00',
      sleep_time: '23:30',
      focus_length: 90,
      best_time_of_day: 'morning',
      fixed_commitments: [
        {
          id: 1601,
          name: 'College Lectures',
          days: 'Daily',
          start_time: '09:00',
          end_time: '15:00',
          commute_before: 60,
          commute_after: 30,
        },
        {
          id: 1602,
          name: 'Evening Doctor Appointment',
          days: 'Daily',
          start_time: '17:00',
          end_time: '18:00',
          commute_before: 0,
          commute_after: 0,
        },
      ],
    });

    // Create high-priority task with approaching deadline
    const dsaTask = await createTask({
      title: 'DSA Problem Set',
      duration: 90,
      priority: 4,
      tier: 'have_to',
      deadline: `${ymdStr(deadlineDate)}T23:59:00`,
    });

    // Create low-priority task with no deadline
    await createTask({
      title: 'Casual Reading',
      duration: 60,
      priority: 1,
      tier: 'like_to',
    });

    const activeBefore = await getSchedule();
    assert.ok(activeBefore.items.some((i) => i.title === 'College Lectures'), 'College in active schedule before disruption');

    const proposal = await proposeDisruption('College cancelled. Home the entire day.');

    assert.ok(proposal.proposal_id, 'Proposal generated');
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.violations.length, 0, 'Zero invariant violations');

    const proposedItems = proposal.snapshot[0].items;

    // College removed
    assert.equal(proposedItems.some((i) => i.title === 'College Lectures'), false, 'College removed');
    assert.equal(proposedItems.some((i) => i.title.toLowerCase().includes('travel: college')), false, 'Travel removed');

    // Unrelated commitment preserved
    assert.ok(proposedItems.some((i) => i.title === 'Evening Doctor Appointment'), 'Doctor appointment preserved');

    // DSA Problem Set scheduled in freed morning time
    const scheduledDsa = proposedItems.find((i) => i.title === 'DSA Problem Set');
    assert.ok(scheduledDsa, 'Genuine backlog task "DSA Problem Set" should be scheduled in freed slot');
    assert.equal(scheduledDsa.task_id, dsaTask.id, 'Scheduled item links to genuine task ID');

    // Explanation in what_changed
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('dsa problem set') && (c.toLowerCase().includes('deadline') || c.toLowerCase().includes('priority'))),
      'what_changed must explain why the backlog task was suggested based on deadline or priority'
    );
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('approve') || c.toLowerCase().includes('discard')),
      'what_changed must ask for approval'
    );

    // Active schedule unchanged before approval
    const activeMid = await getSchedule();
    assert.ok(activeMid.items.some((i) => i.title === 'College Lectures'), 'Active schedule unchanged before approval');

    // Approval applies proposal
    await approveProposal(proposal.proposal_id);
    const activeAfter = await getSchedule();
    assert.equal(activeAfter.items.some((i) => i.title === 'College Lectures'), false, 'College removed after approval');
    assert.ok(activeAfter.items.some((i) => i.title === 'DSA Problem Set'), 'DSA Problem Set scheduled after approval');
    assert.ok(activeAfter.items.some((i) => i.title === 'Evening Doctor Appointment'), 'Doctor appointment preserved after approval');
  });

  test('17. 14-day demo seed creates isolated, repeatable profile with realistic tasks, 14-day history, and relative dates', async () => {
    const data = seedDemoStudent();

    // Check realistic student tasks
    assert.ok(data.tasks.length >= 6, 'Seed must provide at least 6 realistic student tasks');
    const dsa = data.tasks.find((t) => t.title.includes('DSA'));
    assert.ok(dsa, 'Seed must include high-priority DSA task');
    assert.ok(dsa.deadline, 'DSA task must have a deadline');

    // Check 14-day schedule coverage
    assert.equal(data.schedules.length, 14, 'Must seed exactly 14 days of schedule history (7 past, today, 6 future)');

    // Past days must be closed with realistic completed/missed states
    const pastDays = data.schedules.filter((s) => s.is_closed);
    assert.equal(pastDays.length, 7, 'Must have 7 closed past days');

    // Thursday evening fatigue displacement exists in history
    const thursdays = pastDays.filter((s) => new Date(s.date + 'T00:00:00').getDay() === 4);
    assert.ok(thursdays.length > 0, 'Must include Thursday in past days');
    const hasDisplacement = thursdays.some((th) =>
      th.items.some((it) => it.displacement_reason && it.displacement_reason.includes('fatigue'))
    );
    assert.ok(hasDisplacement, 'History must include lecture fatigue displacement evidence');

    // Seeded reflections
    assert.ok(data.notes.length >= 3, 'Must seed past feedback and reflections');
  });

  test('18. What Orbit Learned: evidence-backed observations and interactive Yes/No feedback', async () => {
    seedDemoStudent();

    const insights = await getInsights();
    assert.ok(insights.length >= 3, 'Must provide at least 3 evidence-backed observations');

    const morningInsight = insights.find((i) => i.id === 'morning-peak-focus');
    assert.ok(morningInsight, 'Must include morning peak focus observation');
    assert.ok(morningInsight.evidence.includes('14 days'), 'Observation must cite 14-day evidence');
    assert.ok(morningInsight.adaptation, 'Observation must explain how Orbit adapts');

    // Submit "Yes" feedback
    const updatedYes = await submitInsightFeedback('morning-peak-focus', 'yes');
    assert.equal(updatedYes.userFeedback, 'yes');
    assert.ok(updatedYes.feedbackMessage.includes('confirmed'));

    // Submit "No" feedback
    const updatedNo = await submitInsightFeedback('morning-peak-focus', 'no');
    assert.equal(updatedNo.userFeedback, 'no');
    assert.ok(updatedNo.feedbackMessage.includes('Noted'));
  });

  test('19. Learned preference demonstration: morning focus peak rhythm shapes adaptive cancellation proposal', async () => {
    seedDemoStudent();

    // The demo student has College Lectures (09:00 - 15:00) and pending DSA task
    const proposal = await proposeDisruption('College cancelled. Home the entire day.');

    assert.ok(proposal.proposal_id);
    assert.equal(proposal.violations.length, 0);

    const proposedItems = proposal.snapshot[0].items;

    // College cancelled
    assert.equal(proposedItems.some((i) => i.title === 'College Lectures'), false, 'College must be cancelled');

    // DSA scheduled in morning focus window (09:00)
    const dsaSession = proposedItems.find((i) => i.title.includes('DSA'));
    assert.ok(dsaSession, 'DSA must be scheduled in newly opened morning window');

    // Demonstrated learned preference in what_changed
    assert.ok(
      proposal.what_changed.some((c) => c.toLowerCase().includes('learned') || c.toLowerCase().includes('morning peak') || c.toLowerCase().includes('rhythm')),
      'Proposal what_changed must demonstrate applying the learned preference'
    );

    // Approval applies proposal to active schedule
    await approveProposal(proposal.proposal_id);
    const active = await getSchedule();
    assert.ok(active.items.some((i) => i.title.includes('DSA')), 'DSA active after approval');
    assert.equal(active.items.some((i) => i.title === 'College Lectures'), false, 'College removed from active after approval');
  });

  test('20. replanSchedule requesting schedule change creates a reviewable proposal without mutating active schedule', async () => {
    await savePreferences({
      wake_time: '07:00',
      sleep_time: '23:30',
      need_to_items: [{ id: 1, title: 'Calculus Assignment', duration: 90 }],
    });

    const initialSchedule = await getSchedule();
    const initialItemTitles = initialSchedule.items.map((i) => i.title);

    // Call replanSchedule requesting fatigue / lighten
    const res = await replanSchedule({
      reason: 'Too heavy',
      feedbackText: 'Too exhausted to study tonight, need rest',
    });

    assert.equal(res.success, true);
    assert.ok(res.proposal, 'Must return a proposal object');
    assert.ok(res.proposal.proposal_id, 'Proposal must have an ID');
    assert.equal(res.proposal.status, 'pending');

    // CRITICAL GUARANTEE: Active schedule must NOT be mutated before explicit approval
    const scheduleBeforeApproval = await getSchedule();
    const beforeTitles = scheduleBeforeApproval.items.map((i) => i.title);
    assert.deepEqual(beforeTitles, initialItemTitles, 'Active schedule items must remain identical before approval');

    // Rejecting leaves active schedule unchanged
    const rej = await rejectProposal(res.proposal.proposal_id);
    assert.equal(rej.status, 'rejected');
    const scheduleAfterReject = await getSchedule();
    assert.deepEqual(scheduleAfterReject.items.map((i) => i.title), initialItemTitles);
  });

  test('21. replanSchedule with emotion/preference-only feedback does not mutate active schedule or return a proposal', async () => {
    const initialSchedule = await getSchedule();
    const initialVersion = initialSchedule.version;

    const res = await replanSchedule({
      feedbackText: 'I am feeling calm and confident with my schedule today',
    });

    assert.equal(res.success, true);
    assert.equal(res.proposal, null, 'Must not create a schedule-changing proposal for emotion-only feedback');
    assert.deepEqual(res.what_changed, [], 'Must not claim schedule changed');
    assert.ok(res.message.includes('without changing your active schedule'));

    const currentSchedule = await getSchedule();
    assert.equal(currentSchedule.version, initialVersion, 'Active schedule version must not change');
  });
});
