import unittest
from datetime import date, datetime, time, timedelta

from app.services.rule_engine import (
    TRANSITION_BUFFER,
    FixedBlock,
    PlanTask,
    Prefs,
    generate_plan,
    urgency,
    validate_plan,
)


class TestRuleEngineReliability(unittest.TestCase):
    def setUp(self):
        self.today = date(2026, 10, 12)
        self.now = datetime(2026, 10, 12, 7, 0)
        self.prefs = Prefs(
            wake=time(7, 0),
            sleep=time(23, 0),
            focus_duration=120,
            allow_splitting=True,
            daily_cap_minutes=480,
        )

    def test_wake_sleep_boundaries(self):
        """No task may be placed outside wake/sleep window."""
        tasks = [PlanTask("t1", "Study", 120, priority=3)]
        plan = generate_plan(tasks, [], self.prefs, self.now, horizon_days=1)
        self.assertEqual(len(plan.placements), 1)
        p = plan.placements[0]
        self.assertGreaterEqual(p.start, datetime.combine(self.today, time(7, 0)))
        self.assertLessEqual(p.end, datetime.combine(self.today, time(23, 0)))

        # Also validate_plan reports no errors
        violations = validate_plan(plan.placements, {"t1": tasks[0]}, [], self.prefs, self.now)
        self.assertEqual(violations, [])

    def test_no_study_after_cutoff(self):
        """Hard cutoff like 'no study after 20:00' is strictly respected."""
        prefs = Prefs(
            wake=time(7, 0),
            sleep=time(23, 0),
            focus_duration=120,
            no_study_after=time(20, 0),
            daily_cap_minutes=480,
        )
        tasks = [PlanTask("t1", "Study Late", 300, priority=3)]
        fixed = [FixedBlock("Classes", datetime(2026, 10, 12, 9, 0), datetime(2026, 10, 12, 18, 0))]
        plan = generate_plan(tasks, fixed, prefs, self.now, horizon_days=1)
        for p in plan.placements:
            self.assertLessEqual(p.end, datetime.combine(p.start.date(), time(20, 0)))
        violations = validate_plan(plan.placements, {"t1": tasks[0]}, fixed, prefs, self.now)
        self.assertEqual(violations, [])

    def test_fixed_commitments_and_commute_buffers(self):
        """Fixed commitments must be padded with commute + 5 min transition buffer."""
        # Fixed block from 10:00 to 12:00 with 15 min commute.
        # Pad is 15 min + 5 min = 20 min on both sides:
        # Buffer window is 09:40 to 12:20.
        fixed = [FixedBlock("Lecture", datetime(2026, 10, 12, 10, 0), datetime(2026, 10, 12, 12, 0), commute_minutes=15)]
        tasks = [
            PlanTask("t1", "Prep", 60, priority=4),
            PlanTask("t2", "Post", 60, priority=4),
        ]
        plan = generate_plan(tasks, fixed, self.prefs, self.now, horizon_days=0)
        for p in plan.placements:
            # Must not overlap (09:40, 12:20)
            self.assertTrue(
                p.end <= datetime(2026, 10, 12, 9, 40) or p.start >= datetime(2026, 10, 12, 12, 20),
                f"Placement {p} violated commute buffer (09:40 - 12:20)",
            )
        violations = validate_plan(plan.placements, {t.id: t for t in tasks}, fixed, self.prefs, self.now)
        self.assertEqual(violations, [])

    def test_no_overlapping_placements(self):
        """Placed tasks must not overlap each other, and maintain transition buffers."""
        tasks = [
            PlanTask("t1", "DSA 1", 120, priority=3),
            PlanTask("t2", "DSA 2", 120, priority=3),
            PlanTask("t3", "DSA 3", 120, priority=3),
        ]
        plan = generate_plan(tasks, [], self.prefs, self.now, horizon_days=0)
        placements = plan.placements
        self.assertEqual(len(placements), 3)
        for i in range(1, len(placements)):
            prev = placements[i - 1]
            curr = placements[i]
            self.assertGreaterEqual(curr.start, prev.end + TRANSITION_BUFFER)
        violations = validate_plan(placements, {t.id: t for t in tasks}, [], self.prefs, self.now)
        self.assertEqual(violations, [])

    def test_daily_limits_load_caps(self):
        """Daily load caps cannot be exceeded; excess moves to next available day."""
        # 120 min cap for day 1
        day_caps = {self.today: 120}
        tasks = [
            PlanTask("t1", "Big Assignment", 240, priority=3),
        ]
        plan = generate_plan(tasks, [], self.prefs, self.now, horizon_days=2, day_caps=day_caps)
        day1_placements = [p for p in plan.placements if p.start.date() == self.today]
        day2_placements = [p for p in plan.placements if p.start.date() == self.today + timedelta(days=1)]

        day1_mins = sum(int((p.end - p.start).total_seconds() // 60) for p in day1_placements)
        self.assertLessEqual(day1_mins, 120)
        self.assertGreater(len(day2_placements), 0)

    def test_deadline_and_at_risk_behavior(self):
        """Tasks cannot be scheduled past deadline, and unplaced work is marked at_risk."""
        # Deadline at 10:00 today. Free time starts at 7:00, so max 3 hours (180 mins).
        # Task requires 300 minutes.
        deadline = datetime(2026, 10, 12, 10, 0)
        tasks = [
            PlanTask("t1", "Urgent Submission", 300, priority=5, deadline=deadline),
        ]
        plan = generate_plan(tasks, [], self.prefs, self.now, horizon_days=1)
        for p in plan.placements:
            self.assertLessEqual(p.end, deadline)
        self.assertIn("t1", plan.at_risk)
        self.assertGreater(plan.at_risk["t1"], 0)
        violations = validate_plan(plan.placements, {"t1": tasks[0]}, [], self.prefs, self.now)
        self.assertEqual(violations, [])

    def test_urgency_ordering(self):
        """Higher priority and nearer deadlines have higher urgency score."""
        t_high = PlanTask("t1", "Urgent Exam", 60, priority=5, deadline=datetime(2026, 10, 12, 18, 0))
        t_low = PlanTask("t2", "Casual Reading", 60, priority=2)
        self.assertGreater(urgency(t_high, self.today), urgency(t_low, self.today))

    def test_disallowing_splitting(self):
        """When allow_splitting=False, task cannot be cut into chunks."""
        prefs = Prefs(
            wake=time(7, 0),
            sleep=time(23, 0),
            focus_duration=120,
            allow_splitting=False,
            daily_cap_minutes=480,
        )
        tasks = [PlanTask("t1", "Unbreakable Task", 120, priority=3)]
        # Add a fixed block that leaves only a 60 min gap from 7:00-8:00 and 120+ min gap after 10:00
        fixed = [FixedBlock("Block", datetime(2026, 10, 12, 8, 5), datetime(2026, 10, 12, 10, 0))]
        plan = generate_plan(tasks, fixed, prefs, self.now, horizon_days=0)
        self.assertEqual(len(plan.placements), 1)
        p = plan.placements[0]
        # Should NOT be placed in the 60 min slot before 8:05
        self.assertGreaterEqual(p.start, datetime(2026, 10, 12, 10, 0))
        mins = int((p.end - p.start).total_seconds() // 60)
        self.assertEqual(mins, 120)


if __name__ == "__main__":
    unittest.main()
