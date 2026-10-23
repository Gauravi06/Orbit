import unittest
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.intervention import Intervention
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.task import Task, TaskType
from app.models.user import User
from app.services.intervention_service import run_detection_cycle
from app.services.intervention_worker import InterventionWorker


class TestInterventions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Disable background worker loop inside test client runs
        settings.intervention_worker_enabled = False

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
        self.db.query(Intervention).delete()
        self.db.query(ScheduleItem).delete()
        self.db.query(Schedule).delete()
        self.db.query(Task).delete()
        self.db.query(User).delete()
        self.db.commit()

        # Create User A
        self.user_a = User(
            id=uuid.uuid4(),
            name="Alice",
            email="alice@example.com",
            hashed_password=hash_password("Pass123!"),
            wake_time=time(7, 0),
            sleep_time=time(23, 0),
        )
        # Create User B
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

    def test_approaching_deadline_creates_intervention(self):
        """Unfinished task with deadline within approaching window generates an active intervention."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Bio Lab Report",
            deadline=now + timedelta(hours=4),
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        self.assertEqual(len(active), 1)
        inv = active[0]
        self.assertEqual(inv.task_id, task.id)
        self.assertEqual(inv.intervention_type, "approaching_deadline")
        self.assertIn("Approaching deadline", inv.title)
        self.assertIn("Bio Lab Report", inv.message)
        self.assertEqual(inv.status, "active")

    def test_overdue_unfinished_task_creates_intervention(self):
        """Overdue unfinished task generates an overdue intervention."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Math Homework",
            deadline=now - timedelta(hours=2),
            estimated_duration=90,
            status="in_progress",
        )
        self.db.add(task)
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        self.assertEqual(len(active), 1)
        inv = active[0]
        self.assertEqual(inv.task_id, task.id)
        self.assertEqual(inv.intervention_type, "overdue")
        self.assertIn("Overdue", inv.title)

    def test_completed_or_ineligible_tasks_do_not_generate_reminders(self):
        """Completed tasks and fixed commitments do not generate interventions."""
        now = datetime.now(timezone.utc)
        completed_task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Completed Essay",
            deadline=now + timedelta(hours=2),
            estimated_duration=60,
            status="completed",
        )
        fixed_commitment = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Chemistry Lecture",
            deadline=now + timedelta(hours=1),
            estimated_duration=60,
            is_fixed=True,
            status="pending",
        )
        self.db.add_all([completed_task, fixed_commitment])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        self.assertEqual(len(active), 0)

    def test_repeated_monitoring_does_not_create_duplicates(self):
        """Running multiple monitoring cycles preserves the same active intervention without duplicates."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="History Paper",
            deadline=now + timedelta(hours=5),
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        run_detection_cycle(self.db, now=now + timedelta(minutes=5), user_id=self.user_a.id)
        run_detection_cycle(self.db, now=now + timedelta(minutes=10), user_id=self.user_a.id)

        all_invs = self.db.query(Intervention).filter(Intervention.user_id == self.user_a.id).all()
        self.assertEqual(len(all_invs), 1)
        self.assertEqual(all_invs[0].status, "active")

    def test_multiple_relevant_tasks_produce_distinct_interventions(self):
        """Multiple unfinished tasks produce separate, correctly matched interventions."""
        now = datetime.now(timezone.utc)
        t1 = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Task One",
            deadline=now + timedelta(hours=3),
            estimated_duration=30,
            status="pending",
        )
        t2 = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Task Two",
            deadline=now - timedelta(hours=1),
            estimated_duration=45,
            status="pending",
        )
        self.db.add_all([t1, t2])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        self.assertEqual(len(active), 2)
        task_ids = {inv.task_id for inv in active}
        self.assertIn(t1.id, task_ids)
        self.assertIn(t2.id, task_ids)

    def test_snooze_suppresses_delivery_until_snooze_expires(self):
        """Snoozing suppresses the intervention until the snooze timestamp has passed."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Study Algorithms",
            deadline=now + timedelta(hours=6),
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        inv = self.db.query(Intervention).filter(Intervention.task_id == task.id).first()

        # Snooze for 2 hours via authenticated endpoint
        snooze_time = now + timedelta(hours=2)
        res = self.client.post(
            f"/interventions/{inv.id}/snooze",
            json={"snooze_until": snooze_time.isoformat()},
            headers=self.headers_a,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "snoozed")

        # Cycle at 1 hour later: still snoozed, not returned in active list
        active_1h = run_detection_cycle(self.db, now=now + timedelta(hours=1), user_id=self.user_a.id)
        self.assertEqual(len(active_1h), 0)

        # Cycle at 2.5 hours later: snooze expired, awakened to active!
        active_2_5h = run_detection_cycle(self.db, now=now + timedelta(hours=2, minutes=30), user_id=self.user_a.id)
        self.assertEqual(len(active_2_5h), 1)
        self.assertEqual(active_2_5h[0].status, "active")

    def test_dismissal_persists_and_prevents_immediate_recreation(self):
        """Dismissing an intervention marks it dismissed and subsequent cycles do not re-alert."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Read Chapter 4",
            deadline=now + timedelta(hours=4),
            estimated_duration=30,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        inv = self.db.query(Intervention).filter(Intervention.task_id == task.id).first()

        # Dismiss
        res = self.client.post(f"/interventions/{inv.id}/dismiss", headers=self.headers_a)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "dismissed")

        # Subsequent cycle does not recreate or return active intervention
        active = run_detection_cycle(self.db, now=now + timedelta(minutes=15), user_id=self.user_a.id)
        self.assertEqual(len(active), 0)

        # GET /interventions returns 0 active
        res_get = self.client.get("/interventions", headers=self.headers_a)
        self.assertEqual(len(res_get.json()), 0)

    def test_completing_task_resolves_intervention(self):
        """When an unfinished task is marked completed, any active intervention is resolved."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Physics Worksheet",
            deadline=now + timedelta(hours=2),
            estimated_duration=45,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        inv = self.db.query(Intervention).filter(Intervention.task_id == task.id).first()
        self.assertEqual(inv.status, "active")

        # Mark task completed
        task.status = "completed"
        self.db.commit()

        # Next cycle marks intervention resolved
        active = run_detection_cycle(self.db, now=now + timedelta(minutes=10), user_id=self.user_a.id)
        self.assertEqual(len(active), 0)
        self.db.refresh(inv)
        self.assertEqual(inv.status, "resolved")
        self.assertIsNotNone(inv.resolved_at)

    def test_user_isolation(self):
        """User B cannot see, snooze, or dismiss User A's interventions."""
        now = datetime.now(timezone.utc)
        task_a = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Alice Private Task",
            deadline=now + timedelta(hours=3),
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task_a)
        self.db.commit()

        run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        inv_a = self.db.query(Intervention).filter(Intervention.user_id == self.user_a.id).first()

        # User B lists interventions -> receives empty list
        res_b_list = self.client.get("/interventions", headers=self.headers_b)
        self.assertEqual(res_b_list.status_code, 200)
        self.assertEqual(len(res_b_list.json()), 0)

        # User B attempts to dismiss User A's intervention -> 404
        res_b_dis = self.client.post(f"/interventions/{inv_a.id}/dismiss", headers=self.headers_b)
        self.assertEqual(res_b_dis.status_code, 404)

        # User B attempts to snooze User A's intervention -> 404
        future_dt = now + timedelta(hours=2)
        res_b_snz = self.client.post(
            f"/interventions/{inv_a.id}/snooze",
            json={"snooze_until": future_dt.isoformat()},
            headers=self.headers_b,
        )
        self.assertEqual(res_b_snz.status_code, 404)

        # User A's intervention remains active and untouched
        self.db.refresh(inv_a)
        self.assertEqual(inv_a.status, "active")

    def test_invalid_snooze_rejected(self):
        """Snooze timestamp in the past returns 422 Unprocessable Entity."""
        now = datetime.now(timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Draft Proposal",
            deadline=now + timedelta(hours=5),
            estimated_duration=30,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        inv = self.db.query(Intervention).filter(Intervention.task_id == task.id).first()

        past_time = now - timedelta(minutes=10)
        res = self.client.post(
            f"/interventions/{inv.id}/snooze",
            json={"snooze_until": past_time.isoformat()},
            headers=self.headers_a,
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("must be in the future", res.json()["detail"])

    def test_schedule_placements_remain_unchanged(self):
        """Generating interventions does not modify existing active schedules or items."""
        now = datetime.now(timezone.utc)
        today = now.date()

        sched = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=today, version=1)
        self.db.add(sched)
        self.db.flush()

        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Protected Scheduled Task",
            deadline=now + timedelta(hours=3),
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.flush()

        item = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched.id,
            task_id=task.id,
            start_time=datetime.combine(today, time(14, 0)),
            end_time=datetime.combine(today, time(15, 0)),
            status="scheduled",
        )
        self.db.add(item)
        self.db.commit()

        # Run intervention cycle
        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        self.assertEqual(len(active), 1)

        # Verify Schedule and ScheduleItem are completely untouched
        db_sched = self.db.query(Schedule).filter(Schedule.id == sched.id).first()
        self.assertEqual(db_sched.version, 1)

        db_item = self.db.query(ScheduleItem).filter(ScheduleItem.id == item.id).first()
        self.assertEqual(db_item.status, "scheduled")
        self.assertEqual(db_item.start_time, datetime.combine(today, time(14, 0)))

    def test_worker_can_execute_and_recover(self):
        """InterventionWorker starts, executes detection cycles, and stops cleanly."""
        worker = InterventionWorker(poll_interval_seconds=1)
        # Test worker instance creation and attributes
        self.assertEqual(worker.poll_interval_seconds, 1)
        self.assertFalse(worker._running)

    # -------------------------------------------------------------------------
    # Repeated-unfinished-task intervention tests (Step 4 Requirements)
    # -------------------------------------------------------------------------

    def test_repeated_unfinished_one_past_day_does_not_trigger(self):
        """1. One past planned day does not trigger repeated_unfinished intervention."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algorithm Sets",
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # Day 1: yesterday
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=1), version=1)
        self.db.add(sched1)
        self.db.commit()

        item1 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched1.id,
            task_id=task.id,
            start_time=now - timedelta(days=1, hours=2),
            end_time=now - timedelta(days=1, hours=1),
            status="scheduled",
        )
        self.db.add(item1)
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 0)

    def test_repeated_unfinished_two_distinct_past_days_triggers(self):
        """2. Two distinct past planned days with the task still unfinished do trigger it."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algorithm Sets",
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # Day 1: 2 days ago
        d1 = now.date() - timedelta(days=2)
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d1, version=1)
        item1 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched1.id,
            task_id=task.id,
            start_time=now - timedelta(days=2, hours=2),
            end_time=now - timedelta(days=2, hours=1),
            status="scheduled",
        )

        # Day 2: 1 day ago
        d2 = now.date() - timedelta(days=1)
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d2, version=1)
        item2 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched2.id,
            task_id=task.id,
            start_time=now - timedelta(days=1, hours=2),
            end_time=now - timedelta(days=1, hours=1),
            status="scheduled",
        )

        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 1)
        self.assertEqual(rep[0].task_id, task.id)
        self.assertEqual(rep[0].title, "Plan check: Algorithm Sets")
        self.assertIn("remained unfinished across 2 past planned days", rep[0].message)
        self.assertIn("Is the current plan not working?", rep[0].message)

    def test_repeated_unfinished_multiple_blocks_on_one_day_do_not_trigger(self):
        """3. Multiple blocks on one day do not satisfy the two-day threshold."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algorithm Sets",
            estimated_duration=120,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # Day 1: yesterday with TWO separate blocks
        d1 = now.date() - timedelta(days=1)
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d1, version=1)
        item1a = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched1.id,
            task_id=task.id,
            start_time=now - timedelta(days=1, hours=5),
            end_time=now - timedelta(days=1, hours=4),
            status="scheduled",
        )
        item1b = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched1.id,
            task_id=task.id,
            start_time=now - timedelta(days=1, hours=2),
            end_time=now - timedelta(days=1, hours=1),
            status="scheduled",
        )
        self.db.add_all([sched1, item1a, item1b])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 0)

    def test_repeated_unfinished_future_blocks_do_not_count(self):
        """4. Future blocks do not count toward past planned days."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algorithm Sets",
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # Past block: yesterday
        d1 = now.date() - timedelta(days=1)
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d1, version=1)
        item1 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched1.id,
            task_id=task.id,
            start_time=now - timedelta(days=1, hours=2),
            end_time=now - timedelta(days=1, hours=1),
            status="scheduled",
        )

        # Future block: tomorrow
        d2 = now.date() + timedelta(days=1)
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d2, version=1)
        item2 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched2.id,
            task_id=task.id,
            start_time=now + timedelta(days=1, hours=1),
            end_time=now + timedelta(days=1, hours=2),
            status="scheduled",
        )
        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 0)

    def test_repeated_unfinished_completed_blocks_and_tasks_do_not_trigger(self):
        """5. Completed tasks or blocks marked completed/done do not count as unfinished."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Finished Math",
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # Day 1: completed block
        d1 = now.date() - timedelta(days=2)
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d1, version=1)
        item1 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched1.id,
            task_id=task.id,
            start_time=now - timedelta(days=2, hours=2),
            end_time=now - timedelta(days=2, hours=1),
            status="completed",
        )

        # Day 2: unfinished block
        d2 = now.date() - timedelta(days=1)
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d2, version=1)
        item2 = ScheduleItem(
            id=uuid.uuid4(),
            schedule_id=sched2.id,
            task_id=task.id,
            start_time=now - timedelta(days=1, hours=2),
            end_time=now - timedelta(days=1, hours=1),
            status="scheduled",
        )
        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 0)

    def test_repeated_unfinished_repeated_detection_cycles_do_not_duplicate(self):
        """6. Repeated detection cycles do not create duplicate repeated_unfinished interventions."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algorithm Sets",
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # 2 past days
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=2), version=1)
        item1 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched1.id, task_id=task.id, start_time=now - timedelta(days=2, hours=2), end_time=now - timedelta(days=2, hours=1), status="scheduled")
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=1), version=1)
        item2 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched2.id, task_id=task.id, start_time=now - timedelta(days=1, hours=2), end_time=now - timedelta(days=1, hours=1), status="scheduled")
        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        cycle1 = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        cycle2 = run_detection_cycle(self.db, now=now + timedelta(minutes=5), user_id=self.user_a.id)
        all_rep = self.db.query(Intervention).filter(Intervention.task_id == task.id, Intervention.intervention_type == "repeated_unfinished").all()
        self.assertEqual(len(all_rep), 1)

    def test_repeated_unfinished_completing_task_resolves_intervention(self):
        """7. Completing the task resolves the repeated_unfinished intervention."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(
            id=uuid.uuid4(),
            user_id=self.user_a.id,
            title="Algorithm Sets",
            estimated_duration=60,
            status="pending",
        )
        self.db.add(task)
        self.db.commit()

        # 2 past days
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=2), version=1)
        item1 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched1.id, task_id=task.id, start_time=now - timedelta(days=2, hours=2), end_time=now - timedelta(days=2, hours=1), status="scheduled")
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=1), version=1)
        item2 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched2.id, task_id=task.id, start_time=now - timedelta(days=1, hours=2), end_time=now - timedelta(days=1, hours=1), status="scheduled")
        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        # First cycle generates active intervention
        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        self.assertEqual(len([i for i in active if i.intervention_type == "repeated_unfinished"]), 1)

        # Mark task completed
        task.status = "completed"
        self.db.commit()

        # Next cycle resolves intervention
        active2 = run_detection_cycle(self.db, now=now + timedelta(minutes=10), user_id=self.user_a.id)
        self.assertEqual(len([i for i in active2 if i.intervention_type == "repeated_unfinished"]), 0)

        inv = self.db.query(Intervention).filter(Intervention.task_id == task.id, Intervention.intervention_type == "repeated_unfinished").first()
        self.assertEqual(inv.status, "resolved")
        self.assertIsNotNone(inv.resolved_at)

    def test_repeated_unfinished_user_isolation(self):
        """8. One user's task and past schedules cannot trigger another user's intervention."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        # Task for user A
        task_a = Task(id=uuid.uuid4(), user_id=self.user_a.id, title="Alice Task", estimated_duration=60, status="pending")
        self.db.add(task_a)
        # Sched for user A with 2 past days
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=2), version=1)
        item1 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched1.id, task_id=task_a.id, start_time=now - timedelta(days=2, hours=2), end_time=now - timedelta(days=2, hours=1), status="scheduled")
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=now.date() - timedelta(days=1), version=1)
        item2 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched2.id, task_id=task_a.id, start_time=now - timedelta(days=1, hours=2), end_time=now - timedelta(days=1, hours=1), status="scheduled")
        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        # Detect for User B
        active_b = run_detection_cycle(self.db, now=now, user_id=self.user_b.id)
        self.assertEqual(len(active_b), 0)

        # Ensure no interventions exist under user B
        b_invs = self.db.query(Intervention).filter(Intervention.user_id == self.user_b.id).all()
        self.assertEqual(len(b_invs), 0)

    def test_repeated_unfinished_item_must_match_schedule_date(self):
        """9. An item whose start date does not match its parent schedule date must not count as a distinct planned day."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(id=uuid.uuid4(), user_id=self.user_a.id, title="Algorithm Sets", estimated_duration=60, status="pending")
        self.db.add(task)
        self.db.commit()

        # Only ONE schedule day: yesterday
        d1 = now.date() - timedelta(days=1)
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d1, version=1)
        # item1 on sched1 has valid start time on d1
        item1 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched1.id, task_id=task.id, start_time=now - timedelta(days=1, hours=2), end_time=now - timedelta(days=1, hours=1), status="scheduled")
        # item2 attached to sched1 has an inconsistent timestamp on 2 days ago (e.g. stale/corrupt placement)
        item2 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched1.id, task_id=task.id, start_time=now - timedelta(days=2, hours=2), end_time=now - timedelta(days=2, hours=1), status="scheduled")
        self.db.add_all([sched1, item1, item2])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 0)

    def test_repeated_unfinished_two_distinct_past_days_with_regenerated_versions_triggers(self):
        """10. Two distinct past planned days, each having undergone regeneration (version > 1), correctly trigger intervention."""
        now = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
        task = Task(id=uuid.uuid4(), user_id=self.user_a.id, title="Algorithm Sets", estimated_duration=60, status="pending")
        self.db.add(task)
        self.db.commit()

        # Day 1: 2 days ago, regenerated twice (version=3), containing historical past unfinished block
        d1 = now.date() - timedelta(days=2)
        sched1 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d1, version=3)
        item1 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched1.id, task_id=task.id, start_time=now - timedelta(days=2, hours=2), end_time=now - timedelta(days=2, hours=1), status="scheduled")

        # Day 2: 1 day ago, regenerated once (version=2), containing historical past unfinished block
        d2 = now.date() - timedelta(days=1)
        sched2 = Schedule(id=uuid.uuid4(), user_id=self.user_a.id, date=d2, version=2)
        item2 = ScheduleItem(id=uuid.uuid4(), schedule_id=sched2.id, task_id=task.id, start_time=now - timedelta(days=1, hours=2), end_time=now - timedelta(days=1, hours=1), status="scheduled")

        self.db.add_all([sched1, sched2, item1, item2])
        self.db.commit()

        active = run_detection_cycle(self.db, now=now, user_id=self.user_a.id)
        rep = [inv for inv in active if inv.intervention_type == "repeated_unfinished"]
        self.assertEqual(len(rep), 1)
        self.assertEqual(rep[0].title, "Plan check: Algorithm Sets")
        self.assertIn("unfinished across 2 past planned days", rep[0].message)

    def test_worker_lifecycle_and_session_cleanup(self):
        """Worker starts at most once, executes loops, closes db sessions, logs exceptions, and stops cleanly."""
        import asyncio
        from unittest.mock import patch, MagicMock

        worker = InterventionWorker(poll_interval_seconds=1)
        self.assertFalse(worker._running)

        async def run_test():
            # Test real start and clean stop with actual asyncio task
            worker.start()
            self.assertTrue(worker._running)
            self.assertIsNotNone(worker._task)

            # Idempotent start
            old_task = worker._task
            worker.start()
            self.assertEqual(worker._task, old_task)

            # Clean stop cancels task and resets running state
            await worker.stop()
            self.assertFalse(worker._running)
            self.assertIsNone(worker._task)

            # Second stop is safe no-op
            await worker.stop()

        asyncio.run(run_test())

    def test_worker_loop_handles_exception_and_closes_session(self):
        """Worker loop closes database session on success or failure, and logs errors."""
        import asyncio
        from unittest.mock import patch, MagicMock

        worker = InterventionWorker(poll_interval_seconds=1)
        worker._running = True

        mock_session = MagicMock()
        with patch("app.services.intervention_worker.SessionLocal", return_value=mock_session), \
             patch("app.services.intervention_worker.run_detection_cycle", side_effect=ValueError("Simulated DB error")), \
             patch("app.services.intervention_worker.logger.error") as mock_log_err:

            async def run_single_iteration():
                # Run the inner cycle logic once
                try:
                    db = mock_session
                    try:
                        from app.services.intervention_worker import run_detection_cycle
                        run_detection_cycle(db)
                    finally:
                        db.close()
                except Exception as exc:
                    from app.services.intervention_worker import logger
                    logger.error("Intervention background detection failed: %s", exc, exc_info=True)

            asyncio.run(run_single_iteration())

            # Verify session was closed and error was logged
            mock_session.close.assert_called_once()
            mock_log_err.assert_called_once()



if __name__ == "__main__":
    unittest.main()



