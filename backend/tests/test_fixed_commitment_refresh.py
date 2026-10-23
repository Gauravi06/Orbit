"""
Regression tests for refresh_fixed_commitments() — the function called at the
start of POST /schedules/generate that keeps is_fixed=True Task rows fresh
across planning windows.

Scenarios covered:
1. Same-window idempotency: calling generate twice does not create duplicate rows.
2. Cross-window refresh: rows from a prior window are cleaned up; new ones created.
3. Expired vs in-progress: deadline == today is NOT deleted; deadline < today IS.
4. User isolation: cleanup only affects the authenticated user's is_fixed rows.
5. Ordinary-task protection: is_fixed=False rows are never deleted.
6. Scheduler overlap prevention: _load() returns refreshed fixed rows as constraints.
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
from app.models.task import Task, TaskType
from app.models.user import User
from app.api.routes.preferences import refresh_fixed_commitments


# ---------------------------------------------------------------------------
# Shared SQLite in-memory engine
# ---------------------------------------------------------------------------

def _build_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine


# ---------------------------------------------------------------------------
# A stable "today" so tests are deterministic.
# We pick a Wednesday so there are Mon, Tue, Wed in any 7-day window starting
# from it, and "yesterday" and "tomorrow" are unambiguous.
# ---------------------------------------------------------------------------

# Find the next Wednesday from actual today so we don't accidentally land on
# a weekend edge case.
def _fixed_wednesday() -> date:
    today = date.today()
    days_ahead = (2 - today.weekday()) % 7  # 2 = Wednesday
    return today + timedelta(days=days_ahead)


FIXED_TODAY = _fixed_wednesday()
FIXED_YESTERDAY = FIXED_TODAY - timedelta(days=1)
FIXED_TOMORROW = FIXED_TODAY + timedelta(days=1)


def _patch_date_today(fake_today: date):
    """Patch date.today() inside preferences.py."""
    return patch("app.api.routes.preferences.date") 


class _PatchedDate:
    """A minimal drop-in for the `date` class that overrides `today()`."""
    _today: date

    def __init__(self, today: date):
        self._real_date = date
        self._today = today

    def today(self):
        return self._today

    def __call__(self, *args, **kwargs):
        return self._real_date(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._real_date, name)


# ---------------------------------------------------------------------------
# Base test class with shared setup
# ---------------------------------------------------------------------------

class RefreshTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = _build_engine()
        cls.Session = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

        def override_get_db():
            db = cls.Session()
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
        self.db = self.Session()
        self.db.query(ScheduleItem).delete()
        self.db.query(Schedule).delete()
        self.db.query(Task).delete()
        self.db.query(Preference).delete()
        self.db.query(User).delete()
        self.db.commit()

        self.user = self._make_user("test@example.com")
        self.token = create_access_token(str(self.user.id))
        self.auth = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        self.db.close()

    # ------------------------------------------------------------------
    def _make_user(self, email: str) -> User:
        u = User(
            id=uuid.uuid4(),
            name="Student",
            email=email,
            hashed_password=hash_password("Pass123!"),
            wake_time=time(7, 0),
            sleep_time=time(23, 30),
            focus_duration=90,
        )
        self.db.add(u)
        self.db.commit()
        self.db.refresh(u)
        return u

    def _onboard(self, commitments: list, client=None, auth=None) -> None:
        c = client or self.client
        h = auth or self.auth
        res = c.post("/onboarding", json={"fixed_commitments": commitments}, headers=h)
        self.assertEqual(res.status_code, 200, res.text)

    def _fixed_rows(self, user_id=None, title=None):
        user_id = user_id or self.user.id
        q = self.db.query(Task).filter(
            Task.user_id == user_id,
            Task.is_fixed.is_(True),
        )
        if title:
            q = q.filter(Task.title == title)
        # Expire cached state so we see DB writes from the TestClient's session
        self.db.expire_all()
        return q.all()

    def _all_rows(self, user_id=None):
        user_id = user_id or self.user.id
        self.db.expire_all()
        return self.db.query(Task).filter(Task.user_id == user_id).all()

    def _commitment(self, name="Gym", days="Wednesday",
                    start="07:00", end="08:00",
                    commute_before=0, commute_after=0):
        return {
            "id": f"comm_{uuid.uuid4().hex[:8]}",
            "name": name,
            "days": days,
            "start_time": start,
            "end_time": end,
            "commute_before": commute_before,
            "commute_after": commute_after,
        }

    def _generate(self, fake_now: datetime | None = None):
        if fake_now:
            with patch("app.api.routes.schedules._now", return_value=fake_now):
                return self.client.post("/schedules/generate", headers=self.auth)
        return self.client.post("/schedules/generate", headers=self.auth)

    def _today_dt(self, d: date | None = None) -> datetime:
        d = d or FIXED_TODAY
        return datetime(d.year, d.month, d.day, 6, 0, 0)


# ---------------------------------------------------------------------------
# 1. Same-window idempotency
# ---------------------------------------------------------------------------

class TestSameWindowIdempotency(RefreshTestBase):
    def test_generate_twice_same_window_no_duplicates(self):
        """Calling /schedules/generate twice in the same window must not create
        duplicate is_fixed rows."""
        self._onboard([self._commitment(name="Yoga", days="Wednesday")])

        count_before = len(self._fixed_rows(title="Yoga"))
        self.assertGreater(count_before, 0, "Onboarding must create fixed rows")

        now = self._today_dt()
        self._generate(fake_now=now)
        count_after_first = len(self._fixed_rows(title="Yoga"))

        self._generate(fake_now=now)
        count_after_second = len(self._fixed_rows(title="Yoga"))

        self.assertEqual(
            count_after_first,
            count_after_second,
            "Second generate in the same window must not add rows",
        )


# ---------------------------------------------------------------------------
# 2. Cross-window refresh
# ---------------------------------------------------------------------------

class TestCrossWindowRefresh(RefreshTestBase):
    def test_expired_rows_replaced_on_next_window(self):
        """Rows whose deadline < today are deleted; fresh rows for the new
        window are created by the next generate call."""
        # Directly insert an expired is_fixed row (deadline = yesterday)
        expired_dt = datetime(
            FIXED_YESTERDAY.year, FIXED_YESTERDAY.month, FIXED_YESTERDAY.day, 9, 0, 0
        )
        expired_task = Task(
            user_id=self.user.id,
            title="Morning Run",
            task_type=None,
            priority=3,
            estimated_duration=60,
            deadline=expired_dt,
            is_fixed=True,
            must_daily=False,
            commute_minutes=0,
            status="pending",
        )
        self.db.add(expired_task)
        self.db.commit()

        # Verify the expired row exists
        expired_rows = self._fixed_rows(title="Morning Run")
        self.assertEqual(len(expired_rows), 1, "Expired row must be in DB before generate")

        # Onboard a Wednesday commitment so refresh_fixed_commitments has something to upsert
        self._onboard([self._commitment(name="Morning Run", days="Wednesday")])

        # Generate with today = FIXED_TODAY (Wednesday); the expired row is before today
        now = self._today_dt(FIXED_TODAY)
        with patch("app.api.routes.preferences.date") as mock_date:
            mock_date.today.return_value = FIXED_TODAY
            mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
            res = self._generate(fake_now=now)

        self.assertEqual(res.status_code, 200, res.text)

        remaining = self._fixed_rows(title="Morning Run")
        # All remaining rows must have deadline >= today
        today_dt = datetime(FIXED_TODAY.year, FIXED_TODAY.month, FIXED_TODAY.day, 0, 0, 0)
        for row in remaining:
            self.assertGreaterEqual(
                row.deadline,
                today_dt,
                f"Row with deadline {row.deadline} should have been deleted (expired)",
            )


# ---------------------------------------------------------------------------
# 3. Expired vs in-progress boundary
# ---------------------------------------------------------------------------

class TestExpiredVsInProgress(RefreshTestBase):
    def test_today_row_not_deleted(self):
        """A row with deadline == today 00:00:00 is NOT deleted by refresh."""
        today_dt = datetime(
            FIXED_TODAY.year, FIXED_TODAY.month, FIXED_TODAY.day, 9, 0, 0
        )
        in_progress = Task(
            user_id=self.user.id,
            title="Today Commitment",
            task_type=None,
            priority=3,
            estimated_duration=60,
            deadline=today_dt,
            is_fixed=True,
            must_daily=False,
            commute_minutes=0,
            status="pending",
        )
        self.db.add(in_progress)
        self.db.commit()

        # Run refresh directly (lower-level) with patched date
        with patch("app.api.routes.preferences.date") as mock_date:
            mock_date.today.return_value = FIXED_TODAY
            mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
            refresh_fixed_commitments(self.db, self.user)
            self.db.commit()

        rows = self._fixed_rows(title="Today Commitment")
        self.assertEqual(len(rows), 1, "Today's row must NOT be deleted")
        self.assertEqual(rows[0].deadline, today_dt)

    def test_yesterday_row_deleted(self):
        """A row with deadline < today IS deleted by refresh."""
        yesterday_dt = datetime(
            FIXED_YESTERDAY.year, FIXED_YESTERDAY.month, FIXED_YESTERDAY.day, 9, 0, 0
        )
        stale = Task(
            user_id=self.user.id,
            title="Stale Commitment",
            task_type=None,
            priority=3,
            estimated_duration=60,
            deadline=yesterday_dt,
            is_fixed=True,
            must_daily=False,
            commute_minutes=0,
            status="pending",
        )
        self.db.add(stale)
        self.db.commit()

        with patch("app.api.routes.preferences.date") as mock_date:
            mock_date.today.return_value = FIXED_TODAY
            mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
            refresh_fixed_commitments(self.db, self.user)
            self.db.commit()

        rows = self._fixed_rows(title="Stale Commitment")
        self.assertEqual(len(rows), 0, "Yesterday's row must be deleted")


# ---------------------------------------------------------------------------
# 4. User isolation
# ---------------------------------------------------------------------------

class TestUserIsolation(RefreshTestBase):
    def test_other_user_rows_untouched(self):
        """Refresh must never delete another user's is_fixed rows."""
        other_user = self._make_user("other@example.com")

        # Insert an expired fixed row for the OTHER user
        expired_dt = datetime(
            FIXED_YESTERDAY.year, FIXED_YESTERDAY.month, FIXED_YESTERDAY.day, 9, 0, 0
        )
        other_task = Task(
            user_id=other_user.id,
            title="Other Gym",
            task_type=None,
            priority=3,
            estimated_duration=60,
            deadline=expired_dt,
            is_fixed=True,
            must_daily=False,
            commute_minutes=0,
            status="pending",
        )
        self.db.add(other_task)
        self.db.commit()

        # Run refresh for the MAIN user
        with patch("app.api.routes.preferences.date") as mock_date:
            mock_date.today.return_value = FIXED_TODAY
            mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
            refresh_fixed_commitments(self.db, self.user)
            self.db.commit()

        # Other user's row must still exist
        self.db.expire_all()
        other_rows = (
            self.db.query(Task)
            .filter(Task.user_id == other_user.id, Task.is_fixed.is_(True))
            .all()
        )
        self.assertEqual(len(other_rows), 1, "Other user's fixed row must not be deleted")


# ---------------------------------------------------------------------------
# 5. Ordinary-task protection
# ---------------------------------------------------------------------------

class TestOrdinaryTaskProtection(RefreshTestBase):
    def test_non_fixed_task_not_deleted(self):
        """is_fixed=False tasks are never affected by refresh, even if they
        share a title with a fixed commitment."""
        # Expired fixed row for this user — will be deleted
        expired_fixed_dt = datetime(
            FIXED_YESTERDAY.year, FIXED_YESTERDAY.month, FIXED_YESTERDAY.day, 9, 0, 0
        )
        fixed_task = Task(
            user_id=self.user.id,
            title="Gym",
            task_type=None,
            priority=3,
            estimated_duration=60,
            deadline=expired_fixed_dt,
            is_fixed=True,
            must_daily=False,
            commute_minutes=0,
            status="pending",
        )
        # Ordinary task with same title — must survive
        ordinary_task = Task(
            user_id=self.user.id,
            title="Gym",
            task_type=TaskType.growth,
            priority=3,
            estimated_duration=60,
            deadline=datetime(FIXED_TOMORROW.year, FIXED_TOMORROW.month, FIXED_TOMORROW.day, 10, 0),
            is_fixed=False,
            must_daily=False,
            commute_minutes=0,
            status="pending",
        )
        self.db.add_all([fixed_task, ordinary_task])
        self.db.commit()

        with patch("app.api.routes.preferences.date") as mock_date:
            mock_date.today.return_value = FIXED_TODAY
            mock_date.side_effect = lambda *a, **kw: date(*a, **kw)
            refresh_fixed_commitments(self.db, self.user)
            self.db.commit()

        self.db.expire_all()
        all_rows = (
            self.db.query(Task)
            .filter(Task.user_id == self.user.id, Task.title == "Gym")
            .all()
        )
        non_fixed = [r for r in all_rows if not r.is_fixed]
        self.assertEqual(len(non_fixed), 1, "Ordinary task must survive refresh")


# ---------------------------------------------------------------------------
# 6. Scheduler overlap prevention via _load()
# ---------------------------------------------------------------------------

class TestSchedulerOverlapPrevention(RefreshTestBase):
    def test_generate_includes_refreshed_fixed_rows_as_constraints(self):
        """After a cross-window refresh, /schedules/generate must include the
        refreshed fixed rows as FixedBlock constraints (visible in response)."""
        # Onboard with a Wednesday commitment
        self._onboard([self._commitment(
            name="Lab Session",
            days="Wednesday",
            start="10:00",
            end="12:00",
        )])

        # Use FIXED_TODAY (Wednesday) as 'now'
        now = self._today_dt(FIXED_TODAY)
        res = self._generate(fake_now=now)
        self.assertEqual(res.status_code, 200, res.text)

        body = res.json()
        days = body.get("days", [])

        # Find Wednesday in response
        wed_str = FIXED_TODAY.isoformat()
        wed_day = next(
            (d for d in days if str(d.get("date", "")).startswith(wed_str)),
            None,
        )
        self.assertIsNotNone(wed_day, "Response must include Wednesday")

        fixed_blocks = wed_day.get("fixed", [])
        lab_block = next(
            (b for b in fixed_blocks if b.get("title") == "Lab Session"),
            None,
        )
        self.assertIsNotNone(
            lab_block,
            f"Lab Session must appear as a fixed block on Wednesday; fixed={fixed_blocks}",
        )


if __name__ == "__main__":
    unittest.main()
