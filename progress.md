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

## 2026-10-05

### Frontend Design Foundation — Built and Verified
- **Philosophy**: Paper planner crossed with calm editorial magazine. Quiet, warm, human, zero SaaS dashboard bloat.
- **Stack Constraint**: Vite + React in plain JS (no TS), plain CSS with CSS variables, react-router-dom. Zero UI component libraries (no Tailwind, MUI, Chakra, shadcn) for full aesthetic control.
- **Typography**:
  - Display & Headings: Fraunces (serif)
  - Body & UI: Instrument Sans
  - Times & Data Labels: JetBrains Mono
  - Type scale variables: 12, 14, 16, 20, 28, 40 px.
- **Theme Architecture**:
  - Defined as `[data-theme="paper"]` and `[data-theme="ink"]` on `<html>`. Adding future themes requires only a new CSS block.
  - `index.html` includes an inline script in `<head>` that maps OS scheme (`prefers-color-scheme`) and reads `localStorage` before React loads, preventing any flash of the wrong theme.
  - `localStorage` operations are strictly guarded in `try/catch`.
  - "Paper" theme: `--bg: #F4EFE6`, `--surface: #FBF8F2`, `--surface-2: #EDE6D8`, `--ink: #1F1B16`, `--ink-muted: #6B6258`, `--line: #DDD3C2`, terracotta `--accent: #B24322`, recovery `--sage: #536D58`.
  - "Ink" theme: warm dark (not pure black/blue-grey): `--bg: #14120F`, `--surface: #1C1915`, `--surface-2: #25211C`, `--ink: #EFE8DA`, `--ink-muted: #A0968A`, `--line: #332E27`, `--accent: #E0875F`, `--sage: #8FAE93`.
  - Muted brick `--error`: `#A33822` (Paper) / `#E87A6E` (Ink), reserved strictly for form validation, never for rescheduled work.
  - **WCAG AA Compliance**: All text and background combinations verified to meet or exceed 4.5:1 contrast across all surfaces.
- **Layout & Rules**:
  - 4px spacing scale (`--space-1` through `--space-16`).
  - Radii: 6px small, 12px medium. Full pills reserved exclusively for status tags (`--radius-tag`).
  - Flat 1px borders and whitespace for separation. Soft shadows restricted to floating menus/dialogs (`--shadow-floating`).
  - Consistent 1.5px stroke vector line icons; transitions 150-200ms ease-out respecting `prefers-reduced-motion`.
- **Deliverables Completed**:
  1. `frontend/index.html`: Preconnected fonts and no-flash theme initialization script.
  2. `frontend/src/styles/tokens.css`: Complete token library for Paper and Ink.
  3. `frontend/src/styles/base.css`: Reset, typography scale, keyboard focus rings, button variants, pill tags, form inputs with error states, and quiet card containers.
  4. `frontend/src/theme/useTheme.js` & `frontend/src/components/ThemeToggle.jsx`: Keyboard-accessible toggle with 1.5px stroke SVG icons.
  5. `frontend/src/pages/DesignGuide.jsx`: Interactive showcase at route `/design` displaying every color swatch, typography level, button, tag, input, card, and live theme switch.

### Frontend Application & Adaptive Core — Built and Verified
- **Phase 1 (App shell)**: Responsive header with Orbit brand, navigation links, ThemeToggle, user menu, mobile bottom bar, and auth route guard. Check via browser navigation at 360px and 1280px. Gaps: backend user profile sync in mock mode is in-memory.
- **Phase 2 (Login & Signup)**: Calm, left-aligned auth card with form validation, demo fill button, and token persistence. Check at `/login`. Gaps: OAuth / Google login not implemented.
- **Phase 3 (Onboarding)**: 6-step MCQ survey for sleep rhythms, focus duration (45m/90m/3h), work style, task splitting, and multi-select juggle chips. Check at `/onboarding`. Gaps: preferences stored in mock state.
- **Phase 4 (Today Timeline)**: Vertical timeline with mono timestamps, distinct visual kinds (fixed lock, serif deep work, sage breaks, dashed decompression), calm displacement reasons, and day switcher. Check at `/today`. Gaps: real calendar ICS sync not built yet.
- **Phase 5 & 6 (Something Changed & Feedback)**: Disruption text input with quick prompts, animated rearrangement state, version bump, plain-language "What changed" list, undo/keep actions, and gentle daily reflection. Check at `/changed`. Gaps: LLM dynamic extraction simulated by deterministic mock in mock mode.
- **Phase 7 (Tasks & Commitments)**: Task and fixed commitment forms, 1-5 priority descriptions, and smart quick-add NLP guesser. Check at `/tasks`. Gaps: subtasks and recurring weekly rules.
- **Phase 8 (Polish & Accessibility)**: Keyboard focus rings, aria-labels, 1.5px stroke icons via lucide-react, zero console errors, passed `npm run lint` and `npm run build`. Check via Tab keyboard traversal. Gaps: full offline service worker caching.

### Next step
Backend integration for schedule rule engine and live FastAPI endpoints to replace mock layer.

## 2026-10-06 — Frontend Cleanup (Phase 1)
- Cleaned /changed screen to single prompt, moved feedback to Today page under "Tell Orbit anything" with 2-step confirmation and sendNote().
- Secured dev-only /design access, restricted Fill Demo to mock mode, and persisted mock data to localStorage with reset action.

## 2026-10-06 — Multi-Palette System (Phase 2)
- Implemented dual attributes data-mode (light/dark) and data-palette (terracotta/sage/dusk/plum) with WCAG AA >= 4.5:1 across all 8 combinations.
- Added onboarding "Pick your look" step, shell dropdown palette picker, no-flash html script migration, and dev-only /design showcase.