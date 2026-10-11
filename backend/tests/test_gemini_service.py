import importlib
import json
import os
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

import app.services.gemini_service as gemini_service
from app.services.gemini_service import GeminiError, parse_disruption, phrase_reasons


class TestGeminiService(unittest.TestCase):
    def test_import_does_not_require_live_api_key(self):
        """Importing the service must succeed even if GEMINI_API_KEY is not set."""
        with patch.dict(os.environ, {}, clear=True):
            # Reload module to verify import-time behavior
            module = importlib.reload(gemini_service)
            self.assertIsNotNone(module)

    def test_call_without_api_key_raises_gemini_error(self):
        """Calling API without key must raise GeminiError."""
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
            with self.assertRaises(GeminiError) as ctx:
                gemini_service._call_json("test prompt")
            self.assertIn("GEMINI_API_KEY is not set", str(ctx.exception))

    @patch("app.services.gemini_service.httpx.post")
    def test_call_json_uses_httpx_successfully(self, mock_post):
        """Successful call to Gemini using httpx.post."""
        fake_response = MagicMock()
        fake_response.status_code = 200
        fake_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": json.dumps({"blocks": [], "caps": []})}
                        ]
                    }
                }
            ]
        }
        mock_post.return_value = fake_response

        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake_test_key"}):
            res = gemini_service._call_json("test prompt")
            self.assertEqual(res, {"blocks": [], "caps": []})
            mock_post.assert_called_once()
            args, kwargs = mock_post.call_args
            self.assertIn("generativelanguage.googleapis.com", args[0])
            self.assertEqual(kwargs["headers"]["x-goog-api-key"], "fake_test_key")

    @patch("app.services.gemini_service.httpx.post")
    def test_call_json_handles_http_failure(self, mock_post):
        """HTTP failures raise GeminiError."""
        import httpx

        mock_post.side_effect = httpx.HTTPStatusError("Bad Request", request=MagicMock(), response=MagicMock())
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake_test_key"}):
            with self.assertRaises(GeminiError):
                gemini_service._call_json("test prompt")

    @patch("app.services.gemini_service._call_json")
    def test_parse_disruption(self, mock_call):
        """parse_disruption parses blocks and daily caps accurately."""
        mock_call.return_value = {
            "blocks": [
                {"start": "2026-10-12T14:00", "end": "2026-10-12T17:00", "label": "Doctor appointment"}
            ],
            "caps": [
                {"day": "2026-10-12", "max_minutes": 120}
            ]
        }
        now = datetime(2026, 10, 12, 10, 0)
        blocks, caps = parse_disruption("Doctor appointment from 2pm to 5pm, keep today light", now)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["label"], "Doctor appointment")
        self.assertEqual(blocks[0]["start"], datetime(2026, 10, 12, 14, 0))
        self.assertEqual(blocks[0]["end"], datetime(2026, 10, 12, 17, 0))

        self.assertEqual(len(caps), 1)
        self.assertEqual(caps[0]["day"], date(2026, 10, 12))
        self.assertEqual(caps[0]["max_minutes"], 120)

    @patch("app.services.gemini_service._call_json")
    def test_phrase_reasons_fallback_on_error(self, mock_call):
        """phrase_reasons gracefully returns original facts on error."""
        mock_call.side_effect = gemini_service.GeminiError("API quota exceeded")
        facts = ["Moved DSA from 10:00 to 14:00 because Lab ran late."]
        out = phrase_reasons(facts, "Lab ran late")
        self.assertEqual(out, facts)

    @patch("app.services.gemini_service._call_json")
    def test_phrase_reasons_success(self, mock_call):
        """phrase_reasons returns rephrased warm reasons."""
        mock_call.return_value = ["DSA moved to 2pm so you can catch up after your lab."]
        facts = ["Moved DSA from 10:00 to 14:00 because Lab ran late."]
        out = phrase_reasons(facts, "Lab ran late")
        self.assertEqual(out, ["DSA moved to 2pm so you can catch up after your lab."])


if __name__ == "__main__":
    unittest.main()
