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
  getSchedule,
  createTask,
  setItemDone,
  savePreferences,
  resetDemoState,
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
});
