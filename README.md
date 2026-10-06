# Orbit

### An adaptive student life companion

**Balance without burnout.**

Orbit is an adaptive planning companion designed around how students actually live: changing deadlines, fixed commitments, recurring responsibilities, personal priorities, energy fluctuations, missed tasks, and limited attention.

Unlike a conventional timetable generator, Orbit does not simply place tasks into empty calendar slots. It builds a schedule around the student's constraints and preferences, understands natural-language task instructions, and adapts the plan when circumstances change.

---

## Why Orbit?

Students rarely struggle because they cannot make a timetable.

The real problem is that the timetable stops working as soon as real life happens.

A class runs late.
A deadline gets closer.
A task takes longer than expected.
A student misses a planned study block.
Energy is low after a long day.
A personal activity needs to be protected too.

Traditional planners generally treat these situations as exceptions that the user has to fix manually.

Orbit treats them as part of the planning problem.

### Core idea

> **A good student plan should adapt to the student, not force the student to adapt to the plan.**

---

## Key Features

### 1. Adaptive onboarding

Orbit begins by learning the student's planning context instead of starting with a blank calendar.

The onboarding flow captures:

* Wake-up and bedtime
* Fixed commitments
* Week structure
* Commute and transition time
* Need-to responsibilities
* Should-do responsibilities
* Like-to activities
* Hobby preferences
* Preferred energy periods
* Focus style
* Break preferences
* Task-initiation preferences
* Overload patterns
* Task-splitting preferences
* Desired level of structure
* Weekend preferences

At the end of onboarding, Orbit generates a personalized summary of what it learned.

---

### 2. Three-level priority model

Orbit separates responsibilities according to their role in a student's life.

| Priority      | Purpose                               | Examples                                            |
| ------------- | ------------------------------------- | --------------------------------------------------- |
| **Need To**   | Must be completed                     | Assignments, projects, submissions, exams           |
| **Should Do** | Important recurring/growth activities |  exercise, skill development, academic practice |
| **Like To**   | Personal balance and interests        | Reading, hobbies, journaling, creative activities   |

These are not hard-coded activities.

Students define their own responsibilities, meaning the system can adapt to students from different disciplines and lifestyles.

---

### 3. Natural-language task input

Students do not have to describe every task through rigid forms.

Orbit can interpret natural-language instructions such as:

```text
assignment, 40 mins
```

or:

```text
gym, preferably morning, unless that conflicts with fixed commitments
```

The parser extracts useful scheduling information such as:

* Task type
* Priority
* Duration
* Frequency
* Deadline
* Preferred time
* Avoided time
* Scheduling constraints
* Splitting preferences
* Contextual notes

Orbit then shows the user what it understood before using that information for scheduling.

The natural-language layer is intentionally lightweight and local rather than depending on a paid external LLM API.

---

### 4. Constraint-aware scheduling

Orbit builds schedules around a hierarchy of constraints.

#### Hard constraints

1. Wake and sleep boundaries
2. Fixed commitments
3. Commute and transition buffers

#### Human needs

4. Meals
5. Recovery time
6. Wind-down time
7. Reasonable daily workload

#### High-value work

8. Deadline-driven tasks
9. Need-to responsibilities
10. Important should-do work

#### Personalization

11. Energy preferences
12. Task-initiation preferences
13. Focus style
14. Break preferences
15. Cognitive-load distribution

#### Personal life

16. Like-to activities
17. Hobbies
18. Open blocks
19. Recovery and personal time

Lower-priority activities are allowed to remain unscheduled when the day does not have enough room.

Orbit intentionally avoids filling every available minute.

---

### 5. Independent schedule blocks

Orbit follows an important scheduling principle:

> **A missed block does not cancel the rest of the day.**

Each scheduled block is treated independently.

If a student misses one study session, Orbit does not automatically shift every subsequent activity.

This prevents the common "domino effect" where one missed task makes an entire timetable unusable.

---

### 6. Protected buffers

Buffers are treated differently from tasks.

They are protected time around commitments and transitions rather than activities that need to be completed.

For example:

```text
09:00 – 12:00   College
12:00 – 12:15   Transition
12:15 – 13:00   Lunch
```

The transition period protects the next activity from being squeezed by the previous one.

Buffers are therefore not counted as completed tasks or productivity blocks.

---

### 7. Adaptive replanning

Orbit can react to changes during the day.

Examples include:

```text
"After the hospital rotation I am too tired for Clinical Practice. Move it."
```

or closing the day with unfinished tasks.

Orbit can then:

* Identify the affected task
* Consider existing commitments
* Find another suitable slot
* Avoid duplicate occurrences
* Preserve already completed work
* Respect future schedule constraints
* Move lower-priority work when necessary

The goal is not simply to "move everything."

The goal is to make the smallest sensible change while preserving the rest of the plan.

---

### 8. Day closure

At the end of a day, Orbit can distinguish between:

* Completed work
* Unfinished one-time tasks
* Recurring activities
* Fixed commitments

Unfinished applicable work can be carried forward into available future slots.

Recurring habits are not blindly duplicated just because they were missed.

This prevents situations such as:

> Missed Monday gym → Tuesday now contains two gym sessions.

---

### 9. Weekly planning

Orbit works across the full week rather than treating every day as an isolated schedule.

The interface provides:

* Monday
* Tuesday
* Wednesday
* Thursday
* Friday
* Saturday
* Sunday

This allows recurring responsibilities and one-time deadlines to be distributed across the available planning horizon.

---

## Scheduling Philosophy

Orbit is built around several principles.

### 1. Hard constraints come first

Sleep, fixed commitments, and required transitions cannot simply be overwritten by a task.

### 2. Deadlines are distributed

A four-hour project due several days later should not automatically become one giant block in the first available slot.

Orbit can distribute larger work across the available runway.

### 3. Not every free minute needs a task

Empty time can be intentional.

Open blocks provide room for:

* Friends and family
* Hobbies
* Recovery
* Unexpected work
* Rest
* Personal errands

### 4. Recurring and one-time work are different

A missed recurring habit should not automatically become another permanent task.

A deadline-driven assignment, on the other hand, needs to remain visible until it is completed or reaches its deadline.

### 5. Personalization affects scheduling

The system does not treat all students or all tasks identically.

A student's preferred energy period, focus style, task-initiation strategy, and break preferences can influence where and how work is scheduled.

---

## Architecture


┌───────────────────────────────┐
│          React / Vite         │
│                               │
│  Onboarding                   │
│  Tasks                        │
│  Weekly Schedule              │
│  Adaptation / Day Closure     │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│        API Abstraction        │
│                               │
│        client.js              │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│       Orbit Mock API          │
│                               │
│  Task management              │
│  Preferences                  │
│  Schedule generation          │
│  Replanning                   │
│  Day closure                  │
│  Persistence                  │
└───────────────┬───────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌───────────────┐  ┌────────────────┐
│ Semantic      │  │ Local Storage  │
│ Parser        │  │                │
│               │  │ Tasks          │
│ Natural       │  │ Preferences    │
│ language →    │  │ Schedules      │
│ structured    │  │ Notes          │
│ preferences   │  │                │
└───────────────┘  └────────────────┘
```

The frontend API layer keeps the UI independent from the current mock implementation, allowing the backend implementation to be introduced later without rewriting the application interface.

---

## Technology Stack

### Frontend

* React
* Vite
* JavaScript
* CSS
* Lucide React

### Current application layer

* Local mock API
* Browser `localStorage`
* Deterministic scheduling engine
* Lightweight semantic parser

### Planned backend direction

The project architecture is designed to support a  backend using:

* FastAPI
* PostgreSQL
* Persistent user accounts
* Server-side scheduling
* Production API endpoints

The current demo intentionally uses local persistence so the adaptive planning experience can be developed and demonstrated independently of backend infrastructure.

---

## Project Structure

```text
Orbit/
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.js
│   │   │   ├── mock.js
│   │   │   └── semanticParser.js
│   │   │
│   │   ├── components/
│   │   │   └── ...
│   │   │
│   │   ├── pages/
│   │   │   ├── Onboarding.jsx
│   │   │   ├── Tasks.jsx
│   │   │   └── Today.jsx
│   │   │
│   │   └── ...
│   │
│   ├── package.json
│   └── ...
│
└── README.md
```

---

The semantic parser can additionally generate scheduling preferences from natural-language instructions.

This creates a separation between:

```text
User input
     ↓
Semantic understanding
     ↓
Structured task metadata
     ↓
Scheduling engine
     ↓
Schedule
```

This separation is important because the scheduling engine does not need to understand raw language. It operates on structured constraints.

---

## Design Principles

Orbit is guided by the following principles:

**User-defined, not hard-coded**

The system should work for different students and disciplines instead of assuming that everyone has the same subjects, routines, or hobbies.

**Adaptive, not static**

The schedule should be able to change when the user's circumstances change.

**Human-aware, not productivity-maximizing**

More scheduled hours does not automatically mean a better plan.

**Flexible but structured**

Students should have enough structure to know what to do without feeling trapped by the schedule.

**Persistent context**

The long-term goal is for Orbit to understand a student's planning context instead of requiring them to repeatedly explain it.

---

## Orbit vs. Traditional Planners

| Traditional Planner            | Orbit                                     |
| ------------------------------ | ----------------------------------------- |
| Static timetable               | Adaptive schedule                         |
| User manually rearranges tasks | Orbit can replan                          |
| Tasks treated mostly equally   | Priority hierarchy                        |
| Rigid form-based input         | Natural-language task input               |
| Free time often gets filled    | Intentional open blocks                   |
| Missed tasks disrupt the plan  | Missed work can be rescheduled            |
| Limited personal context       | Behavioral preferences influence planning |
| Calendar-centric               | Student-centric                           |

---


## Testing

Orbit has been developed with focused verification of its scheduling and adaptation logic.

Tested areas include:

* Task creation and deletion
* One-time tasks
* Recurring tasks
* Weekly scheduling
* Deadline handling
* Task priority inference
* Natural-language parsing
* Schedule regeneration
* Duplicate prevention
* Missed-task rescheduling
* Day closure
* Adaptive task relocation
* Seven-day schedule generation
* Persistence across refreshes

The scheduling layer is designed to preserve existing schedule state while regenerating stale or invalid cached schedules when the scheduler version changes.

---

## Product Vision

Orbit's long-term goal is not to create another productivity dashboard.

It is to create a planning system that understands that student life is dynamic.

A student's schedule contains more than:

```text
Task → Time → Done
```

It contains:

```text
Commitments
    +
Deadlines
    +
Energy
    +
Habits
    +
Preferences
    +
Personal life
    +
Unexpected changes
    ↓
Adaptive plan
```

Orbit aims to make that adaptive loop continuous.

> **Plan. Live. Adapt. Repeat.**

---

