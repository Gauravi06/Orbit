import sys
import time
from datetime import datetime, timedelta

import requests

BASE = "http://localhost:8000"
IST = "+05:30"

email = f"demo{int(time.time())}@example.com"
password = "DemoPass123!"


def call(method, path, token=None, **kw):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.request(method, BASE + path, headers=headers, **kw)
    if r.status_code >= 400:
        print(f"FAILED {method} {path}: {r.status_code} {r.text}")
        sys.exit(1)
    return r.json() if r.text else None


def iso(day, hour, minute=0):
    return f"{day:%Y-%m-%d}T{hour:02d}:{minute:02d}:00{IST}"


# --- user (adjust the signup fields if your UserCreate needs more, e.g. "name")
call("POST", "/auth/signup", json={"name": "Demo Student", "email": email, "password": password})
tok = call("POST", "/auth/login", json={"email": email, "password": password})["access_token"]

base = datetime.now().date() + timedelta(days=1)  # start tomorrow

# --- fixed commitments: 3 days of classes + gym
for i in range(3):
    d = base + timedelta(days=i)
    call("POST", "/tasks", tok, json={
        "title": "Classes", "estimated_duration": 420, "priority": 3,
        "is_fixed": True, "commute_minutes": 20, "deadline": iso(d, 9)})
    call("POST", "/tasks", tok, json={
        "title": "Gym", "estimated_duration": 60, "priority": 3,
        "is_fixed": True, "commute_minutes": 10, "deadline": iso(d, 18)})

# --- normal tasks
def t(title, mins, prio, ttype, deadline=None):
    body = {"title": title, "estimated_duration": mins, "priority": prio, "task_type": ttype}
    if deadline:
        body["deadline"] = deadline
    call("POST", "/tasks", tok, json=body)

t("DSA practice", 120, 3, "growth")
t("Maths revision", 90, 2, "growth")
t("DBMS assignment", 180, 4, "deadline", iso(base + timedelta(days=3), 18))
t("OS practical prep", 120, 5, "deadline", iso(base + timedelta(days=2), 9))
t("Lab report", 60, 3, "deadline", iso(base + timedelta(days=4), 18))

# --- generate
res = call("POST", "/schedules/generate", tok)
print("violations:", res["violations"], "| at risk:", res["at_risk"])
for day in res["days"]:
    if day["items"]:
        print(day["date"], [i["title"] for i in day["items"]])

# --- disrupt: tomorrow afternoon blocked
res = call("POST", "/schedules/disrupt", tok, json={
    "blocks": [{"start": iso(base, 18, 30), "end": iso(base, 23, 0), "label": "Lab ran late"}]})
print("\nAfter disruption. violations:", res["violations"])
for day in res["days"]:
    for i in day["items"]:
        if i["displacement_reason"]:
            print(" -", i["title"], "|", i["displacement_reason"])

print(f"\nDemo login -> {email} / {password}")