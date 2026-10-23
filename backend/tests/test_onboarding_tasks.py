"""
Regression tests for the onboarding Task-creation path.

Tests that POST /onboarding with need_to_items, should_do_items, and
like_to_items creates the correct Task rows and that re-submitting the
same payload does not create duplicates (idempotency).
"""

import unittest
import uuid
from datetime import time

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.preference import Preference
from app.models.task import Task
from app.models.user import User


class TestOnboardingTaskCreation(unittest.TestCase):
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
        # Clean slate for each test
        self.db.query(Task).delete()
        self.db.query(Preference).delete()
        self.db.query(User).delete()
        self.db.commit()

        self.user = User(
            id=uuid.uuid4(),
            name="Test Student",
            email="student@example.com",
            hashed_password=hash_password("Password123!"),
            wake_time=time(7, 0),
            sleep_time=time(23, 30),
            focus_duration=90,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

        self.token = create_access_token(str(self.user.id))
        self.auth_headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        self.db.close()

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _post_onboarding(self, payload: dict) -> dict:
        res = self.client.post("/onboarding", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def _get_tasks(self) -> list:
        res = self.client.get("/tasks", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    # -------------------------------------------------------------------------
    # Test cases
    # -------------------------------------------------------------------------

    def test_need_to_item_with_deadline_creates_deadline_task(self):
        """A need_to_item with a deadline date becomes task_type=deadline."""
        self._post_onboarding({
            "wake_time": "07:00",
            "sleep_time": "23:30",
            "need_to_items": [
                {"id": "nt1", "name": "Maths Exam Prep", "deadline": "2027-03-15", "duration": 90},
            ],
        })

        tasks = self._get_tasks()
        maths = next((t for t in tasks if t["title"] == "Maths Exam Prep"), None)
        self.assertIsNotNone(maths, "Maths Exam Prep task must be created")
        self.assertEqual(maths["task_type"], "deadline")
        self.assertEqual(maths["priority"], 5)
        self.assertEqual(maths["estimated_duration"], 90)
        self.assertFalse(maths["is_fixed"])
        # Deadline should be at 23:59 on 2027-03-15
        self.assertIn("2027-03-15", maths["deadline"])
        self.assertIn("23:59", maths["deadline"])

    def test_need_to_item_without_deadline_creates_growth_task(self):
        """A need_to_item without a deadline becomes task_type=growth, priority 5."""
        self._post_onboarding({
            "need_to_items": [
                {"id": "nt2", "name": "Physics Lab Report", "duration": 60},
            ],
        })

        tasks = self._get_tasks()
        physics = next((t for t in tasks if t["title"] == "Physics Lab Report"), None)
        self.assertIsNotNone(physics, "Physics Lab Report task must be created")
        self.assertEqual(physics["task_type"], "growth")
        self.assertEqual(physics["priority"], 5)
        self.assertIsNone(physics["deadline"])

    def test_should_do_item_creates_growth_task_priority_3(self):
        """A should_do_item becomes task_type=growth with priority 3."""
        self._post_onboarding({
            "should_do_items": [
                {"id": "sd1", "name": "Daily Revision", "frequency": "Daily", "duration": 45},
            ],
        })

        tasks = self._get_tasks()
        revision = next((t for t in tasks if t["title"] == "Daily Revision"), None)
        self.assertIsNotNone(revision, "Daily Revision task must be created")
        self.assertEqual(revision["task_type"], "growth")
        self.assertEqual(revision["priority"], 3)
        self.assertEqual(revision["estimated_duration"], 45)

    def test_like_to_item_creates_growth_task_priority_1(self):
        """A like_to_item becomes task_type=growth with priority 1."""
        self._post_onboarding({
            "like_to_items": [
                {"id": "lt1", "name": "Reading Fiction", "frequency": "2-3x a week", "duration": 30},
            ],
        })

        tasks = self._get_tasks()
        reading = next((t for t in tasks if t["title"] == "Reading Fiction"), None)
        self.assertIsNotNone(reading, "Reading Fiction task must be created")
        self.assertEqual(reading["task_type"], "growth")
        self.assertEqual(reading["priority"], 1)

    def test_duration_defaults_to_60_when_absent(self):
        """Items without a duration default to 60 minutes."""
        self._post_onboarding({
            "need_to_items": [
                {"id": "nt3", "name": "Chemistry Quiz"},
            ],
        })

        tasks = self._get_tasks()
        chem = next((t for t in tasks if t["title"] == "Chemistry Quiz"), None)
        self.assertIsNotNone(chem)
        self.assertEqual(chem["estimated_duration"], 60, "Duration should default to 60")

    def test_idempotency_no_duplicate_tasks_on_resubmit(self):
        """Re-submitting the same onboarding payload must not create duplicate tasks."""
        payload = {
            "wake_time": "07:00",
            "need_to_items": [{"id": "nt4", "name": "Duplicate Task", "duration": 60}],
            "should_do_items": [{"id": "sd2", "name": "Duplicate Habit", "duration": 30}],
            "like_to_items": [{"id": "lt2", "name": "Duplicate Hobby", "duration": 20}],
        }

        self._post_onboarding(payload)
        self._post_onboarding(payload)  # Second submission — same data

        tasks = self._get_tasks()
        dup_task_count = sum(1 for t in tasks if t["title"] == "Duplicate Task")
        dup_habit_count = sum(1 for t in tasks if t["title"] == "Duplicate Habit")
        dup_hobby_count = sum(1 for t in tasks if t["title"] == "Duplicate Hobby")

        self.assertEqual(dup_task_count, 1, "Duplicate Task must appear exactly once")
        self.assertEqual(dup_habit_count, 1, "Duplicate Habit must appear exactly once")
        self.assertEqual(dup_hobby_count, 1, "Duplicate Hobby must appear exactly once")

    def test_idempotency_is_case_insensitive(self):
        """Duplicate detection ignores case differences in title."""
        self._post_onboarding({
            "need_to_items": [{"id": "nt5", "name": "Case Insensitive Task", "duration": 60}],
        })
        # Re-submit with title in different case
        self._post_onboarding({
            "need_to_items": [{"id": "nt5b", "name": "case insensitive task", "duration": 60}],
        })

        tasks = self._get_tasks()
        count = sum(
            1 for t in tasks
            if t["title"].lower() == "case insensitive task"
        )
        self.assertEqual(count, 1, "Case-insensitive duplicate must not create a second row")

    def test_all_three_tiers_in_one_request(self):
        """All three tiers in a single onboarding payload each create the right rows."""
        self._post_onboarding({
            "wake_time": "07:00",
            "sleep_time": "23:30",
            "need_to_items": [
                {"id": "nt10", "name": "Final Exam Prep", "deadline": "2027-05-01", "duration": 120},
            ],
            "should_do_items": [
                {"id": "sd10", "name": "Grammar Practice", "frequency": "Daily", "duration": 30},
            ],
            "like_to_items": [
                {"id": "lt10", "name": "Guitar", "frequency": "Weekends", "duration": 60},
            ],
        })

        tasks = self._get_tasks()
        by_title = {t["title"]: t for t in tasks}

        self.assertIn("Final Exam Prep", by_title)
        self.assertEqual(by_title["Final Exam Prep"]["task_type"], "deadline")
        self.assertEqual(by_title["Final Exam Prep"]["priority"], 5)

        self.assertIn("Grammar Practice", by_title)
        self.assertEqual(by_title["Grammar Practice"]["task_type"], "growth")
        self.assertEqual(by_title["Grammar Practice"]["priority"], 3)

        self.assertIn("Guitar", by_title)
        self.assertEqual(by_title["Guitar"]["task_type"], "growth")
        self.assertEqual(by_title["Guitar"]["priority"], 1)

    def test_fixed_commitments_become_fixed_task_rows(self):
        """fixed_commitments MUST become is_fixed=True Task rows (one per occurrence)."""
        self._post_onboarding({
            "fixed_commitments": [
                {
                    "id": "comm1",
                    "name": "College Lectures",
                    "days": "Monday–Friday",
                    "start_time": "09:00",
                    "end_time": "15:00",
                    "commute_before": 30,
                    "commute_after": 20,
                }
            ],
        })

        db = self.TestingSessionLocal()
        try:
            rows = (
                db.query(Task)
                .filter(
                    Task.user_id == self.user.id,
                    Task.is_fixed.is_(True),
                )
                .all()
            )
        finally:
            db.close()

        # Must have created at least one row (depends on how many Mon–Fri
        # fall within today+7 days window; worst case 0 if today is Sunday
        # and the window has no weekdays, but a 7-day window always has 5).
        self.assertGreater(len(rows), 0, "College Lectures must create at_least one is_fixed=True Task row")

        for row in rows:
            self.assertTrue(row.is_fixed, "Row must have is_fixed=True")
            self.assertIsNone(row.task_type, "Fixed task must have task_type=None")
            self.assertEqual(row.title, "College Lectures")

    def test_empty_tiers_create_no_tasks(self):
        """Posting with empty tier arrays must create no task rows."""
        self._post_onboarding({
            "wake_time": "07:00",
            "need_to_items": [],
            "should_do_items": [],
            "like_to_items": [],
        })

        tasks = self._get_tasks()
        self.assertEqual(len(tasks), 0, "No tasks should be created for empty tier arrays")

    def test_idempotency_skips_title_matching_existing_fixed_task(self):
        """If a fixed task already has the same title as a need_to_items entry,
        the idempotency check must skip creation of the non-fixed duplicate."""
        # Manually insert a fixed task with the same title
        fixed_task = Task(
            user_id=self.user.id,
            title="Pre-existing Fixed Block",
            task_type="deadline",
            priority=5,
            estimated_duration=60,
            is_fixed=True,
        )
        self.db.add(fixed_task)
        self.db.commit()

        # Post onboarding with a need_to_item whose title matches
        self._post_onboarding({
            "need_to_items": [
                {"id": "nt_fixed_dup", "name": "Pre-existing Fixed Block", "duration": 45},
            ],
        })

        tasks = self._get_tasks()
        matching = [t for t in tasks if t["title"].lower() == "pre-existing fixed block"]
        self.assertEqual(
            len(matching), 1,
            "Must not create a non-fixed duplicate when a fixed task with the same title exists",
        )


    def test_onboarding_fixed_commitment_is_respected_by_proposal_and_approval(self):
        """Onboarding commitments must block study time through proposal and approval."""
        from datetime import date, datetime, timedelta, timezone
        from unittest.mock import patch

        from app.models.schedule import Schedule
        from app.models.schedule_item import ScheduleItem

        # Keep onboarding occurrence creation and scheduling on the same date.
        today = date.today()
        fixed_now = datetime.combine(today, time(5, 0))
        weekday_names = [
            "Monday", "Tuesday", "Wednesday", "Thursday",
            "Friday", "Saturday", "Sunday",
        ]
        weekday = weekday_names[today.weekday()]

        self._post_onboarding({
            "wake_time": "07:00",
            "sleep_time": "23:30",
            "need_to_items": [
                {"id": "integration-study", "name": "Integration Study Task", "duration": 60}
            ],
            "fixed_commitments": [
                {
                    "id": "integration-college",
                    "name": "Integration College",
                    "days": weekday,
                    "start_time": "09:00",
                    "end_time": "12:00",
                    "commute_before": 30,
                    "commute_after": 20,
                }
            ],
        })

        with patch("app.api.routes.schedules._now", return_value=fixed_now):
            proposal_response = self.client.post(
                "/schedules/propose", headers=self.auth_headers
            )

        self.assertEqual(proposal_response.status_code, 200, proposal_response.text)
        proposal = proposal_response.json()
        proposal_id = proposal["proposal_id"]

        study_items = [
            item
            for day in proposal["days"]
            for item in day["items"]
            if item["title"] == "Integration Study Task"
        ]
        self.assertTrue(study_items, "The study task should appear in the proposal")

        commitment_start = datetime.combine(
        today, time(9, 0), tzinfo=timezone(timedelta(hours=5, minutes=30))
        )
        commitment_end = datetime.combine(
        today, time(12, 0), tzinfo=timezone(timedelta(hours=5, minutes=30))
        )        
        protected_start = commitment_start - timedelta(minutes=30)
        protected_end = commitment_end + timedelta(minutes=30)

        for item in study_items:
            start = datetime.fromisoformat(item["start_time"])
            end = datetime.fromisoformat(item["end_time"])
            if start.date() == today:
                self.assertFalse(
                    start < protected_end and end > protected_start,
                    f"Study placement overlaps the protected commitment window: {item}",
                )

        with patch("app.api.routes.schedules._now", return_value=fixed_now):
            approval_response = self.client.post(
                f"/schedules/proposals/{proposal_id}/approve",
                headers=self.auth_headers,
            )

        self.assertEqual(approval_response.status_code, 200, approval_response.text)

        with patch("app.api.routes.schedules._now", return_value=fixed_now):
            schedule_response = self.client.get(
                "/schedules", headers=self.auth_headers
            )

        self.assertEqual(schedule_response.status_code, 200, schedule_response.text)
        active_study_items = [
            item
            for day in schedule_response.json()["days"]
            for item in day["items"]
            if item["title"] == "Integration Study Task"
        ]
        self.assertEqual(len(active_study_items), len(study_items))

        for item in active_study_items:
            start = datetime.fromisoformat(item["start_time"])
            end = datetime.fromisoformat(item["end_time"])
            if start.date() == today:
                self.assertFalse(
                    start < protected_end and end > protected_start,
                    f"Approved study placement overlaps the protected commitment window: {item}",
                )


if __name__ == "__main__":
    unittest.main()
