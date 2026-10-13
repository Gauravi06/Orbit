import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { findCurrentOrNextBlockIndex, getBlockTimeStatus } from '../src/pages/todayTimeSelection.js';

describe('Today Time Selection Utility', () => {
  const sampleItems = [
    {
      id: 1,
      title: 'Morning Routine & Breakfast',
      start_time: '2026-10-14T07:30:00',
      end_time: '2026-10-14T08:15:00',
    },
    {
      id: 2,
      title: 'Operating Systems Lecture',
      start_time: '2026-10-14T09:00:00',
      end_time: '2026-10-14T11:00:00',
    },
    {
      id: 3,
      title: 'Operating Systems Problem Set (Deep Work)',
      start_time: '2026-10-14T11:30:00',
      end_time: '2026-10-14T13:00:00',
    },
    {
      id: 4,
      title: 'Lunch',
      start_time: '2026-10-14T13:00:00',
      end_time: '2026-10-14T13:45:00',
    },
    {
      id: 5,
      title: 'Wind Down',
      start_time: '2026-10-14T22:30:00',
      end_time: '2026-10-14T23:00:00',
    },
  ];

  test('Gracefully returns 0 for empty or null items', () => {
    assert.equal(findCurrentOrNextBlockIndex([]), 0);
    assert.equal(findCurrentOrNextBlockIndex(null), 0);
  });

  test('Selects the block currently in progress', () => {
    // Current time: 09:30 (inside OS Lecture 09:00 - 11:00)
    const now = new Date('2026-10-14T09:30:00');
    const idx = findCurrentOrNextBlockIndex(sampleItems, now);
    assert.equal(idx, 1);
    assert.equal(sampleItems[idx].title, 'Operating Systems Lecture');
    assert.equal(getBlockTimeStatus(sampleItems[idx], now), 'in_progress');
  });

  test('Selects the next upcoming block if between blocks', () => {
    // Current time: 08:30 (after breakfast at 08:15, before OS lecture at 09:00)
    const now = new Date('2026-10-14T08:30:00');
    const idx = findCurrentOrNextBlockIndex(sampleItems, now);
    assert.equal(idx, 1);
    assert.equal(sampleItems[idx].title, 'Operating Systems Lecture');
    assert.equal(getBlockTimeStatus(sampleItems[idx], now), 'upcoming');
  });

  test('Selects the first block if early in the morning before any block', () => {
    const now = new Date('2026-10-14T06:45:00');
    const idx = findCurrentOrNextBlockIndex(sampleItems, now);
    assert.equal(idx, 0);
    assert.equal(sampleItems[idx].title, 'Morning Routine & Breakfast');
  });

  test('Selects the last block if all scheduled blocks are in the past', () => {
    const now = new Date('2026-10-14T23:45:00');
    const idx = findCurrentOrNextBlockIndex(sampleItems, now);
    assert.equal(idx, sampleItems.length - 1);
    assert.equal(sampleItems[idx].title, 'Wind Down');
    assert.equal(getBlockTimeStatus(sampleItems[idx], now), 'completed_time');
  });
});
