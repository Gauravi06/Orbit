# Orbit — Current Engineering Handoff

**Last reconciled:** 27 October 2026<br/>
**Active Branch:** `aniket_fix` (HEAD at `2fa8d8c`)<br/>
**Purpose:** Single source of truth for the current product requirements, implementation state, verified evidence, and next engineering task.

> Read this file before making changes. Inspect the actual repository before relying on any statement about implementation. If code and this document disagree, investigate the discrepancy and update the document after verification.

## 1. Product definition

**Orbit** is an adaptive student life companion. Its promise is **“Balance without burnout.”**

Orbit must not become merely a static timetable, a task checklist, or a reactive chatbot. It should help students balance academic deadlines, fixed commitments, rest, and hobbies by adapting to their actual circumstances.

### Non-negotiable product behavior

1. **Meaningful onboarding:** collect relevant commitments, sleep/wake times, commute, focus preferences, and priorities. Answers must influence scheduling, not just be stored.
2. **Tasks and deadlines:** persist tasks, durations, deadlines, and priorities. Avoid duplicates and invalid or impossible plans.
3. **Constraint-aware scheduling:** respect fixed commitments, commute/transition buffers, deadlines, workload limits, task splitting, rest, and relevant preferences.
4. **AI-assisted input, deterministic scheduling:** interpret natural language or voice input using AI where available; validate and apply scheduling decisions through reliable application logic.
5. **Explicit schedule approval:** show a proposed change and its rationale. Never silently apply a schedule-changing proposal. Rejection must leave the active schedule unchanged.
6. **Evidence-based personalization:** learn from real completion patterns and feedback. Never present seed data or hardcoded assumptions as learned behavior.
7. **Proactive interventions:** monitor deadlines, unfinished or repeatedly avoided tasks, and neglected hobbies. Notify the user without requiring them to open the app or ask first. Offer useful reminders or proposed adjustments.
8. **User control:** reminders need dismissal/snooze and duplicate prevention. Schedule changes require explicit approval.
9. **Real integration:** backend, authentication, database persistence, frontend integration, validation, and error handling must work. Never present mock success as real backend success.

### Product direction

- Current implementation: React + Vite frontend, FastAPI backend, PostgreSQL.
- Intended demo direction: Android-first; React Native + Expo is the intended later mobile path.
- Timetable-image extraction and meal planning are lower priority than reliable core scheduling and proactive behavior.

## 2. Engineering rules

- Work on the existing `feature/orbit-product` branch unless the user explicitly instructs otherwise.
- Preserve all existing and uncommitted user changes. Never reset, discard, overwrite, or revert unrelated work.
- Before editing, inspect `git status`, the relevant implementation, callers, tests, and the current diff.
- Each batch must measurably advance a stated product requirement. Prefer the smallest complete, testable change over broad refactors or cosmetic work.
- Do not repeat a settled investigation or rebuild existing functionality without evidence of a defect.
- Do not launch another Antigravity run merely because a task feels unfinished. First evaluate whether the current evidence is sufficient.
- Do not change environment configuration, credentials, dependencies, or architecture unless the specific task requires it.
- Do not commit unless the user authorizes it after reviewing the changes and verification evidence.
- If verification fails, stop and report the failure. Do not claim completion or readiness to commit.

## 3. Current implementation map

The following reflects the latest available handoff evidence, not a substitute for inspecting current files.

### Backend

- FastAPI application, authentication, database models, and Alembic infrastructure exist.
- Authentication includes signup, login, refresh, logout, and current-user routes.
- Schedule endpoints include generation, weekly retrieval, unclosed-schedule checks, proposal creation, approval, rejection, and replan-related behavior.
- Fixed commitments are represented as fixed task records and refreshed from saved preferences when generating a schedule.
- Notes and feedback routes exist for understanding/saving user input and recording feedback.
- Schedule proposals are persisted with planned placements and validation-related metadata.
- The backend has regression tests covering proposal creation, approval/rejection, user isolation, staleness, expiry, invalid placements, fixed commitments, notes, and replan behavior.

### Frontend

- React/Vite application includes authentication guards and Today, Week, Changed, Tasks, and onboarding flows.
- A mock API implementation and local-storage-backed demo state exist.
- The frontend can use a mock mode. Verify the active configuration before drawing conclusions about backend integration.
- Proposal and feedback paths exist, but their contracts and behavior require the bounded repair described below.
- Existing UI/design work should be preserved. Visual polish is not the current priority.

### Database and environment

- PostgreSQL is used by the backend.
- The backend environment file is `backend/.env`.
- Run backend tests from the `backend` directory because the configuration uses a relative `.env` path.
- Never print, copy into reports, or commit secret values.

## 4. Verified evidence and confidence

### Most recent focused test evidence

On 21 October 2026, these focused tests were reported passing when run from `backend`:

```powershell
Push-Location .\backend
try {
    python -m pytest .\tests\test_schedule_proposals.py .\tests\test_notes_and_replan.py -q
}
finally {
    Pop-Location
}
```

**Result: 14 passed, 3 warnings in 16.17 seconds.**

The warnings were reported as deprecations, not test failures. This result covers only the named test files; it does not prove the full suite or live application is correct.

Earlier records reported 68 backend tests, 53 frontend tests, a passing frontend build, and a clean `git diff --check`. These are **historical results**, not current full-suite verification.

Live end-to-end verification against PostgreSQL through the actual frontend browser session has not been established by automated test suites.

## 5. Verified proposal and replan integration repair

On 22 October 2026, the schedule proposal and replan integration was repaired and verified:

### A. Proposal contract resolution
- Backend request schema `ProposalCreateIn` officially declares optional `date` and `selected_option`, matching frontend caller signatures.
- Response schema `ScheduleProposalResponse` officially exposes `what_changed: List[str]`, and `get_proposal` returns populated changes derived from displacement analysis.
- UI reads real `what_changed`, `days`, `at_risk`, and `violations` fields without fabricating outcomes.

### B. Elimination of silent schedule mutation
- Both real backend route (`/schedules/replan`) and mock implementation (`replanSchedule`) now enforce that schedule-changing feedback creates a reviewable proposal without mutating active schedules.
- Active schedule remains unchanged upon proposal creation and rejection.
- Explicit user approval (`/schedules/proposals/{id}/approve`) is required to apply reviewed, validated placements to the active schedule.
- Emotion-only and preference feedback ("I feel calm and happy with my pace") records feedback without claiming schedule changes or generating an unwanted proposal (`proposal: null`, `what_changed: []`).
- Proposal review UI in `Today.jsx` displays proposed day/time placements, start/end times, validation violations, at-risk tasks, and an explicit notice: "Active schedule unchanged until approved".

### C. Latest test evidence
- Backend: **82 passed, 3 warnings in 46.01s** (`.\venv\Scripts\python.exe -m pytest -q` from `backend`).
- Frontend: **60 passed in 25.89s** (`npm test` from `frontend`).
- Frontend build: **passed in 4.33s** (`npm run build` from `frontend`).
- `git diff --check`: passed cleanly (0 errors, zero trailing whitespace).

## 6. Verified proactive intervention subsystem

On 22 October 2026, the real backend-driven and mock proactive intervention subsystem was implemented and verified:

### A. Database and model layer
- Alembic migration `c1d2e3f4a5b6_create_interventions_table.py` created the `interventions` table with a unique constraint on `dedup_key` (`uq_interventions_dedup_key`), indexed `user_id`, `task_id`, `status`, and timestamps.
- Model `Intervention` registered in `backend/app/models/intervention.py` and `backend/app/db/base.py`.
- Pydantic schemas declared in `backend/app/schemas/intervention.py` (`InterventionRead`, `InterventionSnoozeIn`, `InterventionListResponse`).

### B. Detection rule engine & background worker
- `backend/app/services/intervention_service.py` implements `run_detection_cycle()`:
  - Detects approaching deadlines within configured window (`now <= task.deadline <= now + approaching_hours`, default 24h).
  - Detects overdue tasks (`task.deadline < now`).
  - Excludes fixed commitments (`is_fixed == True`) and completed/done/cancelled tasks.
  - Automatically marks interventions as `resolved` when underlying task is completed, deleted, cancelled, or deadline cleared.
  - Automatically awakens snoozed interventions when `now >= snoozed_until`.
  - Database savepoints (`db.begin_nested()`) catch `IntegrityError` for concurrency-safe deduplication across multiple workers or threads.
  - Invariant verified: active schedules (`Schedule` / `ScheduleItem`) are never mutated by intervention detection or notifications.
- `backend/app/services/intervention_worker.py` runs short-lived DB sessions in a resilient background loop with isolated error handling.
- Integrated into FastAPI `lifespan` in `backend/app/main.py` with configurable polling interval and enablement flag in `backend/app/core/config.py`.

### C. API endpoints
- `GET /interventions?status=active`: lists user-isolated interventions, auto-awakening expired snoozes.
- `POST /interventions/{id}/dismiss`: marks status `dismissed` with timestamp.
- `POST /interventions/{id}/snooze`: marks status `snoozed` with validated future timestamp (HTTP 422 if past or invalid).
- `POST /interventions/check`: triggers on-demand detection cycle for test suites and live UI triggers.

### D. Frontend integration
- `frontend/src/api/client.js` exports `getInterventions`, `dismissIntervention`, and `snoozeIntervention` with transparent real/mock dispatch.
- `frontend/src/api/mock.js` mirrors the backend detection cycle, snooze awakening, validation, and persists to `orbit_demo_interventions`.
- `frontend/src/components/Shell.jsx` renders a neo-brutalist notification bell button with an active counter badge and popover dropdown listing alerts with "Snooze 3h" and "Dismiss" buttons.
- `frontend/src/pages/Today.jsx` renders a proactive alert banner at the top of the Today tab for urgent approaching/overdue deadlines with inline "Snooze 3h" and "Dismiss" buttons.
- Window event `orbit-interventions-updated` keeps the Shell notification bell and Today banner in instant synchronization upon user action.

## 7. Verified live end-to-end browser walkthrough with PostgreSQL

On 22 October 2026, an end-to-end live browser walkthrough with live PostgreSQL backend (`VITE_USE_MOCK=false`) was executed using the browser agent and verified:

1. **Signup & Onboarding**:
   - Created live account (`e2e_student_2026@test.com`) with password and name.
   - Stepped through all 12 stages of the onboarding questionnaire. Preferences successfully persisted to PostgreSQL.
2. **Task Creation & Plan Generation**:
   - Added task ("DBMS assignment due Friday, about 2 hours").
   - Generated today's plan; inspected the schedule on both Today (`/today`) and Week (`/week`) views.
3. **Disruption Assistant & Proposal Workflow**:
   - Submitted disruption ("College cancelled today") through the Something Changed assistant.
   - Verified that a quiet rebalance proposal was generated without mutating the active schedule prematurely.
   - Approved proposal via "Approve plan".
4. **Proactive Intervention Subsystem**:
   - Verified the proactive notification bell and modal dropdown in the Shell navigation bar.

## 8. Verified scheduler reliability & disruption persistence guard

On 22 October 2026, the scheduler reliability and disruption validation persistence guard was completed and regression-tested:

1. **Disruption Validation Persistence Guard**:
   - In `backend/app/api/routes/schedules.py`: repaired `_apply_disruption()` so that when `validate_plan()` detects problems or invalid placements, `_save()` is never called.
   - Violations are returned in the response (`violations: [...]`), leaving active schedule database rows completely untouched.
   - Regression test `test_disruption_validation_failure_does_not_persist_or_overwrite_schedule` added to `backend/tests/test_scheduler_integration.py` verifying row-level immutability upon disruption validation failure.
2. **Core Scheduler & Preference Reliability**:
   - Reconciled `_upsert_fixed_commitments` to accept and respect planning timestamp `now`, ensuring consistent multi-day and current-day boundary calculation between refresh and generation.
   - Verified robust `no_pref` handling in `load_user_rule_prefs`: non-clock values are cleanly converted to effective defaults without crashing string split or creating invalid windows.
3. **Fresh Verification Results**:
   - Focused suite (`test_fixed_commitments.py`, `test_fixed_commitment_refresh.py`, `test_fixed_commitment_regression_repair.py`, `test_onboarding_tasks.py`, `test_schedule_proposals.py`, `test_notes_and_replan.py`, `test_interventions.py`): **61 passed, 3 warnings in 35.57s**.
   - Scheduler integration suite (`test_scheduler_integration.py`): **6 passed, 2 warnings in 6.58s**.
   - Frontend Vitest suite: **60 passed, 0 failed in 25.08s** (`npm test` from `frontend/`).
   - Frontend production build: **Passed in 2.87s** (`npm run build` from `frontend/`).
   - `git diff --check`: clean (0 errors, zero trailing whitespace).

## 9. Current status and next task

### A. Current status
All four priorities (core scheduler reliability, universal validation persistence guard, safe Something Changed proposal workflow, and proactive interventions) are verified with regression tests and clean builds.

### B. Single next task
Present the verified implementation improvements to the user for final authorization to commit the feature branch.

## 7. Documentation maintenance — required after every batch

Update these two files together after each implementation batch.

### `ORBIT_HANDOFF.md`

Keep this document short and current. Update:

- Current architecture or implementation facts only when changed or reverified.
- Latest verified test/build results and their scope.
- Remaining high-impact defects.
- The single next bounded task.
- Any changed constraints or decisions.

Remove stale instructions and resolved defects. Do not paste the full chronological history here.

### `PROGRESS.md`

Append one dated entry for the completed batch containing:

- Product requirement advanced.
- Files changed and the purpose of each change.
- Tests/checks run and exact results.
- Checks not run and why.
- Known remaining issues.
- Commit status.

Do not rewrite history to make a failed check appear successful. Label older evidence as historical if it has not been rerun.

### Documentation rule

Never claim an implementation, test, manual check, or integration is complete without evidence. Keep the two files consistent: the handoff describes the current truth; the progress log records how that truth changed.

## 8. Required end-of-batch report

Return a concise report with:

1. **Outcome:** what measurable product behavior improved.
2. **Files changed:** and why.
3. **Verification:** exact commands and pass/fail counts.
4. **Not verified:** important checks not run.
5. **Remaining blocker:** if any.
6. **Documentation:** confirm both files were updated.
7. **Git:** confirm no commit was made.

Stop after this report. Do not automatically begin another task or request another agent run.

## Current verified status — 2026-10-22

- Backend full suite: **94 passed, 3 deprecation warnings** in 49.24s.
- Focused rule-engine suite: **9 passed** in 0.12s.
- Added regression test `test_overnight_sleep_respects_same_day_study_cutoff` covering an overnight sleep window, morning routine, evening study cutoff, and validator rejection of a placement crossing that cutoff.
- `git diff --check` passed after removing trailing whitespace from `backend/tests/test_rule_engine.py`.
- The whitespace-only cleanup was not followed by another pytest run; the 94-test result was recorded immediately before that cleanup.
- Frontend evidence (60 tests and production build) is from the earlier recorded run and has not been rerun in this batch.
- These results verify specific backend behaviors, **not completion of Orbit's full product scope**.

### Remaining product-level verification

The next bounded task is to verify the connected user journey using the real backend and persistence: onboarding preferences and fixed commitments -> generated schedule -> proposed schedule change -> explicit approval -> persisted result. Confirm the actual implementation and existing test coverage before changing code. Proactive interventions also remain part of the full scope and must not be considered complete solely because their tests pass.

No commit made. Preserve all existing working-tree changes.

## 2026-10-22 — Fixed-commitment proposal integration regression

- Added `test_onboarding_fixed_commitment_is_respected_by_proposal_and_approval` in `backend/tests/test_onboarding_tasks.py`.
- The test exercises the real onboarding, proposal, approval, and schedule retrieval endpoints.
- It verifies that the study task avoids the fixed commitment's protected time window in the proposal and in the approved schedule.
- The test uses a consistent current date for onboarding and scheduling to avoid mismatched test clocks.
- Verification: `tests/test_onboarding_tasks.py` and `tests/test_schedule_proposals.py` — **20 passed, 0 failed, 2 deprecation warnings** in 21.32s.
- Scope limitation: this verifies the tested fixed-commitment path, not every scheduling edge case or the full Orbit product.
- No commit made.

## 2026-10-22 — Repeated-unfinished-task proactive interventions

- **Implementation details & lifecycle verification:**
  - Implemented proactive detection in `backend/app/services/intervention_service.py`: detects non-fixed tasks with incomplete schedule items across $\ge 2$ distinct past calendar days (`end_time < now` and status not in `["completed", "done", "cancelled"]`).
  - Corrected date consistency check: ensures each schedule item's calendar date explicitly matches its parent `Schedule.date` (`item.start_time.date() == sched_date`). This prevents false positives from stale or mismatched item timestamps on a single schedule day while safely preserving legitimate historical sessions across distinct dates and across regenerated versions (`version > 1`).
  - Creates intervention titled `Plan check: {task.title}` with message `'{task.title}' has remained unfinished across {count} past planned days. Is the current plan not working?`
  - Deduplicated with key `{user.id}:{task.id}:repeated_unfinished`.
  - Auto-resolves active or snoozed interventions if the task is completed/done/cancelled/deleted or drops below 2 past unfinished planned days.
  - Decoupled deadline checks from task iteration so tasks without deadlines are also evaluated for repeated unfinished patterns.
  - Added frontend neo-brutalist styling in `frontend/src/pages/Today.css` and `frontend/src/components/Shell.css` with `#D4C5F9` / `#EDE4FF`.
  - Added mock parity in `frontend/src/api/mock.js` and fixed `loadStoredState()` schedule assignment.
  - **Worker Lifecycle & Reliability:** Verified FastAPI lifespan integration (`app/main.py`), idempotent startup, session cleanup in `finally` blocks, error logging, and graceful shutdown on app exit.
  - **Delivery Gaps (App-Closed Reality):** Orbit currently performs in-app rendering (Today banners and notification bell popover) and frontend polling (every 30s). When the app/browser is closed, interventions are detected and saved in PostgreSQL by the background worker, but no native push (Web Push/APNs/FCM) or email/SMS notifications exist. Delivery occurs only upon opening the application.
- **Verification evidence:**
  - Backend full suite: **107 passed, 3 deprecation warnings** in 64.41s (`pytest -q`).
  - Backend intervention suite: **24 passed** in 23.66s (`pytest tests/test_interventions.py -q`).
  - Frontend test suite: **62 passed** in 26.33s (`npm test`).
  - Frontend production build: **Clean build in 2.53s** (0 errors).
  - `git diff --check` passed cleanly with 0 whitespace errors.
## 2026-10-23 — Week Endpoint Fixed-Commitment Collision Repair

- **Defect fixed:**
  - In `backend/app/api/routes/schedules.py`: `get_week_spread()` previously appended persisted `ScheduleItem` records to each day's `day_items` without checking for collisions against fixed commitments. This caused saved or stale scheduled tasks to overlap fixed commitments (and their commute/transition buffers) in the Week view.
  - Repaired `get_week_spread()`: for each day, compiled `day_fixed_blocks` (from loaded constraint blocks and expanded user preferences) and evaluated saved schedule items against fixed commitments plus their protected commute and transition buffer (`timedelta(minutes=fb.commute_minutes) + TRANSITION_BUFFER`). Colliding saved entries are omitted from being presented as valid scheduled items.
  - Preserved underlying database records, statuses, and completion history without deleting `ScheduleItem` database rows.
- **Verification evidence:**
  - Added regression test `test_week_spread_omits_conflicting_saved_task_items` in `backend/tests/test_fixed_commitment_regression_repair.py`.
  - Confirmed test fails before the production change (`AssertionError: Lists differ: ['Stale Overlapping Session'] != []`) and passes cleanly after the fix.
  - Focused fixed-commitment suite (`tests/test_fixed_commitments.py`, `tests/test_fixed_commitment_refresh.py`, `tests/test_fixed_commitment_regression_repair.py`): **23 passed, 2 deprecation warnings** in 35.10s.
  - Underlying database record status and fields remained unchanged.
- **Scope limitation:**
  - Weekly summary metrics semantics (planned vs completed hours calculation) remain untouched per constraints.
- No commit made. Preserve all existing working-tree changes.


## 2026-10-23 — Quick Add Natural-Language Task Parsing Repair

- **Defect fixed:**
  - Quick Add in frontend/src/pages/Tasks.jsx previously stored the entire raw input string as the task title unless punctuation was present, failed to extract explicit calendar deadlines (defaulting to next Friday), and created timezone day shifts when formatting UTC timestamps (e.g. converting 23:59 local/UTC resulting in October 30 instead of October 29).
  - Repaired parsing in frontend/src/api/semanticParser.js:
    - Added parseDeadline(text, refDate) to extract calendar dates (e.g. oct 29, october 29th, 15th of nov, tomorrow, in 2 days, day-of-week) formatted as local end-of-day ISO string YYYY-MM-DDT23:59:00 without UTC day-shift rollover.
    - Added extractCleanTitle(rawText) to strip deadline clauses, duration phrases (needs 60 mins to complete), and priority qualifiers (Need To), yielding clean titles (assignment 2).
    - Integrated clean title and deadline directly into parseTaskSemantics() return contract.
  - In frontend/src/pages/Tasks.jsx, handleQuickAdd() now extracts title, deadline, estimated_duration, tier, and priority from parseTaskSemantics() and saves the task cleanly with its structured properties and confirmation message.
- **Verification evidence:**
  - Added unit regression test suite in frontend/tests/quick_add_parsing.test.js:
    - Verified exact reported input: 'assignment 2 due on oct 29. needs 60 mins to complete Need To' -> Title: 'assignment 2', Deadline: '2026-10-29T23:59:00' (Oct 29, 2026), Duration: 60, Tier: 'have_to', Priority: 5.
    - Verified date format variations and clean title parsing: 4 tests passed in 33.0ms.
  - Full frontend test suite (npm test): 66 passed (8 suites) in 26.64s.
  - Full backend pytest suite (pytest): 109 passed in 114.57s.
  - git diff --check: Clean (0 errors, 0 trailing whitespace).
- No commit made. Preserve all existing working-tree changes.

## 2026-10-24 — Adaptive Scheduling & Week View Disappearing Task Repair

- **Defect fixed:**
  - **Adaptive scheduling not adapting properly to disruptions ("Something changed"):**
    - `_parse_days_pattern` in `backend/app/api/routes/preferences.py` previously failed on common patterns (such as `"Daily"`, `"Every day"`, `"Weekdays"`, `"Mon-Fri"`, and comma-separated lists), causing recurring fixed commitments to be completely ignored by the scheduler.
    - `update_preferences` (`PUT /preferences`) previously saved preference JSON without invoking `refresh_fixed_commitments`, leaving the `Task(is_fixed=True)` table out of sync with preferences.
    - `refresh_fixed_commitments` was missing `db.flush()`, meaning newly upserted `Task` records were never flushed when `autoflush=False`, rendering them invisible to immediate queries in `_load()`.
    - `propose_schedule` (`POST /schedules/propose`) lacked deterministic handling of cancellations (e.g. "College cancelled today"), early arrivals/shortenings (e.g. "Got back home at 3 on Tuesday since lectures were cancelled"), and rest requests (exhaustion/burnout).
    - `approve_proposal` previously validated against static database fixed commitments instead of the proposal's `effective_fixed`, which falsely flagged valid adaptations into newly opened slots as 422 collision errors.
  - **Week view disappearing tasks & Today/Week agreement:**
    - When an adaptive proposal cancelled or shortened a fixed commitment, `approve_proposal` previously persisted `ScheduleItem` placements without updating the `Task(is_fixed=True)` occurrence in the database.
    - Furthermore, `get_week_spread` (`GET /schedules/week`) re-expanded the static weekly template from `prefs_dict` into `day_fixed_blocks` and used `if has_collision: continue`, which silently dropped newly scheduled study tasks from the Week view response.
    - Repaired `approve_proposal` to synchronize approved fixed commitment adjustments (marking cancelled occurrences as `Task.status = "cancelled"` and updating shortened durations).
    - Repaired `_load` to exclude cancelled tasks (`(~Task.status.in_(["completed", "done", "cancelled"]))`).
    - Repaired `_upsert_fixed_commitments` to preserve `cancelled` status across refreshes.
    - Repaired `get_week_spread` to track `cancelled_fixed_keys` so cancelled commitments are neither displayed as fixed anchors nor used to falsely filter out newly placed study tasks. Today and Week views now agree completely.
  - **Unauthenticated 401 response:**
    - Repaired `backend/app/core/deps.py` with `HTTPBearer(auto_error=False)` and explicit 401 Unauthorized raise when credentials are missing, passing `test_unauthenticated_requests_return_401`.
  - **Route hygiene:**
    - Removed duplicate `@router.delete("/{task_id}")` decorator in `backend/app/api/routes/tasks.py`.
- **Verification evidence:**
  - Added full end-to-end regression tests in `backend/tests/test_scheduler_integration.py`:
    - `test_adaptive_cancellation_opens_time_and_approves_cleanly`
    - `test_early_arrival_shortens_commitment_and_places_productive_work`
    - `test_urgent_task_insertion_minimal_change_and_displacement`
    - `test_insufficient_capacity_marks_unplaced_work_at_risk_without_violating_invariants`
    - `test_task_duration_change_and_completed_work_preservation`
  - Full backend pytest suite (`python -m pytest -q`): **115 passed, 0 failed** in 94.84s.
  - Full frontend test suite (`npm test`): **66 passed (8 suites), 0 failed** in 26.34s.
  - Production build (`npm run build`): **Clean build in 3.31s** (0 errors).
  - Real browser E2E execution (`orbit_browser_e2e`): Verified complete flow from navigation, Tasks quick-add parsing, 7-day Week spread, "Something changed" proposal creation and approval, and persistence in Today/Week views with 0 console errors.
  - `git diff --check`: Clean (0 whitespace/formatting errors).
- No commit made. Preserve all existing working-tree changes.

## 2026-10-24 — Changed Page UX Enhancement & End-to-End Verification

- **User report & root cause:**
  - User visited `http://localhost:5173/changed` and asked to verify if it was working properly.
  - The feature was executing accurately behind the scenes, but had three critical usability flaws causing the user to perceive it as inactive:
    1. **Below-the-fold proposal rendering without auto-scroll:** The header, prominent yellow input card, and four suggestion cards take up ~600px of height. On standard laptop viewports (e.g. 1536x730), when the user clicked "Reorganise plan" or clicked a suggestion card, the proposal card was rendered at Y > 850px completely off-screen. Without auto-scrolling, the button stopped spinning and the screen appeared completely unchanged, leading the user to believe the feature was not functioning.
    2. **Missing Enter-key submission on textarea:** Users naturally press `Enter` after typing their prompt. Previously, `<textarea>` inserted a newline rather than submitting.
    3. **Missing concrete schedule placements:** The proposal card previously only showed plain bullet points of what changed and at-risk items, but omitted the concrete proposed day timeline/placements that students need to see before approving.
- **Enhancements implemented:**
  - `frontend/src/pages/Changed.jsx`:
    - Added `formatTime()` helper.
    - Added `chatFlowRef` and `proposalRef` with `useEffect` auto-scroll hooks to smoothly bring the generated proposal card into view immediately upon submission.
    - Added `onKeyDown` to the `<textarea>` to submit on `Enter` (without Shift), plus a visible helper hint (`Press Enter ↵ or click to adapt`).
    - Added an interactive banner (`✨ Active plan proposal ready to review below ↓`) at the top of the input card if a user scrolls back up while reviewing a proposal.
    - Added the `Proposed Schedule Placements` timeline section into the proposal card, showing each day's planned time blocks, task titles, and badges (`Fixed`, `Focus`, `Buffer`, `Open`).
  - `frontend/src/pages/Changed.css`:
    - Added styles for the active proposal pill, submission hint, schedule preview container, day cards, slot pills, and kind badges conforming to the pop neo-brutalist theme.
- **Verification evidence:**
  - Full frontend test suite (`npm test`): **66 passed (8 suites), 0 failed** in 25.72s.
  - Frontend production build (`npm run build`): **Clean build in 1.65s** (0 errors).
  - Live browser subagent verification (`verify_changed_ux_flow`):
    - Navigated to `http://localhost:5173/changed`.
    - Typed "My afternoon class was cancelled today" and pressed `Enter`.
    - Verified automatic form submission and smooth scroll directly to the proposal card.
    - Verified proposed schedule placements timeline with all time slots and badges.
    - Verified scrolling up shows the active proposal pill.
    - Clicked "Approve plan" and verified clean update and navigation to `/today`.
  - `git diff --check`: Clean (0 whitespace/formatting errors).
- No commit made. Preserve all existing working-tree changes.

## 2026-10-27 — Security Remediation, PostgreSQL Live Smoke Test & Complete Lint Zeroing

### A. Working-tree state & branch inspection
- Current active branch: `aniket_fix` at commit `2fa8d8c` (parent `c7eb472` on `feature/orbit-product`).
- The duplicate `@router.delete("/{task_id}")` decorator previously flagged in `backend/app/api/routes/tasks.py` had already been removed in `2fa8d8c`.
- Fixed a weekday-boundary calculation bug in `backend/tests/test_fixed_commitment_regression_repair.py` (`test_repeated_refresh_is_idempotent`), where testing on Tuesdays previously caused a 7-day boundary double-counting mismatch.

### B. Configuration & security remediation
- Sanitized `backend/.env.example`: replaced actual-looking `GEMINI_API_KEY` and `JWT_SECRET` values with safe placeholders (`your_gemini_api_key_here`, `your_jwt_secret_change_in_production`).
- CORS origin made fully configurable: added `cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"` to `backend/app/core/config.py` and configured `CORSMiddleware` in `backend/app/main.py` to parse comma-separated origin lists, preventing hardcoded production deployment restrictions.

### C. Live-backend PostgreSQL smoke test (All 8 Journeys Verified)
Ran dedicated test against live FastAPI with real PostgreSQL 18 cluster (at `localhost:5433`, database `orbit_db`, Alembic head `c1d2e3f4a5b6_create_interventions_table`):
1. **Onboarding & Preferences:** Signup (`smoke_20261027_183204@orbit.test`), login, questionnaire completion. Saved wake/sleep (07:30/23:30), commute (15m), focus length (45m), and inserted fixed commitments into `tasks` table (`Evening Seminar` on Tuesdays 19:30-21:00).
2. **Fixed Commitments & Buffers:** Generated schedule; fixed commitment placed at 19:30-21:00 and commute buffers (19:15-21:15) strictly respected without task collision.
3. **Today & Week View Agreement:** `GET /schedules` and `GET /schedules/week` for the same date confirmed identical (4 activities across both endpoints; 0 dropped or missing tasks).
4. **Task Addition & Proposal Generation:** Added urgent task (`Urgent Lab Report`, 90 mins, due tomorrow); `/schedules/propose` generated structured displacement proposal without mutating active schedule rows.
5. **Approval & Rejection Safety:** Rejection left active schedule untouched. Explicit approval applied reviewed placements to the active schedule.
6. **Disruption Validation Persistence Guard:** Invalid disruption request rejected by rule validator; verified row-level immutability with zero database corruption.
7. **Proactive Intervention Lifecycle:** Approaching deadline detected (`Approaching deadline: Urgent Lab Report`), deduplicated via `uq_interventions_dedup_key`, snoozed with valid future timestamp, and dismissed cleanly.
8. **Cold Restart & Persistence Consistency:** Re-instantiated fresh database connection and client simulating server restart; verified user, preferences, active schedules, and interventions remain 100% consistent.
- Re-run script persisted at: `scratch/live_smoke_test.py`.

### D. Complete ESLint cleanup (41 errors + 4 warnings -> 0 errors, 0 warnings)
Cleaned all ESLint errors across the frontend without introducing unrelated refactors:
- `frontend/src/pages/Today.jsx`: Removed unused `unclosedNotice` and `checkUnclosedPastDay`, removed unused `stackStageRef`, unwrapped frontCard IIFE into direct JSX, memoized `items`, moved `computeSnoozeIso` outside component scope, and bound card navigation callbacks cleanly.
- `frontend/src/pages/Week.jsx`: Memoized `days` and `groups` with `useMemo`, updated `setSelectedDayDate` to use a functional updater eliminating missing dependency warning.
- `frontend/src/pages/Insights.jsx`: Removed unused `loading` state, refactored data fetching inside `useEffect`.
- `frontend/src/components/Shell.jsx`: Removed unused `IS_DEV` and `useCallback`, moved `computeSnoozeIso` outside component scope, and structured data fetching inside `useEffect`.
- `frontend/src/api/mock.js`: Removed unused imports (`parseDeadline`, `extractCleanTitle`), removed unused module-level `today` and `friday`, removed unused `baseDateObj` parameter from `getOneTimeTargetDates`, and removed unused `parseDeadlineFromText`.
- `frontend/src/api/semanticParser.js`: Fixed regex hyphen escapes and declared variable bindings cleanly.
- `frontend/src/pages/Onboarding.jsx`: Removed unused Lucide icon imports.
- `frontend/tests/onboarding.test.js`: Resolved useless assignment to `loading`.

### E. Current test & build verification summary
- **Backend pytest suite:** **115 passed**, 0 failed (`python -m pytest -q` in `backend/`).
- **Frontend test suite:** **66 passed**, 0 failed (`npm test` in `frontend/`).
- **Frontend production build:** **Clean build in 2.49s** (`npm run build` in `frontend/`).
- **ESLint:** **0 errors, 0 warnings** (`npm run lint` in `frontend/`).
- **`git diff --check`:** **Clean (0 whitespace errors)**.

### F. Explicitly documented limitations & deferred scope
- **LLM integration:** Limited to `POST /schedules/disrupt-text` and an initial attempt on `POST /schedules/propose`. `/notes/understand`, `/schedules/replan`, and frontend semantic parsing rely on deterministic heuristics. Deterministic scheduling functions as an intentional resilient fallback. Orbit is an adaptive deterministic companion, not a freeform chatbot.
- **Behavioral personalization:** User feedback and reflections are stored in PostgreSQL, but behavioral adaptive learning from historical completion logs is not yet implemented into the scheduler rule engine (deferred to post-P0).
- **Insights backend endpoint:** The Insights UI exists with interactive demo capabilities; a production analytics backend endpoint is deferred.
- **Voice, timetable image import, and meal planning:** Not implemented and deferred for future releases.
- **Push notification delivery:** Interventions are detected and stored by background workers; delivery occurs in-app via notification bell and banners (native Web Push / APNs not yet integrated).

- No commit made. Preserved all working-tree modifications.
