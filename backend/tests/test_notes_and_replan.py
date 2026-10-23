import unittest
import uuid
from datetime import date, datetime, time, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.feedback import Feedback
from app.models.preference import Preference
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.task import Task, TaskType
from app.models.user import User


class TestNotesAndReplan(unittest.TestCase):
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
        self.db.query(Feedback).delete()
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
            hashed_password=hash_password("Pass123!"),
            wake_time=time(7, 0),
            sleep_time=time(23, 0),
        )
        self.db.add(self.user)
        self.db.commit()

        self.token = create_access_token(str(self.user.id))
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        self.db.close()

    def test_notes_understand_exhausted(self):
        res = self.client.post(
            "/notes/understand",
            json={"text": "I am completely exhausted and sick today"},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["kind"], "feedback")
        self.assertIn("exhausted", data["understood"])
        self.assertIn("lighten", data["message"])

    def test_notes_understand_preference(self):
        res = self.client.post(
            "/notes/understand",
            json={"text": "I always prefer deep work in the morning"},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["kind"], "preference")
        self.assertIn("prefer deep work", data["understood"])

    def test_notes_understand_task(self):
        res = self.client.post(
            "/notes/understand",
            json={"text": "I need to submit my physics homework by tomorrow"},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["kind"], "task")
        self.assertIn("upcoming commitment", data["understood"])

    def test_save_note_persists_feedback_and_creates_task(self):
        res = self.client.post(
            "/notes",
            json={"text": "need to finish chemistry lab report", "kind": "task"},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["entry"]["kind"], "task")

        # Verify Feedback row was saved
        fb = self.db.query(Feedback).filter(Feedback.user_id == self.user.id).first()
        self.assertIsNotNone(fb)
        self.assertIn("chemistry lab report", fb.text)

        # Verify Task row was created for scheduler
        task = self.db.query(Task).filter(Task.user_id == self.user.id).first()
        self.assertIsNotNone(task)
        self.assertEqual(task.title, "need to finish chemistry lab report")

    def test_replan_schedule_tired(self):
        today = date.today()
        sched = Schedule(id=uuid.uuid4(), user_id=self.user.id, date=today, version=1)
        self.db.add(sched)
        self.db.flush()

        task = Task(
            id=uuid.uuid4(),
            user_id=self.user.id,
            title="Heavy Calculus Session",
            task_type=TaskType.growth,
            priority=3,
            estimated_duration=90,
        )
        self.db.add(task)
        self.db.flush()

        item = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched.id,
            task_id=task.id,
            start_time=datetime.combine(today, time(18, 0)),
            end_time=datetime.combine(today, time(19, 30)),
            status="scheduled",
        )
        self.db.add(item)
        self.db.commit()

        res = self.client.post(
            "/schedules/replan",
            json={"feedbackText": "Too exhausted to study tonight, need rest", "clarification": ""},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertTrue(any("Lightened" in c for c in data["what_changed"]))

        # Non-negotiable safety guarantee: Replan request MUST NOT silently mutate active schedule!
        item_before_approval = self.db.query(ScheduleItem).filter(ScheduleItem.id == item.id).first()
        self.assertEqual(item_before_approval.status, "scheduled")

        # Must return a reviewable proposal
        self.assertIsNotNone(data["proposal"])
        prop_id = data["proposal"]["proposal_id"]
        self.assertEqual(data["proposal"]["status"], "pending")

        # Explicit approval applies the proposal
        res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers)
        self.assertEqual(res_app.status_code, 200)

        # After approval, verified active schedule reflects the approved proposal
        res_sched = self.client.get(f"/schedules?date={today.isoformat()}", headers=self.headers)
        self.assertEqual(res_sched.status_code, 200)

    def test_replan_schedule_emotion_only_does_not_mutate_or_claim_change(self):
        """Emotion/preference feedback must not claim schedule change or mutate active schedule."""
        today = date.today()
        sched = Schedule(id=uuid.uuid4(), user_id=self.user.id, date=today, version=1)
        self.db.add(sched)
        self.db.commit()

        res = self.client.post(
            "/schedules/replan",
            json={"feedbackText": "I feel calm and happy with my pace", "clarification": ""},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["success"])
        self.assertIsNone(data["proposal"])
        self.assertEqual(data["what_changed"], [])
        self.assertIn("without changing your active schedule", data["message"])

        # Active schedule unchanged
        db_sched = self.db.query(Schedule).filter(Schedule.id == sched.id).first()
        self.assertEqual(db_sched.version, 1)

    def test_replan_schedule_rejection_leaves_schedule_unchanged(self):
        """Rejecting a proposal from replan leaves active schedule completely untouched."""
        today = date.today()
        sched = Schedule(id=uuid.uuid4(), user_id=self.user.id, date=today, version=1)
        self.db.add(sched)
        self.db.commit()

        res = self.client.post(
            "/schedules/replan",
            json={"feedbackText": "Too exhausted to study tonight, need rest", "clarification": ""},
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        prop_id = data["proposal"]["proposal_id"]

        # Reject proposal
        res_rej = self.client.post(f"/schedules/proposals/{prop_id}/reject", headers=self.headers)
        self.assertEqual(res_rej.status_code, 200)
        self.assertEqual(res_rej.json()["status"], "rejected")

        # Active schedule version unchanged
        db_sched = self.db.query(Schedule).filter(Schedule.id == sched.id).first()
        self.assertEqual(db_sched.version, 1)

    def test_week_spread_includes_fixed_commitment_from_onboarding_preferences(self):
        """Even if Monday is before current date, weekly spread displays the recurring commitment."""
        self.client.post(
            "/onboarding",
            json={
                "fixed_commitments": [
                    {
                        "name": "Hospital Rotation",
                        "days": "Monday-Friday",
                        "start_time": "08:30",
                        "end_time": "16:30",
                        "commute_before": 30,
                        "commute_after": 30,
                    }
                ],
                "need_to_items": [],
                "should_do_items": [],
                "like_to_items": [],
            },
            headers=self.headers,
        )

        res = self.client.get("/schedules/week", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        monday_day = next((d for d in data["days"] if d["weekday"] == "Mon"), None)
        self.assertIsNotNone(monday_day)
        # Monday must NOT have 0 blocks / open schedule
        self.assertGreater(len(monday_day["items"]), 0)
        monday_titles = [it["title"] for it in monday_day["items"]]
        self.assertIn("Hospital Rotation", monday_titles)
        rotation_item = next(it for it in monday_day["items"] if it["title"] == "Hospital Rotation")
        self.assertTrue(rotation_item["is_fixed"])


if __name__ == "__main__":
    unittest.main()
