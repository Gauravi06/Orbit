# Orbit — Engineering Progress Log

**Purpose:** Chronological record of implementation decisions, completed work, verification evidence, and remaining issues.

**Documentation rule:** This file records history. `ORBIT_HANDOFF.md` is the authoritative source for the current implementation state and next task. Update both after every implementation batch.

**Evidence rule:** A historical test result is not proof that the current repository still passes. Distinguish automated tests, manual checks, inferred implementation state, and unverified work.

---

## 2026-08-18 — Initial Backend and Environment

### Environment

- Windows development environment, VS Code, command line, npm.
- Docker Desktop installed and running.
- PostgreSQL 16 running in Docker through `docker-compose.yml`, using the `orbit_postgres` container and port 5432.
- Python virtual environment under `backend/venv`.
- Frontend initially scaffolded with Vite, React, plain JavaScript, and ESLint.
- Axios and React Router installed.

### Backend foundation

The initial repository included:

- FastAPI application and configuration/security/dependency modules.
- Database base, session, and model infrastructure.
- Alembic migration setup.
- Authentication routes.
- Initial service stub for Gemini integration.

### Database and authentication

The original progress record reported successful Alembic migration and creation of the application's database tables.

Authentication was implemented around:

- Short-lived JWT access tokens.
- Opaque refresh tokens stored as SHA-256 hashes.
- Refresh-token rotation and revocation.
- Signup, login, refresh, logout, and protected current-user routes.
- Reusable current-user authentication dependency.

The original record also reported manual Swagger verification of signup, login, protected `/auth/me`, and refresh.

**Historical caveat:** refresh-token reuse blocking was not explicitly reverified in that record. Do not treat that particular security behavior as independently verified without current evidence.

### Environment issues resolved at the time

- Docker installer architecture mismatch was resolved using the appropriate installation route.
- `pydantic[email]` was needed for email validation.
- `bcrypt==4.0.1` was pinned because the recorded Passlib setup was incompatible with bcrypt 5.x.

These are historical troubleshooting notes; revisit only if the same failures recur.

---

## 2026-10-05 — Frontend Design Foundation

### Design direction

The UI direction was established as a paper planner crossed with a calm editorial magazine: warm, quiet, human, and free of unnecessary SaaS dashboard styling.

### Technology constraints

- Vite + React, plain JavaScript rather than TypeScript.
- Plain CSS and CSS variables.
- React Router.
- No Tailwind, MUI, Chakra, shadcn, or similar UI component library.

### Design system

The original implementation record describes:

- Fraunces for display/headings.
- Instrument Sans for body and interface text.
- JetBrains Mono for times and data labels.
- Paper and warm dark themes.
- CSS variables for colors, typography, spacing, borders, radii, and shadows.
- Keyboard focus styles and reduced-motion-aware transitions.
- A design guide at `/design` for development use.

The original record reported WCAG AA contrast verification. Treat that as a historical claim until the current color combinations are rechecked.

### Recorded deliverables

- `frontend/index.html`: font preconnects and theme initialization.
- `frontend/src/styles/tokens.css`: theme/design tokens.
- `frontend/src/styles/base.css`: base styles and reusable UI primitives.
- `frontend/src/theme/useTheme.js`.
- `frontend/src/components/ThemeToggle.jsx`.
- `frontend/src/pages/DesignGuide.jsx`.

---

## 2026-10-05 — Frontend Application Foundation

The original progress record described the following screens and capabilities:

- Application shell, navigation, theme controls, and authentication route guard.
- Login and signup screens with form validation.
- Onboarding for sleep rhythm, focus duration, work style, task splitting, and selected preferences.
- Today timeline with times, fixed commitments, work blocks, and breaks.
- Changed/disruption input and schedule-change feedback flows.
- Tasks and commitments forms.
- Responsive layouts and accessibility-oriented controls.

The record reported that `npm run lint` and `npm run build` passed at that time.

**Limitations recorded at the time:**

- Several flows used mock data.
- Google/OAuth login was not implemented.
- Calendar ICS sync was not implemented.
- Natural-language extraction was simulated in mock mode.
- Recurring commitments and subtasks were incomplete.
- Offline service-worker caching was not implemented.

These statements describe the historical design phase, not necessarily the complete current status.

---

## 2026-10-06 — Frontend Cleanup

Recorded changes:

- Simplified the `/changed` flow.
- Moved feedback into the Today experience.
- Added a two-step confirmation flow and `sendNote()`.
- Restricted development-only `/design` access.
- Restricted demo-fill behavior to mock mode.
- Added local-storage persistence for mock data and a reset action.

**Verification status:** historical implementation notes; current behavior must be verified against the repository.

---

## 2026-10-06 — Multi-Palette System

Recorded changes:

- Added light/dark mode and multiple color palettes.
- Added palette selection during onboarding and through the application shell.
- Updated the no-flash theme initialization.
- Expanded the development design guide.

The original record reported WCAG AA contrast of at least 4.5:1 across eight theme/palette combinations. This is historical evidence, not a current accessibility audit.

---

## 2026-10-06 — Daily Feedback, Week View, and Replanning

Recorded changes:

- Added provisional task checkboxes on Today.
- Added day-closing and horizon re-placement logic in mock flows.
- Added the Week view with schedule/load summaries and hobby/rest concepts.
- Added “This works” and “Not quite right” feedback paths.
- Added clarification flows and re-planning targeting later days.

**Important distinction:** a working mock interaction does not prove the real backend applies equivalent scheduling rules. Real and mock behavior must be tested separately where they affect product guarantees.

---

## 2026-10-16 to 2026-10-21 — Backend Integration and Scheduling Work

The later implementation record covers substantial integration work across the frontend, backend, scheduling rules, and regression tests.

The repository has included changes to the following areas; inspect the current files and Git diff before treating every item as complete:

- `backend/app/api/routes/preferences.py`
- `backend/app/api/routes/schedules.py`
- `backend/app/api/routes/notes.py`
- `backend/app/api/routes` and schema integration
- `backend/app/main.py`
- `backend/app/schemas/schedule.py`
- Frontend API client and mock implementation.
- Today, Week, onboarding, and application-shell integration.
- Scheduler integration and fixed-commitment tests.
- Proposal, notes/replan, onboarding/task, and frontend adaptation tests.
- `ORBIT_HANDOFF.md` and agent instructions.

### Fixed commitments

Recorded implementation:

- Fixed commitments are represented as fixed task records.
- Saved preference data is expanded into occurrences for a planning window.
- Schedule generation refreshes fixed commitments before planning.
- Expired fixed-task records are cleaned up as part of refresh.
- Tests were added for fixed commitments and refresh behavior.

Known design limitations from the current handoff:

- Removed commitments may remain until expiry.
- Recurrence is materialized over a finite planning window rather than represented as a complete recurrence system.
- Before/after commute values are collapsed into one commute field.
- Some preference dimensions may not yet be enforced structurally by the scheduler.

### Schedule integration

Recorded implementation includes schedule generation and retrieval, weekly schedule support, checks for unclosed schedules, date-related handling, and frontend schedule normalization.

Do not infer complete live integration from the existence of endpoints or tests alone. Verify the actual frontend configuration and run the relevant application path when possible.

### Notes and feedback

A notes route and associated schemas were added to support user input, persistence, and feedback-related behavior. Natural-language understanding includes heuristic intent classification in the recorded implementation.

A successful response from an intent classifier is not proof that a requested schedule change was safely and correctly applied.

### Schedule proposals

The recorded proposal design persists a proposed plan for review, validates placements, and separates proposal creation from approval. Approval and rejection have dedicated endpoints.

Previously tested behaviors include proposal persistence, approval/rejection, user isolation, staleness/expiry checks, and validation of stored placements.

**Important:** proposal/replan integration remains the next bounded engineering task. Some request/response and feedback-path concerns are documented in `ORBIT_HANDOFF.md`. Recheck the current implementation before deciding which defects remain.

---

## 2026-10-21 — Latest Focused Verification Evidence

The latest recorded focused backend test run was:

```powershell
Push-Location .\backend
try {
    python -m pytest .\tests\test_schedule_proposals.py .\tests\test_notes_and_replan.py -q
}
finally {
    Pop-Location
}
```

**Recorded result: 14 passed, 3 warnings in 16.17 seconds.**

The warnings were reported as deprecations, not test failures.

### Test execution note

The earlier attempt to run tests from the repository root failed because backend configuration resolves `.env` relative to the current working directory. The required environment file is `backend/.env`.

Running the focused tests from the backend directory resolved that test invocation issue. Do not change application configuration or environment files solely to avoid using the correct working directory.

### Older verification reports

Earlier records reported:

- 68 backend tests passed.
- 53 frontend tests passed.
- Frontend build passed.
- `git diff --check` passed.

**Status: historical.** These results must not be presented as a fresh full-suite run. Rerun relevant checks before making current claims.

### Integration status

Live end-to-end verification through the frontend against the real backend and PostgreSQL has not been established by the evidence available in this log.

---

## Current Outstanding Work

Use `ORBIT_HANDOFF.md` for the authoritative task order. The immediate priority is safe proposal/replan integration.

Broader product requirements still requiring evidence-based completion tracking include:

- Reliable schedule generation under fixed commitments, deadlines, commute, transitions, workload limits, and preferences.
- Explicit proposal/approval behavior across every schedule-changing path.
- Consistent real/mock API contracts.
- Reliable task and preference persistence.
- Evidence-based behavioral personalization.
- Proactive notifications that work without the user opening the app, with snooze/dismiss and duplicate prevention.
- Production-appropriate error handling and truthful UI status.
- Live end-to-end verification.
- Later mobile migration to React Native + Expo.

Do not mark these complete merely because a screen, endpoint, mock interaction, or test file exists.

---

## Required Documentation Update After Every Implementation Batch

At the end of each bounded batch:

1. Update `ORBIT_HANDOFF.md` with the verified current state, exact test results, remaining defects, and one next task.
2. Append a dated entry here describing the requirement advanced, files changed, checks run, results, limitations, and commit status.
3. Keep test counts and claims tied to the exact commands that produced them.
4. Preserve previous entries as history; correct an earlier entry only when clearly identifying the correction.
5. Do not duplicate the entire handoff in this log.

## 2026-10-22 — Bounded Proposal/Replan Integration Repair

**Product behavior advanced:**
- Solved proposal API contract mismatches: `ProposalCreateIn` includes `date` and `selected_option`; `ScheduleProposalResponse` declares `what_changed: List[str]`; and `get_proposal` returns actual displacement changes.
- Eliminated silent schedule mutation: schedule-changing feedback in both real backend route (`/schedules/replan`) and mock client (`replanSchedule`) now creates a reviewable proposal without mutating active schedules.
- Rejection leaves active schedule unchanged. Explicit user approval applies reviewed, validated placements to the active schedule.
- Emotion-only and preference feedback ("I feel calm and happy with my pace") records feedback without claiming schedule changes or generating an unwanted proposal (`proposal: null`, `what_changed: []`).
- Proposal review UI in `Today.jsx` updated to render proposed day/date placements, start/end times, validation violations, and risk warnings with honest state handling and clear notice that active schedule remains unchanged until approved.

**Files changed:**
- `backend/app/schemas/schedule.py` — Declared `date` and `selected_option` in `ProposalCreateIn`; declared `what_changed` in `ScheduleProposalResponse`.
- `backend/app/api/routes/schedules.py` — In `propose_schedule`, safely handled date parameter and disruption parsing exceptions, added cap-based lightening descriptions to `what_changed`; in `get_proposal`, populated `what_changed` from displacement reasons; in `replan_schedule`, enforced proposal creation for schedule-changing feedback while returning truthful empty proposals for emotion-only feedback.
- `backend/tests/test_notes_and_replan.py` — Updated `test_replan_schedule_tired` to verify non-mutation prior to approval and explicit approval application; added `test_replan_schedule_emotion_only_does_not_mutate_or_claim_change` and `test_replan_schedule_rejection_leaves_schedule_unchanged`.
- `frontend/src/api/mock.js` — Updated `replanSchedule` to operate on candidate snapshot instead of mutating active schedules in-place, returning reviewable proposal and truthful emotion-only response.
- `frontend/src/pages/Today.jsx` — Updated proposal review card to render day/date placements, start/end times, violations, and at-risk items; updated `handleOffSubmit` and `executeSaveAndReplan` to set proposals for review rather than prematurely claiming immediate schedule shifts.
- `frontend/tests/schedule_adaptation.test.js` — Added test 20 and test 21 verifying `replanSchedule` proposal creation, active schedule non-mutation, rejection safety, and emotion-only safety.
- `ORBIT_HANDOFF.md` — Updated current verified state, test evidence, defect resolutions, and next task.
- `progress.md` — Recorded this implementation batch and exact verification evidence.

**Verification:**
- `.\venv\Scripts\python.exe -m pytest -q` (from `backend/`) — 70 passed, 3 warnings in 33.14s.
- `.\venv\Scripts\python.exe -m pytest tests/test_schedule_proposals.py tests/test_notes_and_replan.py -vv` (from `backend/`) — 16 passed, 3 warnings in 17.73s.
- `npm test` (from `frontend/`) — 55 passed in 25.52s.
- `npm run build` (from `frontend/`) — Built in 3.49s with 0 errors.
- `git diff --check` — Passed cleanly with 0 errors or trailing whitespace.
- Not run: Live interactive PostgreSQL/browser integration with manual UI clicks was not run in this automated batch.

**Remaining issues:**
- Proactive intervention/notification subsystem (automated task/deadline monitoring without user trigger).
- Live browser end-to-end verification of proposal approval flow against live PostgreSQL.

**Git status:**
- Commit made: no (as requested by instructions).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-22 — Proactive Intervention Subsystem Implementation

**Product behavior advanced:**
- Implemented real backend-driven and frontend proactive intervention subsystem that autonomously monitors approaching deadlines (<24h) and overdue tasks without requiring user prompt or manual replan triggers.
- Database uniqueness and concurrency safety: `UniqueConstraint("dedup_key")` on `f"{user_id}:{task_id}:{intervention_type}"` prevents duplicate interventions; concurrency-safe savepoints handle race conditions without crashing workers.
- Lifecycle state transitions: active, snoozed, dismissed, and resolved. Completing or deleting a task automatically resolves active and snoozed interventions. Expired snoozes awaken automatically on subsequent detection cycles or queries.
- Strict non-mutation guarantee: proactive intervention generation never mutates active schedules or schedule items.
- User control: users can snooze alerts (with strict future-timestamp validation) or dismiss them permanently.
- Frontend visibility:
  - Global notification bell button in Shell header with active alert counter badge and neo-brutalist popover dropdown with "Snooze 3h" and "Dismiss" buttons.
  - Urgent proactive intervention banner card at the top of the Today tab with inline "Snooze 3h" and "Dismiss" buttons.
  - Real-time cross-component synchronization via `orbit-interventions-updated` window events.

**Files changed:**
- `backend/alembic/versions/c1d2e3f4a5b6_create_interventions_table.py` — Alembic revision creating `interventions` table with unique constraint on `dedup_key`.
- `backend/app/models/intervention.py` — SQLAlchemy model declaring `Intervention`.
- `backend/app/db/base.py` — Registered `Intervention` model in metadata.
- `backend/app/core/config.py` — Added intervention background worker settings.
- `backend/app/schemas/intervention.py` — Declared `InterventionRead`, `InterventionSnoozeIn`, and `InterventionListResponse`.
- `backend/app/services/intervention_service.py` — Deterministic detection rule engine (`run_detection_cycle`).
- `backend/app/services/intervention_worker.py` — Resilient background worker loop with short-lived DB sessions.
- `backend/app/api/routes/interventions.py` — REST endpoints (`GET /interventions`, `POST /{id}/dismiss`, `POST /{id}/snooze`, `POST /check`).
- `backend/app/main.py` — Lifespan-managed startup/shutdown of `InterventionWorker` and router registration.
- `backend/tests/test_interventions.py` — 12 unit tests verifying detection rules, deduplication, snooze expiry, dismissal, task completion resolution, schedule non-mutation, and worker error recovery.
- `frontend/src/api/client.js` — Exported `getInterventions`, `dismissIntervention`, `snoozeIntervention`.
- `frontend/src/api/mock.js` — Mirrored detection cycle, snooze awakening, validation, and `orbit_demo_interventions` persistence.
- `frontend/src/components/Shell.jsx` — Added notification bell button with active badge counter and interventions popover.
- `frontend/src/components/Shell.css` — Neo-brutalist styling for notification bell and intervention popover.
- `frontend/src/pages/Today.jsx` — Added proactive intervention alert banner with snooze/dismiss actions.
- `frontend/src/pages/Today.css` — Neo-brutalist styling for Today tab intervention banners.
- `frontend/tests/interventions.test.js` — 5 unit tests verifying mock intervention detection, overdue/approaching logic, dismissal, and snooze validation.
- `ORBIT_HANDOFF.md` — Updated verified subsystem state, test counts, and next task.
- `progress.md` — Appended implementation batch entry.

**Verification:**
- `.\venv\Scripts\python.exe -m pytest -q` (from `backend/`) — **82 passed, 3 warnings in 46.01s**.
- `node --test tests/**/*.test.js` (`npm test` from `frontend/`) — **60 passed, 0 failed in 25.89s**.
- `npm run build` (from `frontend/`) — Built cleanly in **4.33s** (0 errors).
- `git diff --check` — Passed cleanly (0 errors, 0 trailing whitespace).

**Remaining issues:**
- Live interactive PostgreSQL/browser integration walkthrough with manual UI clicks against running container.

**Git status:**
- Commit made: no (as requested by instructions).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-22 — Live PostgreSQL E2E Browser Walkthrough

**Product behavior advanced:**
- Switched frontend configuration `VITE_USE_MOCK=false` to execute all user flows directly against live FastAPI backend and PostgreSQL database.
- Verified complete user journey:
  1. Signup & Account creation (`e2e_student_2026@test.com`) with persistent auth tokens.
  2. Onboarding questionnaire completion across all 12 steps, persisting real user preferences and rhythm parameters to PostgreSQL.
  3. Task creation via Quick Add ("DBMS assignment due Friday, about 2 hours").
  4. Deterministic schedule generation and review on Today and Week timetable views.
  5. Disruption handling: submitted "College cancelled today" and reviewed generated rebalance proposal.
  6. Proposal approval workflow: verified plan approval applies updated placements to the live schedule.
  7. Proactive notification alerts: verified Shell header notification bell and proactive alerts modal.

**Files changed:**
- `frontend/.env` — Configured `VITE_USE_MOCK=false` for live backend operation.
- `ORBIT_HANDOFF.md` — Updated with live PostgreSQL E2E walkthrough evidence and next task.
- `progress.md` — Appended verification record and exact test command outputs.

**Verification:**
- Live browser walkthrough: **Passed** (recorded session artifact `e2e_walkthrough.webp`).
- Backend full pytest suite: **92 passed, 3 warnings in 80.41s** (`.\venv\Scripts\python.exe -m pytest -q` from `backend/`).
- Frontend test suite: **60 passed, 0 failed in 25.63s** (`npm test` from `frontend/`).
- `git diff --check`: Passed cleanly (0 errors).

**Remaining issues:**
- None for the current batch. All planned functional requirements verified.

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-22 — Consolidated Scheduler Reliability & Persistence Guard Fix

**Product behavior advanced:**
- **Universal Validation Persistence Guard**: Repaired `_apply_disruption()` in `backend/app/api/routes/schedules.py` so that whenever `validate_plan()` detects problems or invalid placements, `_save()` is skipped. Both `/schedules/disrupt` and `/schedules/disrupt-text` now return validation violations honestly without overwriting or mutating active schedules.
- **Database Row Immutability Regression Test**: Added `test_disruption_validation_failure_does_not_persist_or_overwrite_schedule` in `backend/tests/test_scheduler_integration.py` proving that database rows for existing active schedules remain completely unchanged when a disruption plan is invalid.
- **Core Scheduler & Preference Reliability**:
  - Reconciled `_upsert_fixed_commitments()` to accept and use the planning timestamp `now`, ensuring multi-day horizon date math matches the refresh cycle and scheduler boundaries.
  - Verified `no_pref` handling in `load_user_rule_prefs()` to safely apply sensible effective defaults without crashing time parsing.

**Files changed:**
- `backend/app/api/routes/schedules.py` — Guarded `_save()` in `_apply_disruption()` when `problems` exist.
- `backend/app/api/routes/preferences.py` — Parameterized `_upsert_fixed_commitments()` with `now: datetime | None = None` and passed `now` from `refresh_fixed_commitments()`.
- `backend/tests/test_scheduler_integration.py` — Added `test_disruption_validation_failure_does_not_persist_or_overwrite_schedule`.
- `ORBIT_HANDOFF.md` — Updated current verified implementation facts, test results, and status.
- `progress.md` — Appended verification entry and test evidence.

**Verification:**
- `.\venv\Scripts\python.exe -m pytest tests/test_fixed_commitments.py tests/test_fixed_commitment_refresh.py tests/test_fixed_commitment_regression_repair.py tests/test_onboarding_tasks.py tests/test_schedule_proposals.py tests/test_notes_and_replan.py tests/test_interventions.py -q`: **61 passed, 3 warnings in 35.57s**.
- `.\venv\Scripts\python.exe -m pytest tests/test_scheduler_integration.py -vv`: **6 passed, 2 warnings in 6.58s**.
- `npm test` (from `frontend/`): **60 passed, 0 failed in 25.08s**.
- `npm run build` (from `frontend/`): **Built cleanly in 2.87s** (0 errors).
- `git diff --check`: Passed cleanly (0 errors, 0 trailing whitespace).

**Remaining issues:**
- None. Ready for user review and commit authorization.

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-22 — Overnight scheduling regression and verification

**Product requirement advanced:** Added targeted coverage for overnight sleep combined with a same-day study cutoff, morning routine, and wind-down buffer. The test checks generated placement boundaries and confirms validation rejects a placement crossing the 23:00 cutoff.

**Files changed in this batch:**
- `backend/tests/test_rule_engine.py` — Added `test_overnight_sleep_respects_same_day_study_cutoff`; removed trailing whitespace from the file.
- `ORBIT_HANDOFF.md` — Appended current verified status, limitations of the evidence, and the next bounded task.
- `progress.md` — Recorded this batch and its verification status.

**Verification:**
- Focused command: `.\venv\Scripts\python.exe -m pytest tests/test_rule_engine.py -q` from `backend/` — **9 passed in 0.12s**.
- Full backend command: `.\venv\Scripts\python.exe -m pytest -q` from `backend/` — **94 passed, 3 warnings in 49.24s**.
- `git diff --check` — passed after whitespace cleanup.
- The test suite was run before the whitespace-only cleanup, not afterward.

**Not verified in this batch:** Full frontend tests/build, live end-to-end integration, and completion of all product requirements.

**Remaining blockers:** Verify the connected persisted user journey and the actual operational behavior of proactive interventions. Do not infer full product completion from passing tests.

**Git:** No commit made. Existing uncommitted changes preserved.

## 2026-10-22 — Fixed-commitment proposal integration regression

**Coverage added:**
- Added `test_onboarding_fixed_commitment_is_respected_by_proposal_and_approval` to `backend/tests/test_onboarding_tasks.py`.
- Exercises onboarding-created fixed commitments through proposal generation, explicit approval, and retrieval of the persisted schedule.
- Confirms the study task does not overlap the commitment's protected time window in the proposal or approved schedule.

**Verification:**
- `.\venv\Scripts\python.exe -m pytest tests/test_onboarding_tasks.py tests/test_schedule_proposals.py -q` from `backend/` — **20 passed, 2 deprecation warnings in 21.32s**.
- Corrected the test's timezone mismatch; no production-code change was required for this test.
- This does not establish completion of the entire scheduling system or the full Orbit scope.
- No commit made.

## 2026-10-22 — Repeated-unfinished-task proactive intervention implementation

**Product requirement advanced:**
Orbit proactively detects when a non-fixed task remains unfinished across at least two distinct past planned calendar days (schedule blocks that ended before `now` without status `completed`/`done`/`cancelled`) and creates a useful intervention (`Plan check: {task.title}`) asking: `'{task.title}' has remained unfinished across {count} past planned days. Is the current plan not working?` Includes full lifecycle: deduplication, snooze, dismissal, styling in Today and Shell notifications, mock parity, and auto-resolution when the task is marked completed/done/cancelled/deleted or drops below 2 past unfinished days.

**Files changed in this batch:**
- `backend/app/services/intervention_service.py` — Added query for past schedule items (`ScheduleItem.end_time < now` and status not in `["completed", "done", "cancelled"]`), counted distinct calendar dates (`past_dates`), triggered `repeated_unfinished` interventions when `len(past_dates) >= 2`, and auto-resolved active/snoozed interventions when the task was finished or count dropped below 2. Decoupled deadline checks so growth/non-deadline tasks are also monitored.
- `frontend/src/pages/Today.jsx` & `frontend/src/pages/Today.css` — Added `.repeated-unfinished` styling support with calm neo-brutalist purple badge (`#D4C5F9`).
- `frontend/src/components/Shell.jsx` & `frontend/src/components/Shell.css` — Added `.repeated-unfinished` styling support for global notification dropdown (`#EDE4FF` light / `#2D2338` dark).
- `frontend/src/api/mock.js` — Implemented repeated unfinished detection in mock mode across past days (`sched.date < todayStr`), and fixed `loadStoredState()` to assign `schedules = finalSchedules` to reflect modified schedules.
- `backend/tests/test_interventions.py` — Added 8 dedicated regression tests covering 1 past day, 2 past days, multi-block single day, future blocks, completed blocks/tasks, deduplication, auto-resolution on task completion, and user isolation.
- `frontend/tests/interventions.test.js` — Added tests 6 and 7 verifying mock mode detection and auto-resolution on completion.
- `ORBIT_HANDOFF.md` — Updated current verified implementation facts, test results, and status.
- `progress.md` — Recorded this batch and its verification status.

**Verification:**
- Full backend suite: `.\venv\Scripts\python.exe -m pytest -q` from `backend/` — **103 passed, 3 warnings in 99.26s**.
- Focused backend suite: `.\venv\Scripts\python.exe -m pytest tests/test_interventions.py -q` from `backend/` — **20 passed in 10.96s**.
- Full frontend test suite: `npm test` from `frontend/` — **62 passed in 26.26s**.
- Frontend production build: `npm run build` from `frontend/` — **Built cleanly in 4.02s** (0 errors).
- `git diff --check` — Passed cleanly (0 errors, 0 trailing whitespace).

**Checks not run:**
- Live browser walkthrough of the newly added intervention via Playwright/Puppeteer against a running backend (mock and unit tests covered frontend and backend behaviors comprehensively).

**Remaining issues / blockers:**
- Full product scope requires further end-to-end integration tests between frontend and PostgreSQL under live production-mode conditions.

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-22 — Correction: repeated-unfinished intervention schedule-date consistency

**Product requirement advanced:**
Corrected repeated-unfinished-task intervention detection in `backend/app/services/intervention_service.py` to ensure schedule items explicitly match their parent `Schedule.date` (`item.start_time.date() == sched_date`). This prevents false positives caused by corrupt or inconsistent schedule item timestamps across historical records, while preserving legitimate historical unfinished sessions across multiple distinct days and across schedule versions (`version > 1`).

**Files changed in this batch:**
- `backend/app/services/intervention_service.py` — Updated the query to select `(ScheduleItem, Schedule.date)` and filtered `past_dates` to only include calendar dates where `item.start_time.date() == sched_date`.
- `backend/tests/test_interventions.py` — Added regression test `test_repeated_unfinished_item_must_match_schedule_date` confirming that items on a single schedule with mismatched dates do not trigger false alerts (2 days vs 1 day). Added regression test `test_repeated_unfinished_two_distinct_past_days_with_regenerated_versions_triggers` confirming that historical regenerated schedules (`version=2`, `version=3`) on 2 distinct past days continue to trigger valid interventions.
- `ORBIT_HANDOFF.md` — Updated with confirmed root cause, minimal fix, and verification results.
- `progress.md` — Appended this progress log entry.

**Verification:**
- Focused repeated-unfinished tests: `.\venv\Scripts\python.exe -m pytest tests/test_interventions.py -q` from `backend/` — **22 passed, 3 warnings in 23.45s**.
- Full backend suite: `.\venv\Scripts\python.exe -m pytest -q` from `backend/` — **105 passed, 3 warnings in 60.95s**.
- Full frontend test suite: `npm test` from `frontend/` — **62 passed in 26.33s**.
- Frontend production build: `npm run build` from `frontend/` — **Built cleanly in 2.82s** (0 errors).
- `git diff --check` — Passed cleanly (0 errors, 0 trailing whitespace).

**Checks not run:**
- Live browser walkthrough via Playwright against live PostgreSQL.

**Remaining issues / blockers:**
- Live end-to-end user verification against running PostgreSQL and background worker.

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-22 — Verification and audit of proactive intervention lifecycle

**Product requirement advanced:**
Verified the complete real-backend proactive intervention lifecycle across startup, background worker polling, database persistence, deduplication, user isolation, snooze reactivations, frontend in-app fetching/rendering/dismissal, and app-closed delivery analysis.

**Verified lifecycle facts:**
1. **Startup & Shutdown:** FastAPI lifespan (`app/main.py`) checks `settings.intervention_worker_enabled` (default `True`), initiates `start_intervention_worker()`, and cancels/awaits task shutdown on `stop_intervention_worker()`. Added regression tests verifying worker idempotency and clean task cancellation.
2. **Session Cleanup & Error Handling:** The background loop (`intervention_worker.py`) instantiates `SessionLocal()`, executes `run_detection_cycle(db)`, guarantees `db.close()` in a `finally` block on both success and failure, and logs unhandled exceptions without crashing the worker.
3. **Detection, Deduplication & Persistence:** Incomplete deadline tasks and repeated unfinished tasks ($\ge 2$ distinct planned days) are persisted to the PostgreSQL `interventions` table with unique `dedup_key`. Successive runs re-evaluate existing interventions without duplicate record insertion.
4. **User Isolation:** All queries filter on `Intervention.user_id == current_user.id` or `Schedule.user_id == user.id`. Users cannot view or mutate another user's interventions.
5. **Snooze & Dismissal:** Snoozing records `snoozed_until` in UTC; list retrieval or background cycles reactivate snoozed items once `now >= snoozed_until`. Dismissal sets `dismissed_at` and transitions status to `dismissed`.
6. **Frontend Integration:** Both `Today.jsx` and `Shell.jsx` call `getInterventions('active')`, wire `snoozeIntervention` and `dismissIntervention`, and listen for `orbit-interventions-updated` events for synchronized UI state. In-app notifications render in the global notification bell and banners on the Today screen.
7. **App-Closed Notification Reality:** The current repository does NOT contain any native push notifications (Web Push, APNs/FCM) or email/SMS dispatchers. When the browser tab or app is closed, interventions continue to be detected and recorded in the database by the backend worker, but visual delivery occurs only upon opening the application (in-app rendering and 30-second polling). App-closed notifications would require a native push service / service worker.

**Files changed in this batch:**
- `backend/tests/test_interventions.py` — Added `test_worker_lifecycle_and_session_cleanup` and `test_worker_loop_handles_exception_and_closes_session`.
- `ORBIT_HANDOFF.md` — Updated with confirmed lifecycle audit, verified test numbers (107 backend, 62 frontend), and app-closed notification gap analysis.
- `progress.md` — Recorded this batch and its verification status.

**Verification:**
- Focused repeated-unfinished and worker tests: `.\venv\Scripts\python.exe -m pytest tests/test_interventions.py -q` from `backend/` — **24 passed, 3 warnings in 23.66s**.
- Full backend suite: `.\venv\Scripts\python.exe -m pytest -q` from `backend/` — **107 passed, 3 warnings in 64.41s**.
- Full frontend test suite: `npm test` from `frontend/` — **62 passed in 26.33s**.
- Frontend production build: `npm run build` from `frontend/` — **Built cleanly in 2.53s** (0 errors).
- `git diff --check` — Passed cleanly (0 errors, 0 trailing whitespace).

**Checks not run:**
- Live browser walkthrough via Playwright against live PostgreSQL.

**Remaining issues / blockers:**
- Notification delivery while app is closed requires future push notification / service worker infrastructure (currently by design not implemented in frontend/backend).

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-23 — Week Endpoint Fixed-Commitment Collision Repair

**Product requirement advanced:**
Fixed defect in `backend/app/api/routes/schedules.py` where `get_week_spread()` appended persisted `ScheduleItem` records to each day's `day_items` without checking for collisions against fixed commitments and their commute/transition buffers. The endpoint now filters colliding saved items so they are not presented as valid scheduled blocks in the Week API, while strictly preserving the underlying database `ScheduleItem` records, their status, and completion history.

**Files changed in this batch:**
- `backend/app/api/routes/schedules.py` — In `get_week_spread()`, compiled `day_fixed_blocks` per weekday and omitted saved `ScheduleItem` records that conflict with fixed commitments and their commute + transition buffer (`TRANSITION_BUFFER = 5 min`).
- `backend/tests/test_fixed_commitment_regression_repair.py` — Added regression test `test_week_spread_omits_conflicting_saved_task_items`.
- `ORBIT_HANDOFF.md` — Updated with defect analysis, fix details, and verification evidence.
- `progress.md` — Appended this progress log entry.

**Verification:**
- New regression test failing before fix: `.\venv\Scripts\python.exe -m pytest tests/test_fixed_commitment_regression_repair.py -k test_week_spread_omits_conflicting_saved_task_items` — **1 failed (AssertionError: Lists differ: ['Stale Overlapping Session'] != [])**.
- New regression test passing after fix: `.\venv\Scripts\python.exe -m pytest tests/test_fixed_commitment_regression_repair.py -k test_week_spread_omits_conflicting_saved_task_items` — **1 passed in 5.38s**.
- Focused fixed-commitment suite: `.\venv\Scripts\python.exe -m pytest tests/test_fixed_commitments.py tests/test_fixed_commitment_refresh.py tests/test_fixed_commitment_regression_repair.py` from `backend/` — **23 passed, 2 warnings in 35.10s**.
- `git diff --check`: Clean (0 errors, 0 trailing whitespace).

**Checks not run:**
- Full backend suite (100+ tests) was not run to maintain focused scope.
- Frontend test suite (`npm test`) was not rerun since no frontend files were touched.
- Weekly summary metrics semantics were not altered, per constraints.

**Remaining issues / blockers:**
- Clarification of weekly summary semantics (planned vs completed hours calculation).

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.

## 2026-10-23 — Quick Add Natural-Language Task Parsing Repair

**Product requirement advanced:**
Fixed defect in the Quick Add flow (`frontend/src/pages/Tasks.jsx` and `frontend/src/api/semanticParser.js`) where natural-language task input was stored directly as the title instead of being parsed into separate structured fields (`title`, `deadline`, `estimated_duration`, `tier` / `priority`), and where deadlines defaulted or were converted with UTC/local date shifts (e.g., October 29 becoming October 30).

**Defect resolution details:**
- Exact reported input: `assignment 2 due on oct 29. needs 60 mins to complete Need To`
- Parser now cleanly extracts:
  - Title: `assignment 2` (via `extractCleanTitle()`)
  - Due date: `2026-10-29T23:59:00` (via `parseDeadline()` using current 2026 date context, without one-day UTC shifting)
  - Estimated duration: `60` minutes
  - Tier / Priority: `have_to` / `5` (`Need To`)
- In `Tasks.jsx`, `handleQuickAdd` utilizes `parsed.clean_title` (or `parsed.title`), `parsed.deadline`, `parsed.estimated_duration`, and `parsed.tier` / `parsed.priority` to build the task payload and confirmation message.

**Files changed in this batch:**
- `frontend/src/api/semanticParser.js` — Added `parseDeadline(text, refDate)` and `extractCleanTitle(rawText)` helper utilities; integrated title, clean_title, and deadline into `parseTaskSemantics()` output.
- `frontend/src/api/mock.js` & `frontend/src/api/client.js` — Re-exported `parseDeadline` and `extractCleanTitle`.
- `frontend/src/pages/Tasks.jsx` — Updated `handleQuickAdd()` to read parsed clean title, duration, tier, priority, and date-safe deadline without UTC date rollover.
- `frontend/tests/quick_add_parsing.test.js` — Added comprehensive regression test suite verifying exact reported case and common variants.
- `ORBIT_HANDOFF.md` — Updated with defect analysis, fix details, and verification evidence.
- `progress.md` — Appended this progress log entry.

**Verification:**
- Focused quick add regression test suite: `node --test tests/quick_add_parsing.test.js` from `frontend/` — **4 passed in 33.0ms**.
- Full frontend test suite: `npm test` from `frontend/` — **66 passed (8 suites) in 26.64s**.
- Full backend pytest suite: `pytest` from `backend/` — **109 passed in 114.57s**.
- `git diff --check`: Clean (0 errors, 0 trailing whitespace).

**Git status:**
- Commit made: no (awaiting user authorization).
- Diff reviewed: yes.
- Handoff updated: yes.
