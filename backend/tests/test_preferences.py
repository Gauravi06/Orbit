import unittest
import uuid
from datetime import time
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes.preferences import (
    DEFAULT_PREFERENCES,
    get_user_preferences_dict,
    load_user_rule_prefs,
)
from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.preference import Preference
from app.models.user import User


class TestPreferencesEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # In-memory SQLite shared across the thread
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
        # Clean users and preferences
        self.db.query(Preference).delete()
        self.db.query(User).delete()
        self.db.commit()

        # Create test user
        self.user = User(
            id=uuid.uuid4(),
            name="Alice Student",
            email="alice@example.com",
            hashed_password=hash_password("Password123!"),
            wake_time=time(7, 30),
            sleep_time=time(23, 15),
            focus_duration=90,
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

        self.token = create_access_token(str(self.user.id))
        self.auth_headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self):
        self.db.close()

    def _save_pref_row(self, key, value):
        self.db.add(
            Preference(
                user_id=self.user.id,
                preference=key,
                value=value,
                source="preferences",
                confidence=1.0,
            )
        )
        self.db.commit()

    def test_unauthenticated_requests_return_401(self):
        """Unauthenticated requests to protected endpoints return 401."""
        r1 = self.client.get("/preferences")
        self.assertEqual(r1.status_code, 401)

        r2 = self.client.put("/preferences", json={"wake_time": "08:00"})
        self.assertEqual(r2.status_code, 401)

        r3 = self.client.post("/onboarding", json={"wake_time": "08:00"})
        self.assertEqual(r3.status_code, 401)

    def test_get_preferences_returns_user_and_default_values(self):
        """GET /preferences returns defaults populated with existing User table values."""
        res = self.client.get("/preferences", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["wake_time"], "07:30")
        self.assertEqual(data["sleep_time"], "23:15")
        self.assertEqual(data["focus_duration"], 90)
        self.assertEqual(data["focus_length"], 90)
        self.assertTrue(data["allow_splitting"])

    def test_put_preferences_updates_and_persists(self):
        """PUT /preferences saves values in preferences table and syncs User table."""
        payload = {
            "wake_time": "06:45",
            "sleep_time": "22:30",
            "focus_duration": 105,
            "allow_splitting": False,
            "daily_cap_minutes": 360,
        }
        res = self.client.put("/preferences", json=payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["wake_time"], "06:45")
        self.assertEqual(data["sleep_time"], "22:30")
        self.assertEqual(data["focus_duration"], 105)
        self.assertEqual(data["focus_length"], 105)
        self.assertEqual(data["allow_splitting"], False)
        self.assertEqual(data["daily_cap_minutes"], 360)
        self.assertEqual(data["daily_load_cap_mins"], 360)

        # Verify DB persistence
        self.db.expire_all()
        u = self.db.query(User).filter(User.id == self.user.id).first()
        self.assertEqual(u.wake_time, time(6, 45))
        self.assertEqual(u.sleep_time, time(22, 30))
        self.assertEqual(u.focus_duration, 105)

        pref_rows = self.db.query(Preference).filter(Preference.user_id == self.user.id).all()
        pref_dict = {p.preference: (p.value, p.source) for p in pref_rows}
        self.assertIn("wake_time", pref_dict)
        self.assertEqual(pref_dict["wake_time"][0], "06:45")
        self.assertEqual(pref_dict["wake_time"][1], "preferences")

    def test_put_preferences_validation_errors(self):
        """PUT /preferences rejects malformed times and invalid numbers with 422."""
        # Invalid time string
        res = self.client.put("/preferences", json={"wake_time": "25:00"}, headers=self.auth_headers)
        self.assertEqual(res.status_code, 422)

        res = self.client.put("/preferences", json={"sleep_time": "not-a-time"}, headers=self.auth_headers)
        self.assertEqual(res.status_code, 422)

        # Negative duration
        res = self.client.put("/preferences", json={"focus_duration": -10}, headers=self.auth_headers)
        self.assertEqual(res.status_code, 422)

    def test_post_onboarding_saves_answers(self):
        """POST /onboarding records source='onboarding' and persists arbitrary answer structures."""
        onboarding_payload = {
            "wake_time": "08:00",
            "sleep_time": "00:00",
            "focus_style": "long",
            "focus_length": 120,
            "energy_preference": "morning",
            "fixed_commitments": [
                {"name": "OS Lab", "days": "Mon, Wed", "start_time": "14:00", "end_time": "17:00"}
            ],
            "need_to_items": ["DSA Practice", "Math Assignment"],
            "palette": "terracotta",
            "mode": "paper",
        }
        res = self.client.post("/onboarding", json=onboarding_payload, headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["wake_time"], "08:00")
        self.assertEqual(data["sleep_time"], "00:00")
        self.assertEqual(data["focus_length"], 120)
        self.assertEqual(data["focus_duration"], 120)
        self.assertEqual(len(data["fixed_commitments"]), 1)
        self.assertEqual(data["palette"], "terracotta")

        # Check source is recorded as onboarding
        rows = self.db.query(Preference).filter(Preference.user_id == self.user.id).all()
        for r in rows:
            self.assertEqual(r.source, "onboarding")

    # ---- focus alias regression coverage -------------------------------

    def test_default_focus_aliases_agree_at_120(self):
        """With nothing saved and no User focus value, both aliases default to 120."""
        self.assertEqual(DEFAULT_PREFERENCES["focus_length"], DEFAULT_PREFERENCES["focus_duration"])
        self.assertEqual(DEFAULT_PREFERENCES["focus_duration"], 120)

        # In-memory only (session has autoflush=False, so nothing is written)
        self.user.focus_duration = None
        prefs = get_user_preferences_dict(self.db, self.user)
        self.assertEqual(prefs["focus_duration"], 120)
        self.assertEqual(prefs["focus_length"], 120)

    def test_only_saved_focus_length_populates_both_aliases(self):
        """A saved focus_length alone sets both keys, beating the User column value (90)."""
        self._save_pref_row("focus_length", "75")
        prefs = get_user_preferences_dict(self.db, self.user)
        self.assertEqual(prefs["focus_length"], 75)
        self.assertEqual(prefs["focus_duration"], 75)

        # Same through the API response
        data = self.client.get("/preferences", headers=self.auth_headers).json()
        self.assertEqual(data["focus_length"], 75)
        self.assertEqual(data["focus_duration"], 75)

    def test_only_saved_focus_duration_populates_both_aliases(self):
        """A saved focus_duration alone sets both keys, not the default focus_length."""
        self._save_pref_row("focus_duration", "45")
        prefs = get_user_preferences_dict(self.db, self.user)
        self.assertEqual(prefs["focus_duration"], 45)
        self.assertEqual(prefs["focus_length"], 45)

    def test_conflicting_saved_focus_aliases_resolve_to_focus_duration(self):
        """Legacy rows with different alias values are reconciled; focus_duration wins."""
        self._save_pref_row("focus_duration", "60")
        self._save_pref_row("focus_length", "30")
        prefs = get_user_preferences_dict(self.db, self.user)
        self.assertEqual(prefs["focus_duration"], 60)
        self.assertEqual(prefs["focus_length"], 60)

    def test_load_user_rule_prefs_uses_reconciled_focus_duration(self):
        """Scheduler Prefs get the reconciled focus duration and saved wake/sleep."""
        self._save_pref_row("focus_length", "75")
        self._save_pref_row("wake_time", "06:15")
        self._save_pref_row("sleep_time", "22:45")

        rule_prefs = load_user_rule_prefs(self.db, self.user)
        self.assertEqual(rule_prefs.focus_duration, 75)
        self.assertEqual(rule_prefs.wake, time(6, 15))
        self.assertEqual(rule_prefs.sleep, time(22, 45))

    def test_load_user_rule_prefs_default_focus_duration_is_120(self):
        """With no saved or User focus value, Prefs.focus_duration is 120."""
        self.user.focus_duration = None  # in-memory only, not flushed
        rule_prefs = load_user_rule_prefs(self.db, self.user)
        self.assertEqual(rule_prefs.focus_duration, 120)


if __name__ == "__main__":
    unittest.main()