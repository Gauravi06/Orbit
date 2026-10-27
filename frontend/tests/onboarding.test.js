import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { getUniqueAnchors, getFocusLabel } from '../src/pages/onboardingHelpers.js';
import { errText } from '../src/api/errText.js';

// ---------------------------------------------------------------------------
// Helper: simulate handleFinish try/catch/finally logic without React.
// Uses the shared errText helper from client.js — same function the component
// uses, so tests stay in sync with the real error-formatting path.
// ---------------------------------------------------------------------------
async function simulateHandleFinish(saveOnboarding, generateSchedule, navigate) {
  let finishError = null;
  let loading;

  try {
    await saveOnboarding();
    await generateSchedule();
    navigate('/today');
  } catch (err) {
    finishError = errText(err);
  } finally {
    loading = false;
  }

  return { finishError, loading };
}

// ---------------------------------------------------------------------------
// Onboarding helper unit tests
// ---------------------------------------------------------------------------

describe('getUniqueAnchors', () => {
  test('returns empty array for empty fixed_commitments', () => {
    assert.deepEqual(getUniqueAnchors([]), []);
  });

  test('returns empty array for null fixed_commitments', () => {
    assert.deepEqual(getUniqueAnchors(null), []);
  });

  test('returns empty array for undefined fixed_commitments', () => {
    assert.deepEqual(getUniqueAnchors(undefined), []);
  });

  test('returns unique names from fixed_commitments using name field', () => {
    const commitments = [
      { id: '1', name: 'College Lecture' },
      { id: '2', name: 'Gym' },
    ];
    assert.deepEqual(getUniqueAnchors(commitments), ['College Lecture', 'Gym']);
  });

  test('falls back to title field when name is absent', () => {
    const commitments = [{ id: '1', title: 'Work Shift' }];
    assert.deepEqual(getUniqueAnchors(commitments), ['Work Shift']);
  });

  test('deduplicates names that appear more than once', () => {
    const commitments = [
      { id: '1', name: 'College Lecture' },
      { id: '2', name: 'College Lecture' },
      { id: '3', name: 'Gym' },
    ];
    assert.deepEqual(getUniqueAnchors(commitments), ['College Lecture', 'Gym']);
  });

  test('filters out entries with no name or title', () => {
    const commitments = [
      { id: '1', name: '' },
      { id: '2', name: 'Gym' },
      { id: '3' },
    ];
    assert.deepEqual(getUniqueAnchors(commitments), ['Gym']);
  });
});

describe('getFocusLabel', () => {
  test('returns "short burst" for "short"', () => {
    assert.equal(getFocusLabel('short'), 'short burst');
  });

  test('returns "medium" for "medium"', () => {
    assert.equal(getFocusLabel('medium'), 'medium');
  });

  test('returns "long deep-work" for "long"', () => {
    assert.equal(getFocusLabel('long'), 'long deep-work');
  });

  test('returns "task-dependent" for "depends"', () => {
    assert.equal(getFocusLabel('depends'), 'task-dependent');
  });

  test('returns "balanced" for "no_pref"', () => {
    assert.equal(getFocusLabel('no_pref'), 'balanced');
  });

  test('returns "balanced" for unrecognised value', () => {
    assert.equal(getFocusLabel('something_random'), 'balanced');
  });

  test('returns "balanced" for undefined', () => {
    assert.equal(getFocusLabel(undefined), 'balanced');
  });

  test('returns "balanced" for null', () => {
    assert.equal(getFocusLabel(null), 'balanced');
  });

  test('returns "balanced" for empty string', () => {
    assert.equal(getFocusLabel(''), 'balanced');
  });
});

// ---------------------------------------------------------------------------
// errText unit tests — test the shared helper that both the component and
// simulateHandleFinish use for error formatting
// ---------------------------------------------------------------------------

describe('errText error formatting', () => {
  test('returns detail string from axios-style response error', () => {
    const e = { response: { data: { detail: 'Invalid preferences format' } }, message: 'Request failed' };
    assert.equal(errText(e), 'Invalid preferences format');
  });

  test('formats array detail (validation errors) into pipe-separated string', () => {
    const e = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'wake_time'], msg: 'invalid time format' },
            { loc: ['body', 'focus_length'], msg: 'must be positive' },
          ],
        },
      },
    };
    const result = errText(e);
    assert.ok(result.includes('wake_time'), 'Must include first field name');
    assert.ok(result.includes('focus_length'), 'Must include second field name');
    assert.ok(result.includes('|'), 'Must join with pipe separator');
  });

  test('returns e.message for network errors without response', () => {
    const e = { message: 'Network Error' };
    assert.equal(errText(e), 'Network Error');
  });

  test('returns generic message for HTTP errors without detail (e.g. 500 plain-text body)', () => {
    // HTTP error with a response but no detail field — should use generic fallback, not e.message
    const e = { response: { data: {} }, message: 'Request failed with status code 500' };
    assert.match(errText(e), /Something went wrong/);
  });

  test('returns generic message for unknown error shape', () => {
    const result = errText({});
    assert.match(result, /Something went wrong/);
  });
});

// ---------------------------------------------------------------------------
// handleFinish error / success logic tests (pure state machine simulation)
// ---------------------------------------------------------------------------

describe('handleFinish error state logic', () => {
  test('sets finishError and does not navigate when saveOnboarding throws a generic Error', async () => {
    let navigateCalled = false;
    const saveOnboarding = async () => { throw new Error('Network error'); };
    const generateSchedule = async () => {};
    const navigate = () => { navigateCalled = true; };

    const { finishError, loading } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.equal(navigateCalled, false, 'navigate must not be called on error');
    assert.ok(finishError, 'finishError must be set');
    assert.match(finishError, /Network error/, 'finishError must contain the error message');
    assert.equal(loading, false, 'loading must be reset to false in finally');
  });

  test('sets finishError and does not navigate when generateSchedule throws', async () => {
    let navigateCalled = false;
    const saveOnboarding = async () => {};
    const generateSchedule = async () => { throw new Error('Schedule generation failed'); };
    const navigate = () => { navigateCalled = true; };

    const { finishError } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.equal(navigateCalled, false, 'navigate must not be called when generateSchedule fails');
    assert.ok(finishError, 'finishError must be set');
    assert.match(finishError, /Schedule generation failed/);
  });

  test('extracts detail string from axios-style response error', async () => {
    let navigateCalled = false;
    const axiosError = { response: { data: { detail: 'Invalid preferences format' } }, message: 'Request failed' };
    const saveOnboarding = async () => { throw axiosError; };
    const generateSchedule = async () => {};
    const navigate = () => { navigateCalled = true; };

    const { finishError } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.equal(navigateCalled, false);
    assert.equal(finishError, 'Invalid preferences format', 'Must use detail string from response');
  });

  test('formats array detail (validation errors) into pipe-separated string', async () => {
    const validationError = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'wake_time'], msg: 'invalid time format' },
            { loc: ['body', 'focus_length'], msg: 'must be positive' },
          ],
        },
      },
    };
    const saveOnboarding = async () => { throw validationError; };
    const generateSchedule = async () => {};
    const navigate = () => {};

    const { finishError } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.ok(finishError.includes('wake_time'), 'Must include first field name');
    assert.ok(finishError.includes('focus_length'), 'Must include second field name');
    assert.ok(finishError.includes('|'), 'Must join with pipe separator');
  });

  test('navigates to /today only when both saveOnboarding and generateSchedule resolve', async () => {
    const navigatedTo = [];
    const saveOnboarding = async () => {};
    const generateSchedule = async () => {};
    const navigate = (path) => { navigatedTo.push(path); };

    const { finishError, loading } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.deepEqual(navigatedTo, ['/today'], 'Must navigate to /today on success');
    assert.equal(finishError, null, 'finishError must be null on success');
    assert.equal(loading, false, 'loading must be false after completion');
  });

  test('loading is always false after completion regardless of success or failure', async () => {
    const saveOnboarding = async () => { throw new Error('fail'); };
    const generateSchedule = async () => {};
    const navigate = () => {};

    const { loading } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);
    assert.equal(loading, false);
  });

  test('falls back to generic message for unknown error shape', async () => {
    const saveOnboarding = async () => { throw {}; };
    const generateSchedule = async () => {};
    const navigate = () => {};

    const { finishError } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.ok(finishError, 'finishError must be set for unknown error shape');
    assert.match(finishError, /Something went wrong/, 'Must fall back to generic message');
  });

  test('skip-button path: error is captured even when called outside step 12', async () => {
    // The Skip button calls handleFinish from any step.
    // The error should be set regardless — the banner now renders at card level.
    let navigateCalled = false;
    const saveOnboarding = async () => { throw new Error('Backend offline'); };
    const generateSchedule = async () => {};
    const navigate = () => { navigateCalled = true; };

    const { finishError, loading } = await simulateHandleFinish(saveOnboarding, generateSchedule, navigate);

    assert.equal(navigateCalled, false, 'navigate must not be called on skip error');
    assert.ok(finishError, 'finishError must be set even when skip fires on step 1');
    assert.match(finishError, /Backend offline/);
    assert.equal(loading, false, 'loading must always reset');
  });
});
