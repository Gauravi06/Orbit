# Orbit — Progress Log

## 2026-08-18

### Environment
- Windows, VS Code, cmd prompt, npm
- Docker Desktop installed and verified working (initial installer was wrong architecture - error 216 - fixed via winget install Docker.DockerDesktop instead of website download)
- Postgres 16 running locally in Docker (orbit_postgres container, port 5432) via docker-compose.yml
- Python venv in backend\venv
- Frontend scaffolded: Vite + React (plain JS, not TS) + ESLint; axios + react-router-dom installed; still default template, no custom UI yet

### Repo structure
Orbit/
  backend/
    app/
      core/       -> config.py, security.py, deps.py
      db/         -> base_class.py, base.py, session.py
      models/     -> user, refresh_token, task, schedule, schedule_item, feedback, preference, gemini_cache
      schemas/    -> user.py, auth.py
      api/routes/ -> auth.py
      services/   -> gemini_service.py (empty stub)
      main.py
    alembic/       -> configured to read DB URL from .env, uses app's Base.metadata
    requirements.txt
    .env / .env.example
  frontend/         -> default Vite React scaffold
  docker-compose.yml
  .gitignore

### Database
All 8 tables created and migrated via Alembic (alembic upgrade head run successfully):
users, refresh_tokens, tasks, schedules, schedule_items, feedback, preferences, gemini_cache

Two tables added beyond original spec, both deliberate decisions:
- refresh_tokens - supports access+refresh JWT auth (hashed, revocable, rotated)
- gemini_cache - caches LLM responses per user (input_hash-keyed) to protect Gemini free tier limits

### Auth - fully built and verified working
- Approach: JWT access token (15 min expiry) + opaque refresh token (14 days, SHA-256 hashed in DB, rotated on every use, revocable)
- Endpoints live: POST /auth/signup, POST /auth/login, POST /auth/refresh, POST /auth/logout, GET /auth/me (protected)
- get_current_user dependency in core/deps.py - reusable for protecting any future route
- Manually tested via Swagger (/docs): signup -> 201, login -> 200 with token pair, /me -> 200 (protected route confirmed working), refresh -> 200 with rotated new pair
- Refresh reuse-blocking not explicitly re-verified after a debugging false alarm (turned out to be a token transcription error, not a real bug) - logic is simple and trusted, revisit only if something seems off later

### Gotchas hit and resolved (useful if they recur)
- Docker installer served ARM64 build to an x64 machine - use winget install Docker.DockerDesktop, not the direct website download, if this happens again
- pip install "pydantic[email]" needed explicitly for EmailStr fields to work
- bcrypt 5.x breaks passlib - pinned to bcrypt==4.0.1 in requirements.txt

### Not built yet
- Task CRUD endpoints (next planned step)
- Schedule generation endpoint
- Rule engine (constraint validation, slot-filling logic) - design in progress in a separate chat within this project
- Gemini service (gemini_service.py is an empty stub)
- Adaptive rescheduling ("Something changed?" flow) - the core differentiating feature
- Daily feedback -> preference-extraction pipeline
- All frontend screens (onboarding, timetable input, schedule view, disruption input)

### Next step
Task CRUD (create/list/update tasks for the logged-in user) - simple, no rule engine or LLM involved. Unblocks Schedule generation, which unblocks the core demo flow. Rule engine design decisions need to be finalized before Schedule generation is implemented.