import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskSemantics, parseDeadline, extractCleanTitle } from '../src/api/semanticParser.js';

describe('Quick Add Natural-Language Task Parsing', () => {
  const regressionInput = 'assignment 2 due on oct 29. needs 60 mins to complete Need To';

  test('extractCleanTitle extracts title without deadline, duration, or tier clauses', () => {
    const title = extractCleanTitle(regressionInput);
    assert.equal(title, 'assignment 2');
  });

  test('parseDeadline parses explicit calendar deadline without shifting day', () => {
    const refDate = new Date('2026-10-23T09:00:00');
    const deadline = parseDeadline(regressionInput, refDate);
    assert.ok(deadline);
    assert.equal(deadline, '2026-10-29T23:59:00');

    // Verify local date display is exactly October 29
    const d = new Date(deadline);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9); // 0-indexed: 9 is October
    assert.equal(d.getDate(), 29);
  });

  test('parseTaskSemantics parses regression input into separate structured fields', () => {
    const refDate = new Date('2026-10-23T09:00:00');
    const parsed = parseTaskSemantics(regressionInput, { refDate });

    // 1. Title is extracted properly
    assert.equal(parsed.title, 'assignment 2');
    assert.equal(parsed.clean_title, 'assignment 2');

    // 2. Deadline is extracted as Oct 29, 2026 without day shifting
    assert.equal(parsed.deadline, '2026-10-29T23:59:00');

    // 3. Estimated duration is 60 minutes
    assert.equal(parsed.estimated_duration, 60);

    // 4. Priority and tier match Need To
    assert.equal(parsed.tier, 'have_to');
    assert.equal(parsed.priority, 5);
  });

  test('handles variations in date formats and clauses', () => {
    const refDate = new Date('2026-10-23T09:00:00');

    // "CS101 Problem Set due october 29th 90 mins high priority"
    const parsed1 = parseTaskSemantics('CS101 Problem Set due october 29th 90 mins high priority', { refDate });
    assert.equal(parsed1.title, 'CS101 Problem Set');
    assert.equal(parsed1.deadline, '2026-10-29T23:59:00');
    assert.equal(parsed1.estimated_duration, 90);
    assert.equal(parsed1.tier, 'have_to');

    // "Math Homework by 15th of nov 2 hours Should Do"
    const parsed2 = parseTaskSemantics('Math Homework by 15th of nov 2 hours Should Do', { refDate });
    assert.equal(parsed2.title, 'Math Homework');
    assert.equal(parsed2.deadline, '2026-11-15T23:59:00');
    assert.equal(parsed2.estimated_duration, 120);
    assert.equal(parsed2.tier, 'need_to');
  });
});
