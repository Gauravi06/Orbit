"""
Thin rule engine for the Orbit demo. Pure Python: no database, no LLM.

It owns the hard constraints:
  - nothing outside the wake/sleep window (and any "no study after X" limit)
  - nothing overlapping a fixed commitment (plus commute + 5 min buffer)
  - nothing overlapping another placed block
  - nothing past a task's deadline, nothing in the past
  - a per-day load cap, so a rough day can be made lighter

generate_plan() builds a plan. validate_plan() checks ANY plan, including
one proposed by Gemini. LLM proposes, rules dispose.

All datetimes here are naive local time (IST). Convert timezone-aware
values from the database before calling in.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional, Tuple

TRANSITION_BUFFER = timedelta(minutes=5)
MIN_CHUNK_FLOOR = 20  # minutes


@dataclass
class FixedBlock:
    title: str
    start: datetime
    end: datetime
    commute_minutes: int = 0


@dataclass
class PlanTask:
    id: str
    title: str
    remaining_minutes: int
    priority: int = 3                      # 1-5
    deadline: Optional[datetime] = None
    must_daily: bool = False


@dataclass
class Prefs:
    wake: time = time(7, 0)
    sleep: time = time(0, 0)               # midnight
    focus_duration: int = 120              # minutes, longest single chunk
    allow_splitting: bool = True
    no_study_after: Optional[time] = None  # hard limit for the demo
    daily_cap_minutes: int = 480
    morning_routine_minutes: int = 0       # morning routine / wake buffer
    wind_down_minutes: int = 0             # wind-down before bedtime


@dataclass
class Placement:
    task_id: str
    title: str
    start: datetime
    end: datetime


@dataclass
class PlanResult:
    placements: List[Placement] = field(default_factory=list)
    at_risk: Dict[str, int] = field(default_factory=dict)  # task_id -> minutes not placed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mins(delta: timedelta) -> int:
    return int(delta.total_seconds() // 60)


def _ceil5(dt: datetime) -> datetime:
    dt = dt.replace(second=0, microsecond=0)
    return dt + timedelta(minutes=(-dt.minute) % 5)


def _window(day: date, prefs: Prefs) -> Tuple[datetime, datetime]:
    m_buf = getattr(prefs, "morning_routine_minutes", 0) or 0
    w_buf = getattr(prefs, "wind_down_minutes", 0) or 0
    start = datetime.combine(day, prefs.wake) + timedelta(minutes=m_buf)
    end = datetime.combine(day, prefs.sleep) - timedelta(minutes=w_buf)
    if end <= start:                        # sleep is after midnight
        end = datetime.combine(day + timedelta(days=1), prefs.sleep) - timedelta(minutes=w_buf)
    if prefs.no_study_after is not None:
        end = min(end, datetime.combine(day, prefs.no_study_after))
    return start, end


def _subtract(free, s: datetime, e: datetime):
    out = []
    for a, b in free:
        if e <= a or s >= b:
            out.append((a, b))
        else:
            if a < s:
                out.append((a, s))
            if e < b:
                out.append((e, b))
    return out


def _pad(block: FixedBlock) -> timedelta:
    return timedelta(minutes=block.commute_minutes) + TRANSITION_BUFFER


def _free_for_day(day: date, prefs: Prefs, fixed: List[FixedBlock], now: datetime):
    a, b = _window(day, prefs)
    if now.date() == day:
        a = max(a, _ceil5(now))
    free = [(a, b)] if a < b else []
    for blk in fixed:
        pad = _pad(blk)
        blk_start = blk.start - pad
        blk_end = blk.end + pad
        if blk_start < b and blk_end > a:
            free = _subtract(free, blk_start, blk_end)
    return free


def urgency(task: PlanTask, today: date) -> int:
    """priority (1-5) * 10 gives 10-50. Deadline buckets: today 40,
    tomorrow 20, this week 10, later 0."""
    score = 10 * task.priority
    if task.deadline is not None:
        days = (task.deadline.date() - today).days
        if days <= 0:
            score += 40
        elif days == 1:
            score += 20
        elif days <= 6:
            score += 10
    return score


def _best_slot(free, want: int, need: int, deadline: Optional[datetime]):
    """Prefer the first gap that fits the whole wanted chunk (deep work).
    Otherwise use the longest gap that still meets the minimum chunk."""
    best = None
    for a, b in free:
        if deadline is not None:
            b = min(b, deadline)
        length = _mins(b - a)
        if length < need:
            continue
        if length >= want:
            return a, b
        if best is None or length > best[2]:
            best = (a, b, length)
    return (best[0], best[1]) if best else None


# ---------------------------------------------------------------------------
# Plan generation
# ---------------------------------------------------------------------------

def generate_plan(
    tasks: List[PlanTask],
    fixed: List[FixedBlock],
    prefs: Prefs,
    now: datetime,
    horizon_days: int = 7,
    day_caps: Optional[Dict[date, int]] = None,
) -> PlanResult:
    day_caps = day_caps or {}
    today = now.date()
    days = [today + timedelta(days=i) for i in range(horizon_days + 1)]
    free = {d: _free_for_day(d, prefs, fixed, now) for d in days}
    used = {d: 0 for d in days}

    min_chunk = max(MIN_CHUNK_FLOOR, prefs.focus_duration // 3)
    result = PlanResult()

    # Pre-calculate fixed commitment load on each day to adjust sustainable daily cap
    day_effective_caps = {}
    for d in days:
        base_cap = day_caps.get(d, prefs.daily_cap_minutes)
        w_start, w_end = _window(d, prefs)
        w_total = max(0, _mins(w_end - w_start))
        fixed_mins = 0
        for blk in fixed:
            pad = _pad(blk)
            b_s = max(w_start, blk.start - pad)
            b_e = min(w_end, blk.end + pad)
            if b_e > b_s:
                fixed_mins += _mins(b_e - b_s)
        # Protect buffer against heavy fixed commitments (>= 180 mins)
        if fixed_mins >= 180:
            sustainable_margin = max(60, w_total - fixed_mins - 60)
            day_effective_caps[d] = min(base_cap, sustainable_margin)
        else:
            day_effective_caps[d] = base_cap

    # 1. Schedule must_daily tasks across each day
    daily_tasks = [t for t in tasks if getattr(t, "must_daily", False)]
    for task in daily_tasks:
        for day in days:
            cap = day_effective_caps[day]
            cap_left = cap - used[day]
            if cap_left < MIN_CHUNK_FLOOR:
                continue
            dur = min(task.remaining_minutes, cap_left, prefs.focus_duration)
            if dur < min_chunk and dur < task.remaining_minutes:
                continue
            slot = _best_slot(free[day], dur, min(min_chunk, dur), None)
            if slot is not None:
                a, b = slot
                chunk = min(dur, _mins(b - a))
                if chunk >= MIN_CHUNK_FLOOR or chunk == dur:
                    end = a + timedelta(minutes=chunk)
                    result.placements.append(Placement(task.id, task.title, a, end))
                    free[day] = _subtract(free[day], a, end + TRANSITION_BUFFER)
                    used[day] += chunk

    # 2. Schedule non-daily tasks paced across days
    non_daily_tasks = [t for t in tasks if not getattr(t, "must_daily", False)]
    ordered = sorted(
        non_daily_tasks,
        key=lambda t: (-urgency(t, today), t.deadline or datetime.max),
    )

    for task in ordered:
        remaining = task.remaining_minutes
        last_day = task.deadline.date() if task.deadline else days[-1]
        last_day = min(last_day, days[-1])

        for day in days:
            if day > last_day or remaining <= 0:
                break
            cap = day_effective_caps[day]

            while remaining > 0:
                cap_left = cap - used[day]
                if cap_left <= 0:
                    break

                is_deadline_day = (day == last_day)

                if prefs.allow_splitting:
                    need = min(min_chunk, remaining)
                    max_today = remaining if is_deadline_day else min(remaining, prefs.focus_duration)
                    want = min(max_today, prefs.focus_duration, cap_left)
                else:
                    need = remaining
                    want = min(remaining, cap_left)

                if cap_left <= 0 or need > cap_left or want < need:
                    break

                slot = _best_slot(free[day], want, need, task.deadline)
                if slot is None:
                    break
                a, b = slot
                length = _mins(b - a)
                chunk = min(want, length)

                # Avoid leaving a tiny leftover fragment behind
                left = remaining - chunk
                if prefs.allow_splitting and 0 < left < min_chunk:
                    if length >= remaining and cap_left >= remaining and (is_deadline_day or remaining <= prefs.focus_duration):
                        chunk = remaining
                    elif chunk - (min_chunk - left) >= need:
                        chunk = chunk - (min_chunk - left)

                end = a + timedelta(minutes=chunk)
                result.placements.append(Placement(task.id, task.title, a, end))
                free[day] = _subtract(free[day], a, end + TRANSITION_BUFFER)
                used[day] += chunk
                remaining -= chunk

                # If this is not the deadline day, pace by moving to next day after placing a session
                if not is_deadline_day:
                    break

        if remaining > 0:
            result.at_risk[task.id] = remaining

    result.placements.sort(key=lambda p: p.start)
    return result


# ---------------------------------------------------------------------------
# Validation (used on anything Gemini proposes)
# ---------------------------------------------------------------------------

def validate_plan(
    placements: List[Placement],
    tasks_by_id: Dict[str, PlanTask],
    fixed: List[FixedBlock],
    prefs: Prefs,
    now: datetime,
) -> List[str]:
    problems: List[str] = []
    ordered = sorted(placements, key=lambda p: p.start)

    for i, p in enumerate(ordered):
        label = f"'{p.title}' {p.start:%a %H:%M}-{p.end:%H:%M}"
        if p.end <= p.start:
            problems.append(f"{label}: end is not after start")
            continue
        if p.start < now.replace(second=0, microsecond=0):
            problems.append(f"{label}: is in the past")
        a, b = _window(p.start.date(), prefs)
        if p.start < a or p.end > b:
            problems.append(f"{label}: outside allowed hours")
        for blk in fixed:
            pad = _pad(blk)
            if p.start < blk.end + pad and p.end > blk.start - pad:
                problems.append(f"{label}: clashes with {blk.title}")
        t = tasks_by_id.get(p.task_id)
        if t is not None and t.deadline is not None and p.end > t.deadline:
            problems.append(f"{label}: ends after the deadline")
        if i > 0 and p.start < ordered[i - 1].end:
            problems.append(f"{label}: overlaps another block")
    return problems


# ---------------------------------------------------------------------------
# Quick demo check: python -m app.services.rule_engine
# ---------------------------------------------------------------------------

def _show(title: str, result: PlanResult):
    print(f"\n=== {title} ===")
    for p in result.placements:
        mins = _mins(p.end - p.start)
        print(f"  {p.start:%a %d %b}  {p.start:%H:%M}-{p.end:%H:%M}  ({mins:>3} min)  {p.title}")
    for tid, m in result.at_risk.items():
        print(f"  AT RISK: {tid} is short by {m} min")


if __name__ == "__main__":
    now = datetime(2026, 9, 30, 7, 0)
    fixed: List[FixedBlock] = []
    for i in range(3):
        d = date(2026, 9, 30) + timedelta(days=i)
        fixed.append(FixedBlock("Classes", datetime.combine(d, time(9)), datetime.combine(d, time(16)), 20))
        fixed.append(FixedBlock("Gym", datetime.combine(d, time(18)), datetime.combine(d, time(19)), 10))

    prefs = Prefs(wake=time(7), sleep=time(0), focus_duration=120)
    tasks = [
        PlanTask("dsa", "DSA practice", 120, priority=3),
        PlanTask("dbms", "DBMS assignment", 180, priority=4, deadline=datetime(2026, 10, 2, 18, 0)),
    ]

    plan1 = generate_plan(tasks, fixed, prefs, now)
    _show("Initial plan", plan1)
    print("Violations:", validate_plan(plan1.placements, {t.id: t for t in tasks}, fixed, prefs, now))

    tasks.append(PlanTask("os", "OS practical prep", 120, priority=5, deadline=datetime(2026, 10, 1, 9, 0)))
    plan2 = generate_plan(tasks, fixed, prefs, now)
    _show("After: 'OS practical tomorrow'", plan2)
    print("Violations:", validate_plan(plan2.placements, {t.id: t for t in tasks}, fixed, prefs, now))