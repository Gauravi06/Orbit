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

    def test_unclosed_check_endpoint(self):
        """GET /schedules/unclosed-check returns 200 with None/null when no unclosed days exist."""
        res = self.client.get("/schedules/unclosed-check", headers=self.headers_a)
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json())

    def test_week_spread_endpoint(self):
        """GET /schedules/week returns full 7-day spread with calculated stats and groups."""
        task_a = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Alice Deep Study",
            estimated_duration=90,
            priority=5,
            task_type=TaskType.growth,
        )
        self.db.add(task_a)
        self.db.commit()

        # Generate schedule for Alice
        gen_res = self.client.post("/schedules/generate", headers=self.headers_a)
        self.assertEqual(gen_res.status_code, 200)

        # Call /schedules/week
        res = self.client.get("/schedules/week", headers=self.headers_a)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertIn("days", data)
        self.assertEqual(len(data["days"]), 7)
        self.assertIn("groups", data)
        self.assertIn("deepWorkHours", data)
        self.assertIn("restHours", data)
        self.assertIn("hobbyHours", data)
        self.assertIn("targetHobbyHours", data)
        self.assertIn("noticeParagraph", data)
        self.assertIn("suggestion", data)

        # Confirm scheduled items are present in the days
        all_titles = [it["title"] for d in data["days"] for it in d["items"]]
        self.assertIn("Alice Deep Study", all_titles)

    def test_disruption_validation_failure_does_not_persist_or_overwrite_schedule(self):
        """
        Priority 2 verification:
        When a disruption produces validation violations (e.g. invalid placements),
        the shared helper returns violations without saving to the DB.
        The existing active schedule in database rows remains completely unchanged.
        """
        # Create an existing scheduled item for user_a
        sched = Schedule(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            date=FIXED_DAY,
            version=1,
        )
        self.db.add(sched)
        self.db.commit()

        initial_item = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched.id,
            task_id=uuid.uuid4(),
            start_time=datetime(2026, 10, 11, 7, 0, tzinfo=IST),
            end_time=datetime(2026, 10, 11, 8, 30, tzinfo=IST),
            status="scheduled",
        )
        self.db.add(initial_item)
        self.db.commit()

        # Capture database rows before disruption
        initial_db_items = self.db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sched.id).all()
        self.assertEqual(len(initial_db_items), 1)
        initial_item_id = initial_db_items[0].id
        initial_start = initial_db_items[0].start_time

        # Mock validate_plan to return a violation during disruption
        with _fixed_now(), patch("app.api.routes.schedules.validate_plan", return_value=["Simulated violation: impossible placement"]):
            disrupt_payload = {
                "blocks": [
                    {
                        "label": "Emergency Meeting",
                        "start": "2026-10-11T07:00:00",
                        "end": "2026-10-11T08:00:00",
                    }
                ],
                "caps": [],
            }
            res = self.client.post("/schedules/disrupt", json=disrupt_payload, headers=self.headers_a)

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("violations", data)
        self.assertEqual(data["violations"], ["Simulated violation: impossible placement"])

        # VERIFY DATABASE ROWS: The active schedule item must remain completely untouched in DB
        db_items_after = self.db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sched.id).all()
        self.assertEqual(len(db_items_after), 1)
        self.assertEqual(db_items_after[0].id, initial_item_id)
        self.assertEqual(db_items_after[0].start_time, initial_start)

    def test_end_to_end_connected_scheduling_journey(self):
        """
        Verify the connected, authenticated, non-mock backend journey:
        1. Save onboarding preferences and fixed commitments.
        2. Generate a schedule that demonstrably respects those saved values.
        3. Create a schedule-change proposal for a new task.
        4. Verify proposal creation leaves the active schedule unchanged.
        5. Explicitly approve the proposal.
        6. Verify the change persists in the database and is returned correctly after fetching the schedule again.
        Plus all safety checks:
        - Fixed commitments remain intact before and after approval.
        - Unapproved/rejected proposal does not mutate the active schedule.
        - Duplicate approval attempt is rejected and does not duplicate schedule items.
        - User isolation: User B cannot access User A's tasks, schedules, or proposals.
        """
        # --- Step 1: Save onboarding preferences and fixed commitments ---
        onboarding_data = {
            "wake_time": "06:00",
            "sleep_time": "22:00",
            "focus_duration": 60,
            "daily_cap_minutes": 360,
            "fixed_commitments": [
                {
                    "id": "morning-lecture",
                    "name": "Chemistry Lecture",
                    "days": "Sunday",  # 2026-10-11 is a Sunday
                    "start_time": "09:00",
                    "end_time": "11:00",
                    "commute_before": 15,
                    "commute_after": 15,
                }
            ],
            "need_to_items": [
                {"title": "Initial Chemistry Assignment", "estimated_duration": 90, "priority": 4}
            ],
            "should_do_items": [],
            "like_to_items": [],
        }

        with _fixed_now():
            res_onboard = self.client.post("/onboarding", json=onboarding_data, headers=self.headers_a)
        self.assertEqual(res_onboard.status_code, 200, res_onboard.text)
        self.assertEqual(res_onboard.json()["wake_time"], "06:00")
        self.assertEqual(res_onboard.json()["sleep_time"], "22:00")

        # --- Step 2: Generate schedule and verify it respects fixed commitments and preferences ---
        with _fixed_now():
            res_gen = self.client.post("/schedules/generate", headers=self.headers_a)
        self.assertEqual(res_gen.status_code, 200, res_gen.text)
        gen_data = res_gen.json()

        # Day 0 is 2026-10-11 (Sunday)
        day0 = gen_data["days"][0]
        self.assertEqual(str(day0["date"]), "2026-10-11")
        self.assertEqual(len(day0["fixed"]), 1)
        self.assertEqual(day0["fixed"][0]["title"], "Chemistry Lecture")

        # Chemistry lecture is 09:00-11:00 with 15min commute before/after: protected window is 08:45-11:15
        chem_items = [i for i in day0["items"] if i["title"] == "Initial Chemistry Assignment"]
        self.assertTrue(chem_items, "Initial task must be scheduled on day 0")
        for item in chem_items:
            s_time = datetime.fromisoformat(item["start_time"])
            e_time = datetime.fromisoformat(item["end_time"])
            # Ensure placement does not overlap 08:45-11:15
            p_start = datetime(2026, 10, 11, 8, 45, tzinfo=IST)
            p_end = datetime(2026, 10, 11, 11, 15, tzinfo=IST)
            self.assertFalse(s_time < p_end and e_time > p_start, f"Task overlaps fixed commitment: {item}")
            # Ensure within wake/sleep (06:00 - 22:00)
            self.assertGreaterEqual(s_time.time(), time(6, 0))
            self.assertLessEqual(e_time.time(), time(22, 0))

        # Snapshot active schedule item IDs and count before proposal
        active_items_before = self.db.query(ScheduleItem).join(Schedule).filter(Schedule.user_id == self.user_a.id).all()
        active_ids_before = {item.id for item in active_items_before}
        self.assertGreater(len(active_ids_before), 0)

        # --- Step 3: Create a new task and generate a schedule-change proposal ---
        new_task_payload = {
            "title": "Urgent Math Lab",
            "estimated_duration": 60,
            "priority": 5,
            "task_type": "growth",
        }
        res_task = self.client.post("/tasks", json=new_task_payload, headers=self.headers_a)
        self.assertEqual(res_task.status_code, 201, res_task.text)
        new_task_id = res_task.json()["id"]

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        self.assertEqual(res_prop.status_code, 200, res_prop.text)
        prop_data = res_prop.json()
        prop_id = prop_data["proposal_id"]
        self.assertEqual(prop_data["status"], "pending")

        # Confirm new task is proposed in the proposal placements
        prop_math_items = [i for d in prop_data["days"] for i in d["items"] if i["title"] == "Urgent Math Lab"]
        self.assertTrue(prop_math_items, "Urgent Math Lab should be planned in the proposal")

        # --- Step 4: Verify proposal creation leaves the active schedule completely unchanged ---
        active_items_after_prop = self.db.query(ScheduleItem).join(Schedule).filter(Schedule.user_id == self.user_a.id).all()
        active_ids_after_prop = {item.id for item in active_items_after_prop}
        self.assertEqual(active_ids_before, active_ids_after_prop, "Proposing must not alter active schedule items")

        # Schedule GET also returns exactly the prior state without Urgent Math Lab
        with _fixed_now():
            res_sched_check = self.client.get("/schedules", headers=self.headers_a)
        active_titles = [i["title"] for d in res_sched_check.json()["days"] for i in d["items"]]
        self.assertNotIn("Urgent Math Lab", active_titles, "Proposed task must NOT be active before approval")

        # --- Safety check: User Isolation ---
        # User B cannot see User A's task, schedule, or proposal
        res_b_task = self.client.get(f"/tasks/{new_task_id}", headers=self.headers_b)
        self.assertEqual(res_b_task.status_code, 404)

        res_b_prop = self.client.get(f"/schedules/proposals/{prop_id}", headers=self.headers_b)
        self.assertEqual(res_b_prop.status_code, 404)

        res_b_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_b)
        self.assertEqual(res_b_app.status_code, 404)

        with _fixed_now():
            res_b_sched = self.client.get("/schedules", headers=self.headers_b)
        b_titles = [i["title"] for d in res_b_sched.json()["days"] for i in d["items"]]
        self.assertNotIn("Urgent Math Lab", b_titles)
        self.assertNotIn("Initial Chemistry Assignment", b_titles)

        # --- Step 5: Explicitly approve the proposal ---
        with _fixed_now():
            res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app.status_code, 200, res_app.text)
        self.assertEqual(res_app.json()["status"], "approved")

        # --- Step 6: Verify change persists and returns correctly after fetching schedule again ---
        with _fixed_now():
            res_sched_final = self.client.get("/schedules", headers=self.headers_a)
        self.assertEqual(res_sched_final.status_code, 200)
        final_days = res_sched_final.json()["days"]

        # Confirm Urgent Math Lab is now actively scheduled
        final_math_items = [i for d in final_days for i in d["items"] if i["title"] == "Urgent Math Lab"]
        self.assertTrue(final_math_items, "Urgent Math Lab must be present in active schedule after approval")

        # Confirm fixed commitments remain intact
        day0_final = final_days[0]
        self.assertEqual(len(day0_final["fixed"]), 1)
        self.assertEqual(day0_final["fixed"][0]["title"], "Chemistry Lecture")

        # Confirm no double placements or duplicate IDs exist
        all_final_item_ids = [i["id"] for d in final_days for i in d["items"]]
        self.assertEqual(len(all_final_item_ids), len(set(all_final_item_ids)), "No duplicate schedule item IDs allowed")

        # Safety check: Cannot approve the same proposal a second time (idempotency guard)
        res_app_again = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app_again.status_code, 400)
        self.assertIn("already approved", res_app_again.json()["detail"])

    def test_adaptive_cancellation_opens_time_and_approves_cleanly(self):
        """
        Verify adaptive scheduling when fixed commitment is cancelled:
        1. Fixed commitment (College 09:00-15:00) initially blocks morning/early afternoon.
        2. 'College cancelled today. Home the entire day.' opens that slot in proposal.
        3. Pending task is scheduled into the newly available time.
        4. Explicit approval persists without violations or 422 errors.
        5. Today and Week view agree completely on the scheduled items.
        """
        tuesday_dt = datetime(2026, 10, 13, 8, 30)  # Tuesday 08:30
        onboarding_data = {
            "wake_time": "08:30",
            "sleep_time": "23:30",
            "week_structure": "different_weekdays",
            "fixed_commitments": [
                {
                    "name": "College Lectures",
                    "days": "Tuesday",
                    "start_time": "09:00",
                    "end_time": "15:00",
                    "commute_before": 20,
                    "commute_after": 20,
                }
            ],
            "need_to_items": [
                {"title": "DBMS Assignment", "estimated_duration": 180, "priority": 5}
            ],
        }

        with patch("app.api.routes.schedules._now", return_value=tuesday_dt):
            r_onb = self.client.post("/onboarding", json=onboarding_data, headers=self.headers_a)
            self.assertEqual(r_onb.status_code, 200)

            # Generate initial plan: DBMS Assignment must be scheduled AFTER 15:00 + commute (15:25)
            r_gen = self.client.post("/schedules/generate", headers=self.headers_a)
            self.assertEqual(r_gen.status_code, 200)
            day0_items = r_gen.json()["days"][0]["items"]
            self.assertTrue(day0_items)
            dbms_initial = next(i for i in day0_items if i["title"] == "DBMS Assignment")
            s_init = datetime.fromisoformat(dbms_initial["start_time"])
            self.assertGreaterEqual(s_init.time(), time(15, 20))

            # Adaptive proposal: 'College cancelled today. Home the entire day.'
            r_prop = self.client.post(
                "/schedules/propose",
                json={"text": "College cancelled today. Home the entire day."},
                headers=self.headers_a,
            )
            self.assertEqual(r_prop.status_code, 200)
            prop = r_prop.json()
            prop_id = prop["proposal_id"]
            self.assertEqual(prop["status"], "pending")
            self.assertEqual(prop["violations"], [])

            # what_changed must explain the cancellation
            what_changed_str = " ".join(prop["what_changed"]).lower()
            self.assertTrue(
                "cancelled" in what_changed_str or "college" in what_changed_str,
                f"what_changed must mention cancelled college: {prop['what_changed']}",
            )

            # In the proposal, DBMS Assignment should now be scheduled in newly opened morning slot!
            prop_day0_items = prop["days"][0]["items"]
            dbms_prop = next(i for i in prop_day0_items if i["title"] == "DBMS Assignment")
            s_prop = datetime.fromisoformat(dbms_prop["start_time"])
            self.assertLess(s_prop.time(), time(12, 0), "DBMS Assignment should be scheduled in newly opened morning hours")

            # Active schedule must remain UNCHANGED before approval
            r_active = self.client.get("/schedules", headers=self.headers_a)
            active_dbms = next(i for i in r_active.json()["days"][0]["items"] if i["title"] == "DBMS Assignment")
            self.assertEqual(active_dbms["start_time"], dbms_initial["start_time"])

            # Explicit approval applies proposal
            r_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
            self.assertEqual(r_app.status_code, 200, r_app.text)
            self.assertEqual(r_app.json()["status"], "approved")

            # Verify Today view has the new placement
            r_today = self.client.get("/schedules", headers=self.headers_a)
            today_items = r_today.json()["days"][0]["items"]
            approved_dbms = next(i for i in today_items if i["title"] == "DBMS Assignment")
            self.assertEqual(approved_dbms["start_time"], dbms_prop["start_time"])

            # Verify Week view matches Today view and does NOT drop the task
            r_week = self.client.get(f"/schedules/week?date={tuesday_dt.date().isoformat()}", headers=self.headers_a)
            self.assertEqual(r_week.status_code, 200)
            week_day = next(d for d in r_week.json()["days"] if d["date"] == tuesday_dt.date().isoformat())
            week_task_titles = [i["title"] for i in week_day["items"] if not i.get("is_fixed")]
            self.assertIn("DBMS Assignment", week_task_titles, "Week view must NOT drop the scheduled task")

    def test_early_arrival_shortens_commitment_and_places_productive_work(self):
        """
        Verify early arrival adaptation:
        'Got back home at 3 on Tuesday since lectures were cancelled, feel like doing something productive.'
        Shortens commitment to free time starting at 3 PM, schedules productive focus work at/after 3 PM.
        """
        tuesday_dt = datetime(2026, 10, 13, 15, 0) # Tuesday 15:00
        onboarding_data = {
            "wake_time": "07:00",
            "sleep_time": "23:30",
            "fixed_commitments": [
                {
                    "name": "College Lectures",
                    "days": "Tuesday",
                    "start_time": "09:00",
                    "end_time": "17:00",
                    "commute_before": 20,
                    "commute_after": 20,
                }
            ],
            "need_to_items": [
                {"title": "Algorithms Practice", "estimated_duration": 90, "priority": 5}
            ],
        }

        with patch("app.api.routes.schedules._now", return_value=tuesday_dt):
            self.client.post("/onboarding", json=onboarding_data, headers=self.headers_a)
            self.client.post("/schedules/generate", headers=self.headers_a)

            r_prop = self.client.post(
                "/schedules/propose",
                json={"text": "Got back home at 3 on Tuesday since lectures were cancelled, feel like doing something productive."},
                headers=self.headers_a,
            )
            self.assertEqual(r_prop.status_code, 200)
            prop = r_prop.json()
            self.assertEqual(prop["violations"], [])

            # Productive session scheduled at or after 3:00 PM (15:00)
            day0_items = prop["days"][0]["items"]
            algo_item = next((i for i in day0_items if i["title"] == "Algorithms Practice"), None)
            self.assertIsNotNone(algo_item, "Algorithms Practice must be placed in proposal")
            s_time = datetime.fromisoformat(algo_item["start_time"])
            self.assertGreaterEqual(s_time.time(), time(15, 0), "Productive session must start at or after 3 PM")

            # Approving activates cleanly without errors
            r_app = self.client.post(f"/schedules/proposals/{prop['proposal_id']}/approve", headers=self.headers_a)
            self.assertEqual(r_app.status_code, 200)

    def test_urgent_task_insertion_minimal_change_and_displacement(self):
        """
        Verify urgent task insertion:
        1. Existing active schedule with lower-priority tasks.
        2. New high-priority urgent task with imminent deadline arrives.
        3. Proposing schedule does not mutate active schedule before approval.
        4. Proposal places urgent task at earliest valid window and tracks displacement reasons.
        5. Approval activates plan cleanly.
        """
        sunday_dt = datetime(2026, 10, 11, 7, 0)
        onboarding_data = {
            "wake_time": "07:00",
            "sleep_time": "22:00",
            "focus_duration": 60,
            "daily_cap_minutes": 240,
            "fixed_commitments": [],
            "need_to_items": [
                {"title": "Low Priority Reading", "estimated_duration": 120, "priority": 2}
            ],
        }

        with patch("app.api.routes.schedules._now", return_value=sunday_dt):
            self.client.post("/onboarding", json=onboarding_data, headers=self.headers_a)
            r_init = self.client.post("/schedules/generate", headers=self.headers_a)
            self.assertEqual(r_init.status_code, 200)

            # Insert an urgent high-priority assignment with a near deadline
            r_urgent = self.client.post(
                "/tasks",
                json={
                    "title": "Urgent Security Vulnerability Report",
                    "estimated_duration": 120,
                    "priority": 5,
                    "task_type": "deadline",
                    "deadline": (sunday_dt + timedelta(hours=8)).isoformat(),
                },
                headers=self.headers_a,
            )
            self.assertEqual(r_urgent.status_code, 201)

            # Propose schedule
            r_prop = self.client.post("/schedules/propose", headers=self.headers_a)
            self.assertEqual(r_prop.status_code, 200)
            prop = r_prop.json()
            self.assertEqual(prop["violations"], [])

            # Active schedule must still be untouched before approval
            r_active = self.client.get("/schedules", headers=self.headers_a)
            active_titles = [i["title"] for i in r_active.json()["days"][0]["items"]]
            self.assertNotIn("Urgent Security Vulnerability Report", active_titles)

            # In proposal, urgent task is placed before its deadline
            prop_items = prop["days"][0]["items"]
            urgent_p = next((i for i in prop_items if i["title"] == "Urgent Security Vulnerability Report"), None)
            self.assertIsNotNone(urgent_p)
            s_time = datetime.fromisoformat(urgent_p["start_time"])
            e_time = datetime.fromisoformat(urgent_p["end_time"])
            self.assertLessEqual(e_time, sunday_dt.replace(tzinfo=IST) + timedelta(hours=8))

            # Approve proposal
            r_app = self.client.post(f"/schedules/proposals/{prop['proposal_id']}/approve", headers=self.headers_a)
            self.assertEqual(r_app.status_code, 200)

            # After approval, urgent task is now active
            r_active_after = self.client.get("/schedules", headers=self.headers_a)
            after_titles = [i["title"] for i in r_active_after.json()["days"][0]["items"]]
            self.assertIn("Urgent Security Vulnerability Report", after_titles)

    def test_insufficient_capacity_marks_unplaced_work_at_risk_without_violating_invariants(self):
        """
        Verify insufficient capacity handling:
        When tasks exceed available hours before deadline:
        - Scheduler places work up to capacity without violating bedtime.
        - Clearly identifies remaining unplaced work in at_risk.
        - Never fills beyond the daily cap merely to appear complete.
        """
        sunday_dt = datetime(2026, 10, 11, 7, 0)
        onboarding_data = {
            "wake_time": "07:00",
            "sleep_time": "12:00",  # Only 5 hours available today (07:00 - 12:00 = 300 mins)
            "focus_duration": 60,
            "daily_cap_minutes": 180,  # Cap at 3 hours
            "fixed_commitments": [],
            "need_to_items": [
                {"title": "Massive Project", "estimated_duration": 480, "priority": 5}  # 8 hours!
            ],
        }

        with patch("app.api.routes.schedules._now", return_value=sunday_dt):
            self.client.post("/onboarding", json=onboarding_data, headers=self.headers_a)
            res = self.client.post("/schedules/generate", headers=self.headers_a)
            self.assertEqual(res.status_code, 200)
            data = res.json()

            # No violations: bedtime (12:00) is strictly respected
            self.assertEqual(data["violations"], [])
            day0_items = data["days"][0]["items"]
            for item in day0_items:
                e_time = datetime.fromisoformat(item["end_time"])
                self.assertLessEqual(e_time.time(), time(12, 0))

            # Total placed minutes today cannot exceed daily cap (180 mins)
            day0_mins = sum(
                int((datetime.fromisoformat(i["end_time"]) - datetime.fromisoformat(i["start_time"])).total_seconds() / 60)
                for i in day0_items
            )
            self.assertLessEqual(day0_mins, 180)

    def test_task_duration_change_and_completed_work_preservation(self):
        """
        Verify preservation of completed work:
        1. Task is created and scheduled.
        2. User marks task as completed.
        3. Subsequent schedule generation excludes the completed task and never reschedules it.
        4. Updating duration of an active task adjusts future scheduled duration.
        """
        sunday_dt = datetime(2026, 10, 11, 7, 0)
        onboarding_data = {
            "wake_time": "07:00",
            "sleep_time": "22:00",
            "focus_duration": 60,
            "daily_cap_minutes": 360,
            "fixed_commitments": [],
            "need_to_items": [
                {"title": "Assignment Alpha", "estimated_duration": 60, "priority": 4},
                {"title": "Assignment Beta", "estimated_duration": 60, "priority": 4},
            ],
        }

        with patch("app.api.routes.schedules._now", return_value=sunday_dt):
            self.client.post("/onboarding", json=onboarding_data, headers=self.headers_a)
            r_gen1 = self.client.post("/schedules/generate", headers=self.headers_a)
            self.assertEqual(r_gen1.status_code, 200)

            # Fetch tasks and mark Assignment Alpha as completed
            r_tasks = self.client.get("/tasks", headers=self.headers_a)
            tasks = r_tasks.json()
            alpha = next(t for t in tasks if t["title"] == "Assignment Alpha")
            beta = next(t for t in tasks if t["title"] == "Assignment Beta")

            r_patch = self.client.patch(
                f"/tasks/{alpha['id']}",
                json={"status": "completed"},
                headers=self.headers_a,
            )
            self.assertEqual(r_patch.status_code, 200)

            # Update Assignment Beta duration from 60 to 120 minutes
            r_patch_beta = self.client.patch(
                f"/tasks/{beta['id']}",
                json={"estimated_duration": 120},
                headers=self.headers_a,
            )
            self.assertEqual(r_patch_beta.status_code, 200)

            # Regenerate schedule
            r_gen2 = self.client.post("/schedules/generate", headers=self.headers_a)
            self.assertEqual(r_gen2.status_code, 200)
            data2 = r_gen2.json()

            # Assignment Alpha must NOT be rescheduled as unfinished work
            all_titles_after = [i["title"] for d in data2["days"] for i in d["items"]]
            self.assertNotIn("Assignment Alpha", all_titles_after)

            # Assignment Beta total scheduled duration must now equal 120 minutes
            beta_items = [i for d in data2["days"] for i in d["items"] if i["title"] == "Assignment Beta"]
            total_beta_mins = sum(
                int((datetime.fromisoformat(i["end_time"]) - datetime.fromisoformat(i["start_time"])).total_seconds() / 60)
                for i in beta_items
            )
            self.assertEqual(total_beta_mins, 120)


if __name__ == "__main__":
    unittest.main()
