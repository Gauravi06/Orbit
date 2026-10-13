import json
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
from app.models.schedule_proposal import ScheduleProposal
from app.models.task import Task, TaskType
from app.models.user import User

IST = timezone(timedelta(hours=5, minutes=30))
FIXED_NOW = datetime(2026, 10, 11, 5, 0)
FIXED_DAY = FIXED_NOW.date()


def _fixed_now():
    return patch("app.api.routes.schedules._now", return_value=FIXED_NOW)


class TestScheduleProposals(unittest.TestCase):
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
        self.db.query(ScheduleProposal).delete()
        self.db.query(Task).delete()
        self.db.query(Preference).delete()
        self.db.query(User).delete()
        self.db.commit()

        # User A
        self.user_a = User(
            id=uuid.uuid4(),
            name="Alice",
            email="alice@example.com",
            hashed_password=hash_password("Pass123!"),
            wake_time=time(7, 0),
            sleep_time=time(23, 0),
        )
        # User B
        self.user_b = User(
            id=uuid.uuid4(),
            name="Bob",
            email="bob@example.com",
            hashed_password=hash_password("Pass123!"),
            wake_time=time(8, 0),
            sleep_time=time(22, 0),
        )
        self.db.add_all([self.user_a, self.user_b])
        self.db.commit()

        self.token_a = create_access_token(str(self.user_a.id))
        self.token_b = create_access_token(str(self.user_b.id))
        self.headers_a = {"Authorization": f"Bearer {self.token_a}"}
        self.headers_b = {"Authorization": f"Bearer {self.token_b}"}

    def tearDown(self):
        self.db.close()

    def test_proposing_does_not_mutate_active_schedule(self):
        """Proposing a schedule generates a proposal record but does NOT create active Schedule or ScheduleItem records."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Study Networks",
            estimated_duration=120,
            priority=4,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        # Propose
        with _fixed_now():
            res = self.client.post("/schedules/propose", headers=self.headers_a)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("proposal_id", data)
        self.assertEqual(data["status"], "pending")
        self.assertGreater(len(data["days"]), 0)

        # Check DB: active Schedule and ScheduleItem must be EMPTY
        sched_count = self.db.query(Schedule).filter(Schedule.user_id == self.user_a.id).count()
        item_count = self.db.query(ScheduleItem).count()
        self.assertEqual(sched_count, 0)
        self.assertEqual(item_count, 0)

        # Check DB: proposal record exists
        prop = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(data["proposal_id"])).first()
        self.assertIsNotNone(prop)
        self.assertEqual(prop.status, "pending")
        self.assertEqual(prop.user_id, self.user_a.id)

    def test_approve_persists_exact_placements(self):
        """Approving a proposal commits the exact proposed placements into the active schedule."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Operating Systems",
            estimated_duration=90,
            priority=5,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        data_prop = res_prop.json()
        prop_id = data_prop["proposal_id"]

        # Extract proposed items
        proposed_items = [i for day in data_prop["days"] for i in day["items"] if i["title"] == "Operating Systems"]
        self.assertEqual(len(proposed_items), 1)
        expected_start = proposed_items[0]["start_time"]
        expected_end = proposed_items[0]["end_time"]

        # Approve proposal
        with _fixed_now():
            res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app.status_code, 200)
        data_app = res_app.json()
        self.assertEqual(data_app["status"], "approved")

        # Verify active schedule has been created and matches proposed placement
        with _fixed_now():
            res_sched = self.client.get("/schedules", headers=self.headers_a)
        self.assertEqual(res_sched.status_code, 200)
        active_items = [i for day in res_sched.json()["days"] for i in day["items"] if i["title"] == "Operating Systems"]
        self.assertEqual(len(active_items), 1)
        self.assertEqual(active_items[0]["start_time"], expected_start)
        self.assertEqual(active_items[0]["end_time"], expected_end)

        # Verify proposal status in DB is marked approved
        prop_db = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(prop_id)).first()
        self.assertEqual(prop_db.status, "approved")

        # Attempting to approve again fails with 400
        res_repeat = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_repeat.status_code, 400)
        self.assertIn("already approved", res_repeat.json()["detail"])

    def test_rejection_leaves_active_schedule_unchanged(self):
        """Rejecting a proposal marks proposal as rejected and leaves existing active schedule completely untouched."""
        # Create an existing active schedule
        task1 = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Initial Task",
            estimated_duration=60,
            priority=3,
            task_type=TaskType.growth,
        )
        self.db.add(task1)
        self.db.commit()

        with _fixed_now():
            self.client.post("/schedules/generate", headers=self.headers_a)

        # Capture initial active items
        initial_items = self.client.get("/schedules", headers=self.headers_a).json()["days"]

        # Propose a new schedule with a disruption
        with _fixed_now():
            res_prop = self.client.post(
                "/schedules/propose",
                json={
                    "blocks": [
                        {"start": "2026-10-11T09:00", "end": "2026-10-11T12:00", "label": "Doctor"}
                    ]
                },
                headers=self.headers_a,
            )
        prop_id = res_prop.json()["proposal_id"]

        # Reject proposal
        res_rej = self.client.post(f"/schedules/proposals/{prop_id}/reject", headers=self.headers_a)
        self.assertEqual(res_rej.status_code, 200)
        self.assertEqual(res_rej.json()["status"], "rejected")

        # Verify active schedule is completely identical to initial
        current_items = self.client.get("/schedules", headers=self.headers_a).json()["days"]
        self.assertEqual(initial_items, current_items)

        # Proposal in DB is marked rejected
        prop_db = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(prop_id)).first()
        self.assertEqual(prop_db.status, "rejected")

        # Attempting to reject again fails with 400
        res_repeat = self.client.post(f"/schedules/proposals/{prop_id}/reject", headers=self.headers_a)
        self.assertEqual(res_repeat.status_code, 400)
        self.assertIn("already rejected", res_repeat.json()["detail"])

    def test_proposal_user_isolation(self):
        """User B cannot view, approve, or reject User A's proposal (returns 404)."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Alice Private Task",
            estimated_duration=60,
            priority=3,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        prop_id = res_prop.json()["proposal_id"]

        # User B attempts to view
        r_get = self.client.get(f"/schedules/proposals/{prop_id}", headers=self.headers_b)
        self.assertEqual(r_get.status_code, 404)

        # User B attempts to approve
        r_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_b)
        self.assertEqual(r_app.status_code, 404)

        # User B attempts to reject
        r_rej = self.client.post(f"/schedules/proposals/{prop_id}/reject", headers=self.headers_b)
        self.assertEqual(r_rej.status_code, 404)

        # Proposal remains intact and pending for Alice
        prop_db = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(prop_id)).first()
        self.assertEqual(prop_db.status, "pending")

    def test_stale_proposals_rejected_safely_when_tasks_change(self):
        """If tasks change after proposal generation, approval is rejected with 409 Conflict."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Database Assignment",
            estimated_duration=120,
            priority=4,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        prop_id = res_prop.json()["proposal_id"]

        # User modifies task before approving
        task.estimated_duration = 180
        self.db.commit()

        # Approval must detect staleness and reject
        with _fixed_now():
            res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app.status_code, 409)
        self.assertIn("stale", res_app.json()["detail"].lower())

        # Proposal status marked stale in DB
        prop_db = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(prop_id)).first()
        self.assertEqual(prop_db.status, "stale")

    def test_stale_proposals_rejected_safely_when_preferences_change(self):
        """If user preferences change after proposal generation, approval is rejected with 409 Conflict."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algebra Practice",
            estimated_duration=60,
            priority=3,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        prop_id = res_prop.json()["proposal_id"]

        # Change user wake time
        self.client.put("/preferences", json={"wake_time": "09:00"}, headers=self.headers_a)

        # Approval must detect staleness
        with _fixed_now():
            res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app.status_code, 409)
        self.assertIn("stale", res_app.json()["detail"].lower())

    def test_expired_proposal_rejected(self):
        """Expired proposals are rejected on approval."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Physics Lab",
            estimated_duration=60,
            priority=3,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        prop_id = res_prop.json()["proposal_id"]

        # Manually expire in DB
        prop = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(prop_id)).first()
        prop.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        self.db.commit()

        with _fixed_now():
            res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app.status_code, 400)
        self.assertIn("expired", res_app.json()["detail"].lower())

    def test_invalid_proposal_placements_rejected(self):
        """A proposal corrupted or manually tampered with invalid placements is rejected."""
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Integrity Test",
            estimated_duration=60,
            priority=3,
            task_type=TaskType.growth,
        )
        self.db.add(task)
        self.db.commit()

        with _fixed_now():
            res_prop = self.client.post("/schedules/propose", headers=self.headers_a)
        prop_id = res_prop.json()["proposal_id"]

        # Tamper placements to be outside wake/sleep window (e.g. 02:00 AM)
        prop = self.db.query(ScheduleProposal).filter(ScheduleProposal.id == uuid.UUID(prop_id)).first()
        tampered_placements = [
            {
                "task_id": str(task.id),
                "title": "Integrity Test",
                "start": "2026-10-11T02:00:00",
                "end": "2026-10-11T03:00:00",
            }
        ]
        prop.placements_json = json.dumps(tampered_placements)
        self.db.commit()

        with _fixed_now():
            res_app = self.client.post(f"/schedules/proposals/{prop_id}/approve", headers=self.headers_a)
        self.assertEqual(res_app.status_code, 422)
        self.assertIn("invalid", res_app.json()["detail"].lower())


if __name__ == "__main__":
    unittest.main()
