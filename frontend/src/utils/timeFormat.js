/**
 * Global time formatting helper for Orbit.
 * Displays times in 12-hour format with AM/PM across the app.
 * Handles missing values, ISO timestamps, HH:MM strings, midnight, and noon.
 */

export function formatTime12(val) {
  if (!val) return '';

  // If val is a Date object
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    let hours = val.getHours();
    const minutes = val.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 becomes 12 (midnight)
    const mStr = String(minutes).padStart(2, '0');
    return `${hours}:${mStr} ${ampm}`;
  }

  const str = String(val).trim();
  if (!str) return '';

  // Check if it's an ISO timestamp or date string containing 'T' or '-'
  if (str.includes('T') || (str.includes('-') && str.length > 10)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      let hours = d.getHours();
      const minutes = d.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // midnight is 12 AM
      const mStr = String(minutes).padStart(2, '0');
      return `${hours}:${mStr} ${ampm}`;
    }
  }

  // Check if it's 'HH:MM' or 'HH:MM:SS'
  const match = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  // Fallback attempt to parse with new Date()
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime())) {
    let hours = fallback.getHours();
    const minutes = fallback.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const mStr = String(minutes).padStart(2, '0');
    return `${hours}:${mStr} ${ampm}`;
  }

  return str;
}

export function formatDateTime12(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);

  const datePart = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timePart = formatTime12(d);
  return `${datePart}, ${timePart}`;
}
