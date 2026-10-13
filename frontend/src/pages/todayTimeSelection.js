/**
 * Utility to pick the active or next upcoming block index in a schedule items list.
 * Based on current local date and time.
 *
 * Rules:
 * - If items is empty or invalid, return 0.
 * - Current block in progress: item.start_time <= now < item.end_time.
 *   If multiple overlap, the first one matching in chronological list is picked.
 * - Otherwise, first upcoming block: item.start_time > now.
 * - If all blocks are in the past:
 *   Return the last block index (index = items.length - 1).
 *   (Unless user has unwound, but this ensures a meaningful front card).
 */
export function findCurrentOrNextBlockIndex(items, now = new Date()) {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  // 1. In progress
  const inProgressIndex = items.findIndex((item) => {
    if (!item.start_time || !item.end_time) return false;
    const startMs = new Date(item.start_time).getTime();
    const endMs = new Date(item.end_time).getTime();
    return nowMs >= startMs && nowMs < endMs;
  });

  if (inProgressIndex !== -1) {
    return inProgressIndex;
  }

  // 2. Next upcoming block
  const nextUpcomingIndex = items.findIndex((item) => {
    if (!item.start_time) return false;
    const startMs = new Date(item.start_time).getTime();
    return startMs > nowMs;
  });

  if (nextUpcomingIndex !== -1) {
    return nextUpcomingIndex;
  }

  // 3. If all blocks are completed or in the past today
  return items.length - 1;
}

/**
 * Returns a human-friendly status label for a block based on current time.
 */
export function getBlockTimeStatus(item, now = new Date()) {
  if (!item || !item.start_time || !item.end_time) return 'scheduled';
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startMs = new Date(item.start_time).getTime();
  const endMs = new Date(item.end_time).getTime();

  if (nowMs >= startMs && nowMs < endMs) return 'in_progress';
  if (nowMs >= endMs) return 'completed_time';
  return 'upcoming';
}
