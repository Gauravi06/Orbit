/**
 * Pure helper functions for the Onboarding summary step.
 * No React dependencies — importable by both the component and Node test runner.
 */

/**
 * Returns an array of unique commitment names from a fixed_commitments array.
 * Accepts both `name` and `title` fields for resilience.
 * Returns [] for null/undefined/empty input.
 *
 * @param {Array} fixed_commitments
 * @returns {string[]}
 */
export function getUniqueAnchors(fixed_commitments) {
  if (!fixed_commitments || fixed_commitments.length === 0) return [];
  return [
    ...new Set(
      fixed_commitments
        .map((c) => c.name || c.title || '')
        .filter(Boolean)
    ),
  ];
}

/**
 * Returns a human-readable label for the user's focus style preference.
 * Falls back to 'balanced' for unknown or missing values.
 *
 * @param {string} focus_style
 * @returns {string}
 */
export function getFocusLabel(focus_style) {
  const map = {
    short: 'short burst',
    medium: 'medium',
    long: 'long deep-work',
    depends: 'task-dependent',
    no_pref: 'balanced',
  };
  return map[focus_style] ?? 'balanced';
}
