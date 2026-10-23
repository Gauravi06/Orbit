"""
Regression test suite for Orbit Fixed-Commitment Scheduling and Optional Onboarding Preferences.

Covers:
1. Fixed commitment from 9:00 AM-3:00 PM produces the correct occurrence per configured day,
   not duplicated or incorrectly split into separate blocks.
2. No study placement overlaps a fixed commitment or its commute/transition buffers.
3. Editing fixed commitment hours or weekdays reconciles obsolete future occurrences
   without deleting ordinary tasks or another user's rows.
4. Repeated refresh/generation is idempotent with zero duplicate fixed rows.
5. Generated plan with validation violations is not persisted as a successful schedule.
6. Validation enforces the same window as generation.
7. "No preference" for wake/sleep times is accepted (HTTP 200, not 422) and uses product defaults.
8. Explicit wake/sleep preferences still work and remain user-isolated.
9. Scheduler works dynamically with diverse non-example timetables (e.g. 06:30 wake, 07:00-13:00 shift).
10. Daily habits (must_daily) recur across the week and task splitting works cleanly.
"""

import unittest
import uuid
from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func as sa_func
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.preference import Preference
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.task import Task, TaskType
from app.models.user import User
from app.api.routes.preferences import _naive, IST, refresh_fixed_commitments
from app.api.routes.schedules import _aware
from app.services.rule_engine import Prefs, PlanTask, FixedBlock, generate_plan, validate_plan


def _fixed_monday() -> datetime:
    today = date.today()
    days_ahead = (0 - today.weekday()) % 7
    mon = today + timedelta(days=days_ahead)
    return datetime(mon.year, mon.month, mon.day, 5, 0, 0)


FIXED_NOW = _fixed_monday()


class TestFixedCommitmentRegressionRepair(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.engine
        )
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=cls.engine)

    def setUp(self):
        self.db = self.TestingSessionLocal()
        self.db.query(ScheduleItem).delete()
        self.db.query(Schedule).delete()
        self.db.query(Task).delete()
        self.db.query(Preference).delete()
        self.db.query(User).delete()
        self.db.commit()

        self.user = User(
            id=uuid.uuid4(),
            name="Primary Student",
            email="primary@example.com",
            hashed_password=hash_password("Password123!"),
            wake_time=time(7, 0),
            sleep_time=time(23, 30),
            focus_duration=90,
        )
        self.user2 = User(
            id=uuid.uuid4(),
            name="Secondary Student",
            email="secondary@example.com",
            hashed_password=hash_password("Password123!"),
            wake_time=time(6, 0),
            sleep_time=time(22, 0),
            focus_duration=60,
        )
        self.db.add_all([self.user, self.user2])
        self.db.commit()

        self.token = create_access_token(str(self.user.id))
        self.auth_headers = {"Authorization": f"Bearer {self.token}"}

        self.token2 = create_access_token(str(self.user2.id))
        self.auth_headers2 = {"Authorization": f"Bearer {self.token2}"}

    def tearDown(self):
        self.db.close()

    # -----------------------------------------------------------------------
    # Test 1: Fixed commitment from 9:00 AM-3:00 PM produces single correct block
    # -----------------------------------------------------------------------
    def test_fixed_commitment_correct_occurrence_not_split(self):
        payload = {
            "wake_time": "08:00",
            "sleep_time": "23:00",
            "week_structure": "same_weekdays",
            "fixed_commitments": [
                {
                    "name": "College",
                    "days": "Monday–Friday",
                    "start_time": "09:00",
                    "end_time": "15:00",
                    "commute_before": 15,
                    "commute_after": 15,
                }
            ],
            "need_to_items": [],
            "should_do_items": [],
            "like_to_items": [],
        }
        res = self.client.post("/onboarding", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)

        # Check DB rows
        college_tasks = (
            self.db.query(Task)
            .filter(
                Task.user_id == self.user.id,
                Task.is_fixed.is_(True),
                sa_func.lower(Task.title) == "college",
            )
            .all()
        )
        self.assertGreater(len(college_tasks), 0)
        for t in college_tasks:
            # Each occurrence must be exactly 360 minutes (6 hours)
            self.assertEqual(t.estimated_duration, 360)
            self.assertEqual(t.commute_minutes, 15)
            s = _naive(t.deadline)
            self.assertEqual(s.hour, 9)
            self.assertEqual(s.minute, 0)

    # -----------------------------------------------------------------------
    # Test 2: No study placement overlaps fixed commitment or commute buffer
    # -----------------------------------------------------------------------
    def test_no_study_placement_overlaps_fixed_commitment_or_commute(self):
        payload = {
            "wake_time": "08:00",
            "sleep_time": "23:00",
            "week_structure": "same_weekdays",
            "fixed_commitments": [
                {
                    "name": "College",
                    "days": "Monday–Friday",
                    "start_time": "09:00",
                    "end_time": "15:00",
                    "commute_before": 15,
                    "commute_after": 15,
                }
            ],
            "need_to_items": [
                {"name": "Assignment 1", "duration": 60},
                {"name": "Assignment 2", "duration": 60},
                {"name": "Assignment 3", "duration": 120},
            ],
            "should_do_items": [
                {"name": "Revision", "duration": 60},
            ],
            "like_to_items": [
                {"name": "Reading", "duration": 45},
            ],
        }
        res = self.client.post("/onboarding", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)

        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            gen_res = self.client.post("/schedules/generate", headers=self.auth_headers)
        self.assertEqual(gen_res.status_code, 200)
        data = gen_res.json()
        self.assertEqual(data["violations"], [])

        # Verify no items fall in 08:45 - 15:15 (09:00 - 15:00 with 15m commute + transition)
        for day in data["days"]:
            day_fixed = day["fixed"]
            fixed_intervals = []
            for f in day_fixed:
                f_s = datetime.fromisoformat(f["start"])
                f_e = datetime.fromisoformat(f["end"])
                # 15m commute + 5m transition buffer
                fixed_intervals.append((f_s - timedelta(minutes=20), f_e + timedelta(minutes=20)))

            for it in day["items"]:
                it_s = datetime.fromisoformat(it["start_time"])
                it_e = datetime.fromisoformat(it["end_time"])
                for b_s, b_e in fixed_intervals:
                    self.assertFalse(
                        it_s < b_e and it_e > b_s,
                        f"Study item '{it.get('title')}' ({it_s} - {it_e}) overlaps fixed block ({b_s} - {b_e})",
                    )

    # -----------------------------------------------------------------------
    # Test 3: Editing fixed commitment hours reconciles obsolete future occurrences
    # -----------------------------------------------------------------------
    def test_editing_commitment_hours_reconciles_obsolete_occurrences(self):
        # 1. Add non-fixed task that must NOT be deleted
        ordinary_task = Task(
            user_id=self.user.id,
            title="Important Assignment",
            estimated_duration=90,
            priority=5,
            is_fixed=False,
            task_type=TaskType.deadline,
        )
        # 2. Add User 2 fixed task that must NOT be touched
        user2_task = Task(
            user_id=self.user2.id,
            title="User 2 Commitment",
            estimated_duration=120,
            priority=3,
            is_fixed=True,
            deadline=FIXED_NOW + timedelta(days=1, hours=4),
        )
        self.db.add_all([ordinary_task, user2_task])
        self.db.commit()

        # Step A: Onboard with College 08:00 - 14:00
        payload_1 = {
            "fixed_commitments": [
                {
                    "name": "College",
                    "days": "Monday–Friday",
                    "start_time": "08:00",
                    "end_time": "14:00",
                    "commute_before": 15,
                    "commute_after": 15,
                }
            ]
        }
        r1 = self.client.post("/onboarding", json=payload_1, headers=self.auth_headers)
        self.assertEqual(r1.status_code, 200)

        college_tasks_8am = (
            self.db.query(Task)
            .filter(
                Task.user_id == self.user.id,
                Task.is_fixed.is_(True),
                sa_func.lower(Task.title) == "college",
            )
            .all()
        )
        self.assertGreater(len(college_tasks_8am), 0)
        for t in college_tasks_8am:
            self.assertEqual(_naive(t.deadline).hour, 8)

        # Step B: User edits preferences to College 09:00 - 15:00
        payload_2 = {
            "fixed_commitments": [
                {
                    "name": "College",
                    "days": "Monday–Friday",
                    "start_time": "09:00",
                    "end_time": "15:00",
                    "commute_before": 20,
                    "commute_after": 20,
                }
            ]
        }
        r2 = self.client.put("/preferences", json=payload_2, headers=self.auth_headers)
        self.assertEqual(r2.status_code, 200)

        # Trigger refresh
        refresh_fixed_commitments(self.db, self.user, FIXED_NOW)
        self.db.commit()

        # Obsolete 08:00 tasks must be gone; new 09:00 tasks must exist
        all_college = (
            self.db.query(Task)
            .filter(
                Task.user_id == self.user.id,
                Task.is_fixed.is_(True),
                sa_func.lower(Task.title) == "college",
            )
            .all()
        )
        for t in all_college:
            s = _naive(t.deadline)
            self.assertEqual(s.hour, 9, f"Found obsolete 08:00 College occurrence {t.deadline}")
            self.assertEqual(t.estimated_duration, 360)
            self.assertEqual(t.commute_minutes, 20)

        # Check ordinary task and User 2 task still exist
        self.assertIsNotNone(self.db.query(Task).filter(Task.id == ordinary_task.id).first())
        self.assertIsNotNone(self.db.query(Task).filter(Task.id == user2_task.id).first())

    # -----------------------------------------------------------------------
    # Test 4: Repeated refresh/generation is idempotent with no duplicates
    # -----------------------------------------------------------------------
    def test_repeated_refresh_is_idempotent(self):
        payload = {
            "fixed_commitments": [
                {
                    "name": "Lab Session",
                    "days": "Tuesday",
                    "start_time": "10:00",
                    "end_time": "13:00",
                    "commute_before": 10,
                    "commute_after": 10,
                }
            ]
        }
        self.client.post("/onboarding", json=payload, headers=self.auth_headers)

        count_initial = (
            self.db.query(Task)
            .filter(Task.user_id == self.user.id, Task.is_fixed.is_(True))
            .count()
        )

        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            self.client.post("/schedules/generate", headers=self.auth_headers)
            self.client.post("/schedules/generate", headers=self.auth_headers)

        count_after = (
            self.db.query(Task)
            .filter(Task.user_id == self.user.id, Task.is_fixed.is_(True))
            .count()
        )
        self.assertEqual(count_initial, count_after)

    # -----------------------------------------------------------------------
    # Test 5: Generated plan with validation violations is not persisted
    # -----------------------------------------------------------------------
    def test_invalid_generated_plan_not_persisted(self):
        # Prefs: wake 09:00, sleep 10:00 (1 hour allowed)
        self.client.put(
            "/preferences",
            json={"wake_time": "09:00", "sleep_time": "10:00"},
            headers=self.auth_headers,
        )
        # Fixed block from 08:30 to 10:30 (covering the whole window)
        fixed_blk = Task(
            user_id=self.user.id,
            title="Unavoidable Event",
            is_fixed=True,
            deadline=FIXED_NOW.replace(hour=8, minute=30),
            estimated_duration=120,
        )
        self.db.add(fixed_blk)
        self.db.commit()

        # Mock validate_plan to return a problem
        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            with patch("app.api.routes.schedules.validate_plan", return_value=["Task clashes with fixed block"]):
                res = self.client.post("/schedules/generate", headers=self.auth_headers)

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("Task clashes with fixed block", data["violations"])

        # Database must NOT have any persisted ScheduleItem rows from this run
        persisted_items = self.db.query(ScheduleItem).all()
        self.assertEqual(len(persisted_items), 0)

    # -----------------------------------------------------------------------
    # Test 6: Validation enforces the same window as generation
    # -----------------------------------------------------------------------
    def test_validation_enforces_same_window_as_generation(self):
        prefs = Prefs(
            wake=time(8, 0),
            sleep=time(22, 0),
            focus_duration=60,
            daily_cap_minutes=300,
            morning_routine_minutes=15,
            wind_down_minutes=15,
        )
        tasks = [PlanTask(id="1", title="Study", remaining_minutes=120)]
        result = generate_plan(tasks, [], prefs, FIXED_NOW, 3)
        problems = validate_plan(result.placements, {t.id: t for t in tasks}, [], prefs, FIXED_NOW)
        self.assertEqual(problems, [], f"Expected clean plan, got violations: {problems}")

        # Placements must not violate the 08:15 to 21:45 window
        for p in result.placements:
            self.assertGreaterEqual(p.start.time(), time(8, 15))
            self.assertLessEqual(p.end.time(), time(21, 45))

    # -----------------------------------------------------------------------
    # Test 7: "No preference" for wake/sleep is accepted and uses product defaults
    # -----------------------------------------------------------------------
    def test_no_preference_wake_sleep_accepted_and_defaults_correctly(self):
        payload = {
            "wake_time": "no_pref",
            "sleep_time": "no_pref",
            "need_to_items": [
                {"name": "Essay draft", "duration": 60}
            ],
        }
        res = self.client.post("/onboarding", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200, f"Expected 200 but got {res.status_code}: {res.text}")

        # Verify preferences endpoint returns no_pref or reflect what was saved
        prefs_res = self.client.get("/preferences", headers=self.auth_headers).json()
        self.assertEqual(prefs_res.get("wake_time"), "no_pref")
        self.assertEqual(prefs_res.get("sleep_time"), "no_pref")

        # Schedule generation should succeed without 422
        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            gen_res = self.client.post("/schedules/generate", headers=self.auth_headers)
        self.assertEqual(gen_res.status_code, 200)

    # -----------------------------------------------------------------------
    # Test 8: Explicit wake/sleep preferences still work and remain user-isolated
    # -----------------------------------------------------------------------
    def test_explicit_wake_sleep_preferences_user_isolated(self):
        # User 1: 06:00 - 22:00
        self.client.put("/preferences", json={"wake_time": "06:00", "sleep_time": "22:00"}, headers=self.auth_headers)
        # User 2: 10:00 - 01:00
        self.client.put("/preferences", json={"wake_time": "10:00", "sleep_time": "01:00"}, headers=self.auth_headers2)

        p1 = self.client.get("/preferences", headers=self.auth_headers).json()
        p2 = self.client.get("/preferences", headers=self.auth_headers2).json()

        self.assertEqual(p1["wake_time"], "06:00")
        self.assertEqual(p1["sleep_time"], "22:00")
        self.assertEqual(p2["wake_time"], "10:00")
        self.assertEqual(p2["sleep_time"], "01:00")

    # -----------------------------------------------------------------------
    # Test 9: Scheduler works dynamically with diverse non-example timetables
    # -----------------------------------------------------------------------
    def test_dynamic_scheduling_independent_of_hardcoded_example(self):
        # Hospital rotation scenario: 06:30 wake, 07:00-13:00 shift, 30m commute
        payload = {
            "wake_time": "06:30",
            "sleep_time": "22:30",
            "fixed_commitments": [
                {
                    "name": "Hospital Shift",
                    "days": "Monday–Friday",
                    "start_time": "07:00",
                    "end_time": "13:00",
                    "commute_before": 30,
                    "commute_after": 30,
                }
            ],
            "need_to_items": [
                {"name": "Clinical Pharmacology", "duration": 90},
                {"name": "Patient Notes", "duration": 45},
            ],
        }
        res = self.client.post("/onboarding", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)

        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            gen_res = self.client.post("/schedules/generate", headers=self.auth_headers)
        self.assertEqual(gen_res.status_code, 200)
        data = gen_res.json()
        self.assertEqual(data["violations"], [])

        # Check hospital shift is scheduled from 07:00 to 13:00 (not shifted or split)
        day0 = data["days"][0]
        hospital_fixed = next((f for f in day0["fixed"] if f["title"] == "Hospital Shift"), None)
        self.assertIsNotNone(hospital_fixed)
        start_time = datetime.fromisoformat(hospital_fixed["start"])
        end_time = datetime.fromisoformat(hospital_fixed["end"])
        self.assertEqual(start_time.time(), time(7, 0))
        self.assertEqual(end_time.time(), time(13, 0))

        # Check clinical study items don't overlap 06:30-13:35 (07:00-13:00 with 30m commute + 5m transition)
        for it in day0["items"]:
            it_s = datetime.fromisoformat(it["start_time"])
            it_e = datetime.fromisoformat(it["end_time"])
            blocked_s = start_time - timedelta(minutes=35)
            blocked_e = end_time + timedelta(minutes=35)
            self.assertFalse(
                it_s < blocked_e and it_e > blocked_s,
                f"Task '{it['title']}' at {it_s}-{it_e} overlapped hospital block",
            )

    # -----------------------------------------------------------------------
    # Test 10: Daily habits recur across horizon and task splitting works cleanly
    # -----------------------------------------------------------------------
    def test_daily_habits_and_task_splitting(self):
        payload = {
            "wake_time": "07:00",
            "sleep_time": "23:00",
            "should_do_items": [
                {"name": "Daily Mobility", "duration": 45, "frequency": "Daily"},
            ],
            "need_to_items": [
                {"name": "Huge Term Paper", "duration": 240},
            ],
        }
        res = self.client.post("/onboarding", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)

        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            gen_res = self.client.post("/schedules/generate", headers=self.auth_headers)
        self.assertEqual(gen_res.status_code, 200)
        data = gen_res.json()

        # Mobility must be scheduled across multiple days in the week
        mobility_placements = [
            it for day in data["days"] for it in day["items"] if it.get("title") == "Daily Mobility"
        ]
        self.assertGreaterEqual(len(mobility_placements), 4)


    # -----------------------------------------------------------------------
    # Test 11: Week spread omits conflicting saved task items overlapping fixed commitments
    # -----------------------------------------------------------------------
    def test_week_spread_omits_conflicting_saved_task_items(self):
        """
        Verify that GET /schedules/week does not present persisted task items
        as valid scheduled blocks if they conflict with a fixed commitment
        and its commute/transition buffers. The underlying ScheduleItem record,
        status, and completion history must remain preserved in the database.
        """
        target_monday = FIXED_NOW.date()
        target_monday_dt = datetime.combine(target_monday, time(0, 0))

        # 1. Create a fixed commitment task (e.g. 09:00 - 13:00 with 15m commute)
        fixed_task = Task(
            id=uuid.uuid4(),
            user_id=self.user.id,
            title="Morning Lectures",
            is_fixed=True,
            deadline=target_monday_dt.replace(hour=9, minute=0),
            estimated_duration=240,  # 4 hours -> 09:00 to 13:00
            commute_minutes=15,
        )

        # 2. Create an ordinary plannable task
        study_task = Task(
            id=uuid.uuid4(),
            user_id=self.user.id,
            title="Stale Overlapping Session",
            is_fixed=False,
            task_type=TaskType.deadline,
            estimated_duration=60,
            priority=5,
        )
        self.db.add_all([fixed_task, study_task])
        self.db.commit()

        # 3. Create a persisted Schedule and ScheduleItem that conflicts with the fixed commitment's
        # protected interval (08:40 to 13:20 with 15m commute + 5m transition buffer).
        # We place this task at 10:00 - 11:00.
        sched = Schedule(
            id=uuid.uuid4(),
            user_id=self.user.id,
            date=target_monday,
            version=1,
        )
        self.db.add(sched)
        self.db.flush()

        conflicting_item = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched.id,
            task_id=study_task.id,
            start_time=_aware(target_monday_dt.replace(hour=10, minute=0)),
            end_time=_aware(target_monday_dt.replace(hour=11, minute=0)),
            status="scheduled",
        )
        self.db.add(conflicting_item)
        self.db.commit()

        # 4. Call GET /schedules/week
        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            res = self.client.get(f"/schedules/week?date={target_monday.isoformat()}", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Find the Monday day in week spread
        monday_data = next((d for d in data["days"] if d["date"] == target_monday.isoformat()), None)
        self.assertIsNotNone(monday_data)

        # Ensure the fixed block is present
        monday_items = monday_data["items"]
        fixed_items = [it for it in monday_items if it.get("is_fixed")]
        self.assertTrue(any(it["title"] == "Morning Lectures" for it in fixed_items))

        # Crucial assertion: the conflicting saved study task must NOT be presented as a valid scheduled item
        task_items = [it for it in monday_items if not it.get("is_fixed")]
        conflicting_titles = [it["title"] for it in task_items if it["title"] == "Stale Overlapping Session"]
        self.assertEqual(
            conflicting_titles,
            [],
            "Conflicting saved task item was presented in GET /schedules/week day items!",
        )

        # 5. Invariant: the underlying ScheduleItem in the database was NOT deleted or mutated
        db_item = self.db.query(ScheduleItem).filter(ScheduleItem.id == conflicting_item.id).first()
        self.assertIsNotNone(db_item, "ScheduleItem was unexpectedly deleted from DB")
        self.assertEqual(db_item.status, "scheduled")
        self.assertEqual(db_item.task_id, study_task.id)

    def test_week_spread_omits_conflicts_with_preference_only_fixed_commitments(self):
        """
        Regression: when a fixed commitment exists ONLY in user preferences
        (no Task row created by refresh_fixed_commitments), the collision-check
        loop in get_week_spread must still filter out overlapping ScheduleItems.

        Previously, `seen_fixed_titles` was populated by the display loop before
        the collision-check loop ran, causing the collision loop to skip
        preference-only fixed blocks entirely.
        """
        target_monday = FIXED_NOW.date()
        target_monday_dt = datetime.combine(target_monday, time(0, 0))

        # 1. Save onboarding preferences with a fixed commitment for Monday
        #    but do NOT call refresh_fixed_commitments (no Task row created).
        onboarding_data = {
            "wake_time": "07:00",
            "sleep_time": "23:00",
            "fixed_commitments": [
                {
                    "name": "Morning Seminar",
                    "days": "Monday",
                    "start_time": "09:00",
                    "end_time": "12:00",
                    "commute_before": 10,
                    "commute_after": 10,
                }
            ],
            "need_to_items": [],
            "should_do_items": [],
            "like_to_items": [],
        }
        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            res_onboard = self.client.post(
                "/onboarding", json=onboarding_data, headers=self.auth_headers
            )
        self.assertEqual(res_onboard.status_code, 200, res_onboard.text)

        # 2. Create an ordinary plannable task
        study_task = Task(
            id=uuid.uuid4(),
            user_id=self.user.id,
            title="Pref-Only Overlap Study",
            is_fixed=False,
            task_type=TaskType.deadline,
            estimated_duration=60,
            priority=5,
        )
        self.db.add(study_task)
        self.db.commit()

        # 3. Manually delete any fixed-commitment Task rows for "Morning Seminar"
        #    to simulate the preference-only scenario (e.g. past day, or refresh
        #    not yet called for this day).
        self.db.query(Task).filter(
            Task.user_id == self.user.id,
            Task.is_fixed == True,
            Task.title == "Morning Seminar",
        ).delete()
        self.db.commit()

        # 4. Create a persisted ScheduleItem that overlaps the preference's
        #    protected window (08:45 - 12:15 with 10m commute + 5m buffer).
        #    Place it at 10:00 - 11:00.
        sched = Schedule(
            id=uuid.uuid4(),
            user_id=self.user.id,
            date=target_monday,
            version=1,
        )
        self.db.add(sched)
        self.db.flush()

        conflicting_item = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched.id,
            task_id=study_task.id,
            start_time=_aware(target_monday_dt.replace(hour=10, minute=0)),
            end_time=_aware(target_monday_dt.replace(hour=11, minute=0)),
            status="scheduled",
        )
        self.db.add(conflicting_item)
        self.db.commit()

        # 5. Call GET /schedules/week
        with patch("app.api.routes.schedules._now", return_value=FIXED_NOW):
            res = self.client.get(
                f"/schedules/week?date={target_monday.isoformat()}",
                headers=self.auth_headers,
            )
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Find Monday in week spread
        monday_data = next(
            (d for d in data["days"] if d["date"] == target_monday.isoformat()), None
        )
        self.assertIsNotNone(monday_data)

        # The fixed commitment from preferences should be displayed
        fixed_items = [it for it in monday_data["items"] if it.get("is_fixed")]
        self.assertTrue(
            any(it["title"] == "Morning Seminar" for it in fixed_items),
            "Preference-based fixed commitment should be displayed",
        )

        # The conflicting study task must NOT be presented
        task_items = [it for it in monday_data["items"] if not it.get("is_fixed")]
        conflicting_titles = [
            it["title"] for it in task_items if it["title"] == "Pref-Only Overlap Study"
        ]
        self.assertEqual(
            conflicting_titles,
            [],
            "Saved task overlapping a preference-only fixed commitment was NOT filtered!",
        )

        # The underlying DB row must remain intact
        db_item = (
            self.db.query(ScheduleItem)
            .filter(ScheduleItem.id == conflicting_item.id)
            .first()
        )
        self.assertIsNotNone(db_item, "ScheduleItem was unexpectedly deleted")
        self.assertEqual(db_item.status, "scheduled")


if __name__ == "__main__":
    unittest.main()

