import sys
from datetime import datetime, timedelta

import requests

BASE = "http://localhost:8000"
EMAIL, PASSWORD, NAME = "demo@example.com", "DemoPass123!", "Demo Student"
IST = "+05:30"


def call(method, path, token=None, ok=(200, 201, 204), **kw):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.request(method, BASE + path, headers=h, **kw)
    if r.status_code not in ok:
        print(f"FAILED {method} {path}: {r.status_code} {r.text}")
        sys.exit(1)
    return r.json() if r.text else None


def iso(d, h, m=0):
    return f"{d:%Y-%m-%d}T{h:02d}:{m:02d}:00{IST}"


# --- user: sign up once, then just log in
r = requests.post(BASE + "/auth/signup", json={"name": NAME, "email": EMAIL, "password": PASSWORD})
print("created user" if r.status_code < 300 else "user exists, logging in")
tok = call("POST", "/auth/login", json={"email": EMAIL, "password": PASSWORD})["access_token"]

# --- reset: delete this user's existing tasks
for t in call("GET", "/tasks", tok):
    call("DELETE", f"/tasks/{t['id']}", tok)

base = datetime.now().date() + timedelta(days=1)
day = lambda n: base + timedelta(days=n)

# --- fixed commitments (deadline = start time, estimated_duration = length)
for i in range(5):
    call("POST", "/tasks", tok, json={"title": "Classes", "estimated_duration": 420, "priority": 3,
                                      "is_fixed": True, "commute_minutes": 20, "deadline": iso(day(i), 9)})
    call("POST", "/tasks", tok, json={"title": "Gym", "estimated_duration": 60, "priority": 3,
                                      "is_fixed": True, "commute_minutes": 10, "deadline": iso(day(i), 18)})


def task(title, mins, prio, ttype, deadline=None):
    body = {"title": title, "estimated_duration": mins, "priority": prio, "task_type": ttype}
    if deadline:
        body["deadline"] = deadline
    call("POST", "/tasks", tok, json=body)


task("DSA practice", 120, 3, "growth")
task("Maths revision", 90, 2, "growth")
task("Reading: Networks ch.5", 60, 2, "growth")
task("DBMS assignment", 180, 4, "deadline", iso(day(3), 18))
task("OS practical prep", 120, 5, "deadline", iso(day(2), 9))
task("Lab report", 60, 3, "deadline", iso(day(4), 18))
task("ML mini-project", 240, 4, "deadline", iso(day(5), 20))

# --- generate the plan
res = call("POST", "/schedules/generate", tok)
print("violations:", res["violations"], "| at risk:", res["at_risk"])
for d in res["days"]:
    if d["items"]:
        print(d["date"], [i["title"] for i in d["items"]])

print(f"\nLogin -> {EMAIL} / {PASSWORD}")