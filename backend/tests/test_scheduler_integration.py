import unittest
import uuid
from datetime import datetime, time, timedelta, timezone
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

IST = timezone(timedelta(hours=5, minutes=30))

# Naive IST "now" used by the scheduler (schedules._now returns naive IST).
# 05:00 is before every wake time used below, so day 0 starts at wake time.
FIXED_NOW = datetime(2026, 10, 11, 5, 0)
FIXED_DAY = FIXED_NOW.date()


def _fixed_now():
    return patch("app.api.routes.schedules._now", return_value=FIXED_NOW)


class TestSchedulerIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
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

        # User A: Early bird (wake 06:00, sleep 21:00)
        self.user_a = User(
            id=uuid.uuid4(),
            name="Alice Early",
            email="alice@example.com",
            hashed_password=hash_password("Pass123!"),
            wake_time=time(6, 0),
            sleep_time=time(21, 0),
        )
        # User B: Late owl (wake 10:00, sleep 02:00)
        self.user_b = User(
            id=uuid.uuid4(),
            name="Bob Late",
            email="bob@example.com",
            hashed_password=hash_password("Pass123!"),
            wake_time=time(10, 0),
            sleep_time=time(2, 0),
        )
        self.db.add_all([self.user_a, self.user_b])
        self.db.commit()

        self.token_a = create_access_token(str(self.user_a.id))
        self.token_b = create_access_token(str(self.user_b.id))
        self.headers_a = {"Authorization": f"Bearer {self.token_a}"}
        self.headers_b = {"Authorization": f"Bearer {self.token_b}"}

    def tearDown(self):
        self.db.close()

    def _items(self, data, title=None):
        items = [i for day in data["days"] for i in day["items"]]
        if title is not None:
            items = [i for i in items if i["title"] == title]
        return items

    def test_completed_task_status_exclusion(self):
        """Completed and done tasks are omitted from the schedule; pending and in_progress are included."""
        tomorrow = (datetime.now(IST) + timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)

        # 1. Completed task (status='completed')
        t_completed = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Completed Task",
            estimated_duration=60,
            priority=4,
            status="completed",
            task_type=TaskType.growth,
        )
        # 2. Done task (status='done')
        t_done = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Done Task",
            estimated_duration=60,
            priority=4,
            status="done",
            task_type=TaskType.growth,
        )
        # 3. Pending task (status='pending')
        t_pending = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Pending Task",
            estimated_duration=60,
            priority=4,
            status="pending",
            task_type=TaskType.deadline,
            deadline=tomorrow,
        )
        # 4. In progress task (status='in_progress')
        t_in_prog = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="In Progress Task",
            estimated_duration=60,
            priority=3,
            status="in_progress",
            task_type=TaskType.growth,
        )
        self.db.add_all([t_completed, t_done, t_pending, t_in_prog])
        self.db.commit()

        res = self.client.post("/schedules/generate", headers=self.headers_a)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        all_item_titles = [item["title"] for day in data["days"] for item in day["items"]]
        self.assertIn("Pending Task", all_item_titles)
        self.assertIn("In Progress Task", all_item_titles)
        self.assertNotIn("Completed Task", all_item_titles)
        self.assertNotIn("Done Task", all_item_titles)

    def test_scheduler_user_preference_isolation(self):
        """Each user's saved wake time decides the exact first slot; users stay isolated.

        Time is frozen at 05:00 and each user has exactly one task and no fixed
        commitments, so the first placement starts exactly at the saved wake time.
        Saved values differ from both the defaults (07:00) and the User-column
        values from setUp, so ignoring saved preferences makes this test fail.
        """
        r = self.client.put(
            "/preferences",
            json={"wake_time": "06:30", "sleep_time": "08:30"},
            headers=self.headers_a,
        )
        self.assertEqual(r.status_code, 200)
        r = self.client.put(
            "/preferences",
            json={"wake_time": "11:00", "sleep_time": "13:00"},
            headers=self.headers_b,
        )
        self.assertEqual(r.status_code, 200)

        # Preferences are stored per user
        pa = self.client.get("/preferences", headers=self.headers_a).json()
        pb = self.client.get("/preferences", headers=self.headers_b).json()
        self.assertEqual((pa["wake_time"], pa["sleep_time"]), ("06:30", "08:30"))
        self.assertEqual((pb["wake_time"], pb["sleep_time"]), ("11:00", "13:00"))

        task_a = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Alice Early Study",
            estimated_duration=60,
            priority=5,
            task_type=TaskType.growth,
        )
        task_b = Task(
            id=uuid.uuid4(),
            user_id=self.user_b.id,
            title="Bob Morning Study",
            estimated_duration=60,
            priority=5,
            task_type=TaskType.growth,
        )
        self.db.add_all([task_a, task_b])
        self.db.commit()

        with _fixed_now():
            res_a = self.client.post("/schedules/generate", headers=self.headers_a)
            res_b = self.client.post("/schedules/generate", headers=self.headers_b)
        self.assertEqual(res_a.status_code, 200)
        self.assertEqual(res_b.status_code, 200)
        data_a = res_a.json()
        data_b = res_b.json()

        alice_items = self._items(data_a, "Alice Early Study")
        self.assertEqual(len(alice_items), 1)
        alice_start = datetime.fromisoformat(alice_items[0]["start_time"])
        alice_end = datetime.fromisoformat(alice_items[0]["end_time"])
        self.assertEqual(alice_start.date(), FIXED_DAY)
        self.assertEqual(alice_start.time(), time(6, 30))
        self.assertEqual(alice_end.time(), time(7, 30))

        bob_items = self._items(data_b, "Bob Morning Study")
        self.assertEqual(len(bob_items), 1)
        bob_start = datetime.fromisoformat(bob_items[0]["start_time"])
        bob_end = datetime.fromisoformat(bob_items[0]["end_time"])
        self.assertEqual(bob_start.date(), FIXED_DAY)
        self.assertEqual(bob_start.time(), time(11, 0))
        self.assertEqual(bob_end.time(), time(12, 0))

        # No cross-contamination of tasks
        alice_titles = [i["title"] for i in self._items(data_a)]
        bob_titles = [i["title"] for i in self._items(data_b)]
        self.assertEqual(set(alice_titles), {"Alice Early Study"})
        self.assertEqual(set(bob_titles), {"Bob Morning Study"})

        # Saved preferences were not changed by the other user's generation
        pa2 = self.client.get("/preferences", headers=self.headers_a).json()
        pb2 = self.client.get("/preferences", headers=self.headers_b).json()
        self.assertEqual(pa2["wake_time"], "06:30")
        self.assertEqual(pb2["wake_time"], "11:00")

    def test_scheduler_respects_saved_wake_and_sleep_boundaries(self):
        """Every scheduled item stays inside the user's saved wake/sleep window.

        Each user has a 2-hour window and 600 minutes of work, so the scheduler
        must spread chunks across days and fill each window. Ignoring the saved
        window (default 07:00-23:00) would place items outside it.
        """
        windows = {
            "a": (time(6, 30), time(8, 30)),
            "b": (time(11, 0), time(13, 0)),
        }
        self.client.put(
            "/preferences",
            json={"wake_time": "06:30", "sleep_time": "08:30"},
            headers=self.headers_a,
        )
        self.client.put(
            "/preferences",
            json={"wake_time": "11:00", "sleep_time": "13:00"},
            headers=self.headers_b,
        )

        self.db.add_all(
            [
                Task(
                    id=uuid.uuid4(),
                    user_id=self.user_a.id,
                    title="Alice Big Task",
                    estimated_duration=600,
                    priority=5,
                    task_type=TaskType.growth,
                ),
                Task(
                    id=uuid.uuid4(),
                    user_id=self.user_b.id,
                    title="Bob Big Task",
                    estimated_duration=600,
                    priority=5,
                    task_type=TaskType.growth,
                ),
            ]
        )
        self.db.commit()

        with _fixed_now():
            res_a = self.client.post("/schedules/generate", headers=self.headers_a)
            res_b = self.client.post("/schedules/generate", headers=self.headers_b)
        self.assertEqual(res_a.status_code, 200)
        self.assertEqual(res_b.status_code, 200)

        for key, data, title in (
            ("a", res_a.json(), "Alice Big Task"),
            ("b", res_b.json(), "Bob Big Task"),
        ):
            wake, sleep = windows[key]
            items = self._items(data, title)
            self.assertGreater(len(items), 1)

            total_minutes = 0
            for item in items:
                start = datetime.fromisoformat(item["start_time"])
                end = datetime.fromisoformat(item["end_time"])
                self.assertEqual(start.date(), end.date())
                self.assertGreaterEqual(start.time(), wake)
                self.assertLessEqual(end.time(), sleep)
                total_minutes += int((end - start).total_seconds() // 60)

            # Nothing was dropped: all 600 minutes were placed inside the window
            self.assertEqual(total_minutes, 600)

        # Isolation: each user only sees their own task
        self.assertEqual({i["title"] for i in self._items(res_a.json())}, {"Alice Big Task"})
        self.assertEqual({i["title"] for i in self._items(res_b.json())}, {"Bob Big Task"})


if __name__ == "__main__":
    unittest.main()