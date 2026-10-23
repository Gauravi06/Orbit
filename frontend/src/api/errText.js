/**
 * Formats a thrown error into a user-readable string.
 * No React or browser dependencies — safe to import in Node test runner.
 *
 * Priority order:
 *  1. detail string from axios response (FastAPI validation detail)
 *  2. detail array from axios response (Pydantic validation errors)
 *  3. e.message for plain Error objects or network errors
 *  4. Generic fallback
 */
export function errText(e) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join(' | ');
  if (typeof e === 'object' && e.response?.data?.detail) return String(e.response.data.detail);
  if (typeof e?.message === 'string' && !e?.response) return e.message;
  return 'Something went wrong saving your profile. Please try again.';
}
