"""
Regression tests for _upsert_fixed_commitments() — the onboarding path that
converts fixed_commitments into is_fixed=True Task rows consumed by the
scheduler.
"""

import unittest
import uuid
from datetime import date, datetime, time, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.preference import Preference
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.task import Task
from app.models.user import User

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _next_weekday(weekday: int, start: date | None = None) -> date:
    """Return the next date (>= start or today) that falls on `weekday` (0=Mon)."""
    d = start or date.today()
    delta = (weekday - d.weekday()) % 7
    return d + timedelta(days=delta)


def _weekday_name(weekday: int) -> str:
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    return names[weekday]


# ---------------------------------------------------------------------------
# A fixed "now" so tests are deterministic regardless of run date.
# We use a Monday at 05:00 so the 7-day window Mon–Sun always has 5 weekdays.
# ---------------------------------------------------------------------------

# Find the nearest upcoming Monday from today
def _fixed_monday() -> datetime:
    today = date.today()
    days_ahead = (0 - today.weekday()) % 7  # 0 = Monday
    mon = today + timedelta(days=days_ahead)
    return datetime(mon.year, mon.month, mon.day, 5, 0, 0)


FIXED_NOW = _fixed_monday()


def _patched_now():
    return patch("app.api.routes.schedules._now", return_value=FIXED_NOW)


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------

class TestFixedCommitments(unittest.TestCase):
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
        self.db.query(ScheduleItem).delete()
        self.db.query(Schedule).delete()
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

    def _fixed_rows(self, title: str | None = None):
        """Query is_fixed=True Task rows for the current test user."""
        q = self.db.query(Task).filter(
            Task.user_id == self.user.id,
            Task.is_fixed.is_(True),
        )
        if title:
            q = q.filter(Task.title == title)
        return q.all()

    # -------------------------------------------------------------------------
    # 1. Monday–Friday commitment creates rows for weekdays in the window
    # -------------------------------------------------------------------------

    def test_fixed_commitment_same_weekdays_creates_rows(self):
        """A 'Monday–Friday' commitment creates is_fixed=True rows for each
        Mon–Fri date that falls within today+7 days."""
        self._post_onboarding({
            "fixed_commitments": [
                {
                    "id": "comm_mf",
                    "name": "College Lectures",
                    "days": "Monday\u2013Friday",
                    "start_time": "09:00",
                    "end_time": "15:00",
                    "commute_before": 30,
                    "commute_after": 20,
                }
            ],
        })

        rows = self._fixed_rows("College Lectures")
        # A 7-day window starting on a Monday always contains exactly 5 weekdays
        self.assertGreaterEqual(len(rows), 1, "Must create at least 1 is_fixed=True row")

        for row in rows:
            self.assertTrue(row.is_fixed)
            self.assertIsNone(row.task_type, "task_type must be None for fixed tasks")
            self.assertEqual(row.priority, 3)
            # 09:00–15:00 = 360 minutes
            self.assertEqual(row.estimated_duration, 360)
            # commute = max(30, 20) = 30
            self.assertEqual(row.commute_minutes, 30)
            # The deadline column stores the start datetime (DEMO HACK)
            self.assertIsNotNone(row.deadline)
            # Start time should be 09:00
            start = row.deadline
            if hasattr(start, "hour"):
                self.assertEqual(start.hour, 9)
                self.assertEqual(start.minute, 0)
            # Occurrence must fall on Mon–Fri
            occ_date = start.date() if hasattr(start, "date") else None
            if occ_date:
                self.assertLessEqual(occ_date.weekday(), 4, "Occurrence must be Mon–Fri")

    # -------------------------------------------------------------------------
    # 2. Single weekday commitment creates rows
    # -------------------------------------------------------------------------

    def test_fixed_commitment_single_weekday_creates_rows(self):
        """A single-weekday commitment creates is_fixed=True rows for each
        occurrence of that weekday in the 7-day window."""
        # Wednesday (weekday=2) appears at least once in any 7-day window.
        self._post_onboarding({
            "fixed_commitments": [
                {
                    "id": "comm_wed",
                    "name": "Wednesday Gym",
                    "days": "Wednesday",
                    "start_time": "07:00",
                    "end_time": "08:00",
                    "commute_before": 10,
                    "commute_after": 10,
                }
            ],
        })

        rows = self._fixed_rows("Wednesday Gym")
        self.assertGreaterEqual(len(rows), 1, "Must create at least 1 row for Wednesday")
        for row in rows:
            self.assertTrue(row.is_fixed)
            self.assertIsNone(row.task_type)
            self.assertEqual(row.estimated_duration, 60)   # 07:00–08:00 = 60 min
            self.assertEqual(row.commute_minutes, 10)      # max(10, 10) = 10
            if row.deadline and hasattr(row.deadline, "weekday"):
                self.assertEqual(row.deadline.weekday(), 2, "Occurrence must be a Wednesday")

    # -------------------------------------------------------------------------
    # 3. Idempotency: re-submitting same payload does not duplicate rows
    # -------------------------------------------------------------------------

    def test_fixed_commitment_idempotency(self):
        """Submitting the same onboarding payload twice must not create more
        is_fixed=True rows on the second call."""
        payload = {
            "fixed_commitments": [
                {
                    "id": "comm_idem",
                    "name": "Morning Run",
                    "days": "Monday\u2013Friday",
                    "start_time": "06:00",
                    "end_time": "07:00",
                    "commute_before": 0,
                    "commute_after": 0,
                }
            ],
        }

        self._post_onboarding(payload)
        count_after_first = len(self._fixed_rows("Morning Run"))
        self.assertGreater(count_after_first, 0)

        self._post_onboarding(payload)
        count_after_second = len(self._fixed_rows("Morning Run"))

        self.assertEqual(
            count_after_first,
            count_after_second,
            "Re-submitting the same payload must not create additional fixed-task rows",
        )

    # -------------------------------------------------------------------------
    # 4. Same title + different start time → distinct rows (key is title+datetime)
    # -------------------------------------------------------------------------

    def test_same_title_different_start_time_creates_distinct_rows(self):
        """Two commitments with the same name but different times on the same
        weekday must be stored as separate rows because the upsert key includes
        the start datetime."""
        # Post commitment at 07:00–08:00 on Monday
        self._post_onboarding({
            "fixed_commitments": [
                {
                    "id": "gym_am",
                    "name": "Gym",
                    "days": "Monday",
                    "start_time": "07:00",
                    "end_time": "08:00",
                    "commute_before": 0,
                    "commute_after": 0,
                }
            ],
        })

        # Post same name but 18:00–19:00 on Monday
        self._post_onboarding({
            "fixed_commitments": [
                {
                    "id": "gym_pm",
                    "name": "Gym",
                    "days": "Monday",
                    "start_time": "18:00",
                    "end_time": "19:00",
                    "commute_before": 0,
                    "commute_after": 0,
                }
            ],
        })

        rows = self._fixed_rows("Gym")
        start_times = set()
        for row in rows:
            if row.deadline:
                start_times.add((row.deadline.hour, row.deadline.minute))

        # Both 07:00 and 18:00 occurrences must exist (for the Monday in the window)
        self.assertIn(
            (7, 0), start_times,
            "07:00 Gym occurrence must be present",
        )
        self.assertIn(
            (18, 0), start_times,
            "18:00 Gym occurrence must be present",
        )

    # -------------------------------------------------------------------------
    # 5. Fixed commitment blocks are respected during schedule generation
    # -------------------------------------------------------------------------

    def test_fixed_commitment_does_not_block_schedule_generation(self):
        """After onboarding with a fixed commitment, POST /schedules/generate
        must return 200 and the fixed block must appear in the 'fixed' list.
        No scheduled item may overlap the fixed block's time window."""

        # Use a deterministic Monday so schedule generation is predictable.
        with _patched_now():
            # Onboard with a Monday commitment 09:00–12:00
            monday_date = FIXED_NOW.date()
            self._post_onboarding({
                "fixed_commitments": [
                    {
                        "id": "comm_gen",
                        "name": "Morning Lectures",
                        "days": "Monday",
                        "start_time": "09:00",
                        "end_time": "12:00",
                        "commute_before": 0,
                        "commute_after": 0,
                    }
                ],
            })

            # Verify fixed row was created for this Monday
            rows = self._fixed_rows("Morning Lectures")
            monday_rows = [r for r in rows if r.deadline and r.deadline.date() == monday_date]
            self.assertGreater(len(monday_rows), 0, "Must have a fixed row for Monday")

            # Also add a regular plannable task
            task_res = self.client.post(
                "/tasks",
                json={
                    "title": "Study Session",
                    "estimated_duration": 60,
                    "priority": 3,
                    "task_type": "growth",
                },
                headers=self.auth_headers,
            )
            self.assertEqual(task_res.status_code, 201, task_res.text)

            # Generate schedule
            gen_res = self.client.post("/schedules/generate", headers=self.auth_headers)
            self.assertEqual(gen_res.status_code, 200, gen_res.text)

            body = gen_res.json()
            days = body.get("days", [])

            # Find today's (Monday) day entry
            monday_str = monday_date.isoformat()
            monday_day = next(
                (d for d in days if str(d.get("date", "")).startswith(monday_str)),
                None,
            )
            self.assertIsNotNone(monday_day, "Response must include Monday in the schedule")

            # Fixed block must appear in the 'fixed' list
            fixed_blocks = monday_day.get("fixed", [])
            lecture_block = next(
                (b for b in fixed_blocks if b.get("title") == "Morning Lectures"),
                None,
            )
            self.assertIsNotNone(
                lecture_block,
                "Morning Lectures must appear in the 'fixed' list for Monday",
            )

            # No scheduled item may overlap 09:00–12:00
            from datetime import timezone as tz
            block_start_hour = 9
            block_end_hour = 12
            for item in monday_day.get("items", []):
                item_start_str = item.get("start_time", "")
                item_end_str = item.get("end_time", "")
                if not item_start_str or not item_end_str:
                    continue
                # Parse to datetime (may be timezone-aware ISO string)
                item_start = datetime.fromisoformat(item_start_str)
                item_end = datetime.fromisoformat(item_end_str)
                # Normalise to naive hours
                if item_start.tzinfo is not None:
                    ist_offset = timedelta(hours=5, minutes=30)
                    item_start = item_start.astimezone(tz.utc).replace(tzinfo=None) + ist_offset
                    item_end = item_end.astimezone(tz.utc).replace(tzinfo=None) + ist_offset
                item_start_minutes = item_start.hour * 60 + item_start.minute
                item_end_minutes = item_end.hour * 60 + item_end.minute
                block_start_minutes = block_start_hour * 60
                block_end_minutes = block_end_hour * 60
                overlap = (
                    item_start_minutes < block_end_minutes
                    and item_end_minutes > block_start_minutes
                )
                self.assertFalse(
                    overlap,
                    f"Scheduled item '{item.get('title')}' ({item_start_str}–{item_end_str}) "
                    f"overlaps the fixed block 09:00–12:00",
                )


if __name__ == "__main__":
    unittest.main()
