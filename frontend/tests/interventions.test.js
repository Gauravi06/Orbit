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
  createTask,
  updateTask,
  getInterventions,
  dismissIntervention,
  snoozeIntervention,
  resetDemoState,
  loadStoredState,
} from '../src/api/mock.js';

describe('Proactive Interventions Subsystem', () => {
  beforeEach(() => {
    resetDemoState();
  });

  test('1. Generates approaching deadline intervention for tasks due within 24 hours', async () => {
    const dueSoon = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    await createTask({
      title: 'Machine Learning Assignment 2',
      deadline: dueSoon,
      estimated_duration: 90,
      priority: 4,
    });

    const active = await getInterventions('active');
    assert.ok(active.length >= 1, 'Should generate at least 1 active intervention');
    const inv = active.find((i) => i.title.includes('Machine Learning Assignment 2'));
    assert.ok(inv, 'Intervention for ML assignment should exist');
    assert.strictEqual(inv.intervention_type, 'approaching_deadline');
    assert.strictEqual(inv.status, 'active');
  });

  test('2. Generates overdue intervention for past deadline tasks', async () => {
    const pastDue = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    await createTask({
      title: 'Submit Lab Report',
      deadline: pastDue,
      estimated_duration: 45,
      priority: 3,
    });

    const active = await getInterventions('active');
    const inv = active.find((i) => i.title.includes('Submit Lab Report'));
    assert.ok(inv, 'Overdue intervention should exist');
    assert.strictEqual(inv.intervention_type, 'overdue');
    assert.strictEqual(inv.status, 'active');
  });

  test('3. Ignores fixed commitments and completed tasks', async () => {
    const dueSoon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    // Fixed commitment
    await createTask({
      title: 'Weekly Seminar',
      deadline: dueSoon,
      is_fixed: true,
    });
    // Completed task
    await createTask({
      title: 'Done Homework',
      deadline: dueSoon,
      done: true,
      status: 'completed',
    });

    const active = await getInterventions('active');
    const fixedInv = active.find((i) => i.title.includes('Weekly Seminar'));
    const doneInv = active.find((i) => i.title.includes('Done Homework'));
    assert.strictEqual(fixedInv, undefined, 'Fixed commitments should never generate interventions');
    assert.strictEqual(doneInv, undefined, 'Completed tasks should not generate interventions');
  });

  test('4. Dismissing an intervention sets status to dismissed', async () => {
    const dueSoon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const task = await createTask({
      title: 'Essay Draft',
      deadline: dueSoon,
      estimated_duration: 60,
    });

    const activeBefore = await getInterventions('active');
    const inv = activeBefore.find((i) => i.task_id === task.id);
    assert.ok(inv, 'Active intervention must exist');

    const dismissed = await dismissIntervention(inv.id);
    assert.strictEqual(dismissed.status, 'dismissed');
    assert.ok(dismissed.dismissed_at, 'dismissed_at timestamp should be set');

    const activeAfter = await getInterventions('active');
    assert.ok(!activeAfter.some((i) => i.id === inv.id), 'Dismissed intervention should not appear in active query');
  });

  test('5. Snoozing an intervention updates snoozed_until and validates future timestamp', async () => {
    const dueSoon = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
    const task = await createTask({
      title: 'Compiler Project',
      deadline: dueSoon,
    });

    const activeBefore = await getInterventions('active');
    const inv = activeBefore.find((i) => i.task_id === task.id);
    assert.ok(inv, 'Active intervention must exist');

    // Reject past date
    const pastDate = new Date(Date.now() - 60000).toISOString();
    await assert.rejects(
      async () => {
        await snoozeIntervention(inv.id, pastDate);
      },
      (err) => err.response?.status === 422 || err.message?.includes('future')
    );

    // Valid future snooze
    const futureDate = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const snoozed = await snoozeIntervention(inv.id, futureDate);
    assert.strictEqual(snoozed.status, 'snoozed');
    assert.strictEqual(snoozed.snoozed_until, futureDate);

    const activeAfter = await getInterventions('active');
    assert.ok(!activeAfter.some((i) => i.id === inv.id), 'Snoozed intervention should not appear in active query');
  });

  test('6. Generates repeated_unfinished intervention when task remains unfinished across >= 2 past planned days', async () => {
    const task = await createTask({
      title: 'Operating Systems Virtual Memory Lab',
      estimated_duration: 90,
      priority: 4,
    });

    // Seed mock schedules with 2 past days where this task was planned
    const d1 = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const d2 = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const mockSchedules = [
      {
        date: d1,
        scheduler_version: '2026.10.balanced_v8_live',
        items: [
          {
            id: 'item-d1',
            task_id: task.id,
            title: task.title,
            done: false,
            status: 'scheduled',
          },
        ],
      },
      {
        date: d2,
        scheduler_version: '2026.10.balanced_v8_live',
        items: [
          {
            id: 'item-d2',
            task_id: task.id,
            title: task.title,
            done: false,
            status: 'scheduled',
          },
        ],
      },
    ];
    globalThis.localStorage.setItem('orbit_mock_schedules', JSON.stringify(mockSchedules));
    loadStoredState();

    const active = await getInterventions('active');
    const inv = active.find((i) => i.task_id === task.id && i.intervention_type === 'repeated_unfinished');
    assert.ok(inv, 'Repeated unfinished intervention should be created');
    assert.ok(inv.message.includes('unfinished across 2 past planned days'));
    assert.ok(inv.message.includes('Is the current plan not working?'));
  });

  test('7. Resolves repeated_unfinished intervention when task is marked completed', async () => {
    const task = await createTask({
      title: 'Database Normalization',
      estimated_duration: 60,
    });

    const d1 = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const d2 = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const mockSchedules = [
      {
        date: d1,
        scheduler_version: '2026.10.balanced_v8_live',
        items: [{ id: 'item-1', task_id: task.id, title: task.title, done: false, status: 'scheduled' }],
      },
      {
        date: d2,
        scheduler_version: '2026.10.balanced_v8_live',
        items: [{ id: 'item-2', task_id: task.id, title: task.title, done: false, status: 'scheduled' }],
      },
    ];
    globalThis.localStorage.setItem('orbit_mock_schedules', JSON.stringify(mockSchedules));
    loadStoredState();

    // First query creates it
    const activeBefore = await getInterventions('active');
    const inv = activeBefore.find((i) => i.task_id === task.id && i.intervention_type === 'repeated_unfinished');
    assert.ok(inv, 'Active repeated_unfinished intervention should exist');

    // Mark task completed
    await updateTask(task.id, { done: true, status: 'completed' });

    // Next query resolves it
    const activeAfter = await getInterventions('active');
    assert.ok(!activeAfter.some((i) => i.task_id === task.id && i.intervention_type === 'repeated_unfinished'));
  });
});
