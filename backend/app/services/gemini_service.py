import json
import os
from datetime import date, datetime
from typing import List, Tuple

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiError(Exception):
    pass


def _call_json(prompt: str):
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise GeminiError("GEMINI_API_KEY is not set")
    try:
        r = requests.post(
            URL.format(model=MODEL),
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
            },
            timeout=25,
        )
        r.raise_for_status()
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except Exception as e:
        raise GeminiError(str(e))


def parse_disruption(text: str, now: datetime) -> Tuple[list, list]:
    """Free text -> (blocks, caps). Raises GeminiError on any problem."""
    prompt = f"""You convert a student's message about a schedule disruption into JSON.
Now: {now:%A %Y-%m-%d %H:%M} (local time).
Message: "{text}"

Return ONLY JSON in this shape:
{{"blocks":[{{"start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","label":"short label"}}],
  "caps":[{{"day":"YYYY-MM-DD","max_minutes":120}}]}}

Rules:
- blocks = time the student cannot study (delays, sickness, events, travel).
  Resolve words like tomorrow / tonight using Now.
  morning 07:00-12:00, afternoon 12:00-17:00, evening 17:00-21:00,
  night 21:00-23:59, whole day 07:00-23:59.
  A delay with no clock time ("ran 2 hours late") = block from Now for that duration.
- caps = "rough day / tired / go lighter": max study minutes that day
  (lighter = 240, much lighter = 120).
- Use empty lists when nothing applies. Never invent events."""
    data = _call_json(prompt)
    try:
        blocks, caps = [], []
        for b in data.get("blocks", []):
            s = datetime.fromisoformat(b["start"])
            e = datetime.fromisoformat(b["end"])
            if e > s:
                blocks.append({"start": s, "end": e, "label": str(b.get("label") or "Disruption")[:60]})
        for c in data.get("caps", []):
            caps.append({"day": date.fromisoformat(c["day"]), "max_minutes": max(0, int(c["max_minutes"]))})
        return blocks, caps
    except Exception as e:
        raise GeminiError(f"bad shape from model: {e}")


def phrase_reasons(facts: List[str], disruption_text: str) -> List[str]:
    """Rewrite template reasons in one batched call. Falls back to the originals."""
    if not facts:
        return facts
    prompt = f"""A student's schedule was reorganised after this message: "{disruption_text}".
Rewrite each fact below as ONE short, warm, plain sentence (max 22 words) that presents it
as a smart reorganisation, not a failure. Keep task names and times accurate.
Return ONLY a JSON array of {len(facts)} strings, in the same order.
Facts: {json.dumps(facts)}"""
    try:
        out = _call_json(prompt)
        if isinstance(out, list) and len(out) == len(facts) and all(isinstance(x, str) for x in out):
            return out
    except GeminiError:
        pass
    return facts