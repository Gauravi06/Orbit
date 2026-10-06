import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Sun,
  Moon,
  Laptop,
  Plus,
  Trash2,
  Clock,
  Calendar,
  Sparkles,
  MapPin,
  ListTodo,
  Heart,
  BookOpen,
} from 'lucide-react';
import { saveOnboarding, generateSchedule } from '../api/client';
import { useTheme } from '../theme/useTheme';
import ThemeToggle from '../components/ThemeToggle';
import './Onboarding.css';

const TOTAL_STEPS = 12;

const PALETTE_OPTIONS = [
  {
    id: 'terracotta',
    name: 'Terracotta',
    desc: 'Paper & warm brick focus',
    light: { bg: '#F4EFE6', surface: '#FBF8F2', accent: '#B24322', sage: '#536D58' },
    dark: { bg: '#14120F', surface: '#1C1915', accent: '#E0875F', sage: '#8FAE93' },
  },
  {
    id: 'sage',
    name: 'Sage',
    desc: 'Forest moss & calm blue rest',
    light: { bg: '#EFF3EF', surface: '#F7FAF7', accent: '#3F6B4A', sage: '#3B6079' },
    dark: { bg: '#0F1510', surface: '#161E17', accent: '#8FBF8F', sage: '#8EB5D1' },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    desc: 'Evening indigo & quiet slate',
    light: { bg: '#F0F1F7', surface: '#F8F8FC', accent: '#4A55A2', sage: '#46645E' },
    dark: { bg: '#10111A', surface: '#171926', accent: '#9AA5F0', sage: '#87AEA5' },
  },
  {
    id: 'plum',
    name: 'Plum',
    desc: 'Deep berry & eucalyptus',
    light: { bg: '#F6F0F2', surface: '#FAF5F7', accent: '#A3365B', sage: '#466453' },
    dark: { bg: '#170E12', surface: '#21141B', accent: '#E58AA6', sage: '#8DAF97' },
  },
];

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const { mode, palette, setMode, setPalette } = useTheme();
  const [modePreference, setModePreference] = useState('device');

  // Active day tab for "different_weekdays" mode
  const [activeDayTab, setActiveDayTab] = useState('Monday');

  // Input draft states for adding items
  const [draftCommitment, setDraftCommitment] = useState({
    name: '',
    start_time: '09:00',
    end_time: '12:00',
  });

  const [draftNeedTo, setDraftNeedTo] = useState({
    name: '',
    deadline: '',
    duration: '',
  });

  const [draftShouldDo, setDraftShouldDo] = useState({
    name: '',
    frequency: 'Daily',
    duration: '',
  });

  const [draftLikeTo, setDraftLikeTo] = useState({
    name: '',
    frequency: '2-3x a week',
    duration: '',
  });

  // Complete student profile data model
  const [profile, setProfile] = useState({
    // 1. Basic Routine
    wake_time: '07:00',
    sleep_time: '23:30',
    routine_notes: '',

    // 2. Week Structure
    week_structure: 'same_weekdays', // 'same_weekdays' | 'different_weekdays'

    // 3. Fixed Commitments (User-created only, zero default assumptions)
    fixed_commitments: [],

    // 4. Need To, Should Do, Like To (User-created only)
    need_to_items: [],
    should_do_items: [],
    like_to_items: [],

    // 5. Hobby / Personal Time
    hobby_preference: 'flexible', // 'regular' | 'flexible' | 'when_room' | 'no_pref'

    // 6. Behavioral Questions
    task_initiation: 'tiny_step',
    initiation_custom: '',

    focus_style: 'medium', // 'short' | 'medium' | 'long' | 'depends' | 'no_pref'
    break_preference: 'after_session', // 'frequent' | 'after_session' | 'fewer_longer' | 'when_needed' | 'no_pref'

    energy: 'evening', // 'morning' | 'afternoon' | 'evening' | 'varies' | 'not_sure'
    overload_pattern: 'struggle_start',
    overload_custom: '',

    task_splitting: 'large', // 'yes' | 'large' | 'self' | 'no'
    structure: 'balanced', // 'structured' | 'balanced' | 'flexible' | 'not_sure'
    weekend_mode: 'flexible', // 'structure' | 'flexible' | 'recovery' | 'weekdays'
  });

  const navigate = useNavigate();

  // Commitment helpers
  const handleAddCommitment = () => {
    if (!draftCommitment.name.trim()) return;
    const newId = 'comm_' + Date.now();
    const days = profile.week_structure === 'same_weekdays' ? 'Monday–Friday' : activeDayTab;

    const newComm = {
      id: newId,
      name: draftCommitment.name.trim(),
      days,
      start_time: draftCommitment.start_time,
      end_time: draftCommitment.end_time,
      commute_before: 15,
      commute_after: 15,
    };

    setProfile((prev) => ({
      ...prev,
      fixed_commitments: [...prev.fixed_commitments, newComm],
    }));

    setDraftCommitment({
      name: '',
      start_time: '09:00',
      end_time: '12:00',
    });
  };

  const handleRemoveCommitment = (id) => {
    setProfile((prev) => ({
      ...prev,
      fixed_commitments: prev.fixed_commitments.filter((c) => c.id !== id),
    }));
  };

  const handleUpdateCommute = (id, field, value) => {
    setProfile((prev) => ({
      ...prev,
      fixed_commitments: prev.fixed_commitments.map((c) =>
        c.id === id ? { ...c, [field]: Number(value) } : c
      ),
    }));
  };

  // Task helpers
  const handleAddNeedTo = () => {
    if (!draftNeedTo.name.trim()) return;
    const item = {
      id: 'nt_' + Date.now(),
      name: draftNeedTo.name.trim(),
      deadline: draftNeedTo.deadline || null,
      duration: draftNeedTo.duration ? Number(draftNeedTo.duration) : null,
    };
    setProfile((prev) => ({
      ...prev,
      need_to_items: [...prev.need_to_items, item],
    }));
    setDraftNeedTo({ name: '', deadline: '', duration: '' });
  };

  const handleRemoveNeedTo = (id) => {
    setProfile((prev) => ({
      ...prev,
      need_to_items: prev.need_to_items.filter((i) => i.id !== id),
    }));
  };

  const handleAddShouldDo = () => {
    if (!draftShouldDo.name.trim()) return;
    const item = {
      id: 'sd_' + Date.now(),
      name: draftShouldDo.name.trim(),
      frequency: draftShouldDo.frequency || 'Regularly',
      duration: draftShouldDo.duration ? Number(draftShouldDo.duration) : null,
    };
    setProfile((prev) => ({
      ...prev,
      should_do_items: [...prev.should_do_items, item],
    }));
    setDraftShouldDo({ name: '', frequency: 'Daily', duration: '' });
  };

  const handleRemoveShouldDo = (id) => {
    setProfile((prev) => ({
      ...prev,
      should_do_items: prev.should_do_items.filter((i) => i.id !== id),
    }));
  };

  const handleAddLikeTo = () => {
    if (!draftLikeTo.name.trim()) return;
    const item = {
      id: 'lt_' + Date.now(),
      name: draftLikeTo.name.trim(),
      frequency: draftLikeTo.frequency || 'Weekly',
      duration: draftLikeTo.duration ? Number(draftLikeTo.duration) : null,
    };
    setProfile((prev) => ({
      ...prev,
      like_to_items: [...prev.like_to_items, item],
    }));
    setDraftLikeTo({ name: '', frequency: '2-3x a week', duration: '' });
  };

  const handleRemoveLikeTo = (id) => {
    setProfile((prev) => ({
      ...prev,
      like_to_items: prev.like_to_items.filter((i) => i.id !== id),
    }));
  };

  const handleModeChange = (selected) => {
    setModePreference(selected);
    if (selected === 'device') {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      setMode(isDark ? 'dark' : 'light');
    } else {
      setMode(selected);
    }
  };

  // Onboarding completion
  const handleFinish = async () => {
    setLoading(true);
    try {
      // Map focus style to legacy number for backward-compatible mock helpers
      let focusLengthNum = 90;
      if (profile.focus_style === 'short') focusLengthNum = 45;
      else if (profile.focus_style === 'medium') focusLengthNum = 60;
      else if (profile.focus_style === 'long') focusLengthNum = 120;

      const allowSplitting =
        profile.task_splitting === 'yes' ||
        profile.task_splitting === 'large' ||
        profile.task_initiation === 'tiny_step';

      const preferLong = profile.focus_style === 'long' || profile.structure === 'structured';

      let energyTime = 'evening';
      if (profile.energy === 'morning') energyTime = 'morning';
      else if (profile.energy === 'afternoon') energyTime = 'afternoon';
      else if (profile.energy === 'evening') energyTime = 'evening';

      // Assemble full structured onboarding payload
      const payload = {
        // Core constraints & week structure
        wake_time: profile.wake_time,
        sleep_time: profile.sleep_time,
        routine_notes: profile.routine_notes,
        week_structure: profile.week_structure,

        // Actual user-supplied commitments with commute buffers
        fixed_commitments: profile.fixed_commitments,

        // Actual user-supplied priority tiers
        need_to_items: profile.need_to_items,
        should_do_items: profile.should_do_items,
        like_to_items: profile.like_to_items,
        hobby_preference: profile.hobby_preference,

        // Behavioral profiles
        task_initiation: profile.task_initiation,
        initiation_custom: profile.initiation_custom,
        focus_style: profile.focus_style,
        break_preference: profile.break_preference,
        energy_preference: profile.energy,
        overload_pattern: profile.overload_pattern,
        overload_custom: profile.overload_custom,
        task_splitting: profile.task_splitting,
        structure_preference: profile.structure,
        weekend_mode: profile.weekend_mode,

        // Legacy compatibility properties
        focus_length: focusLengthNum,
        prefer_long_sessions: preferLong,
        allow_splitting: allowSplitting,
        best_time_of_day: energyTime,
        juggles: profile.fixed_commitments.map((c) => c.name.toLowerCase()),
        anything_else: [
          profile.initiation_custom ? `Initiation: ${profile.initiation_custom}` : '',
          profile.overload_custom ? `Overload: ${profile.overload_custom}` : '',
          profile.routine_notes ? `Routine: ${profile.routine_notes}` : '',
        ]
          .filter(Boolean)
          .join('; '),

        // Visual theme
        palette,
        mode,
      };

      await saveOnboarding(payload);
      await generateSchedule();
    } catch {
      // Ignore network errors in demo mode and proceed
    } finally {
      setLoading(false);
      navigate('/today');
    }
  };

  const nextStep = () => {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  // Filter commitments for current tab when in different_weekdays mode
  const visibleCommitments =
    profile.week_structure === 'same_weekdays'
      ? profile.fixed_commitments
      : profile.fixed_commitments.filter((c) => c.days === activeDayTab);

  return (
    <div className="onboarding-page">
      <header className="onboarding-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-md)', color: 'var(--accent)' }}>◐</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'bold' }}>Orbit</span>
        </div>
        <ThemeToggle showLabel={false} />
      </header>

      <div className="onboarding-container">
        {/* Progress Tracker */}
        <div>
          <div className="onboarding-progress-track">
            <div className="onboarding-progress-bar" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
          </div>
          <div className="onboarding-step-meta">
            <span>STEP {step} OF {TOTAL_STEPS}</span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0', fontSize: 'var(--text-xs)', height: 'auto' }}
              onClick={handleFinish}
            >
              Skip setup
            </button>
          </div>
        </div>

        <div className="onboarding-card">
          {/* STEP 1: Basic Routine */}
          {step === 1 && (
            <>
              <div>
                <h1 className="onboarding-question-title">What is your basic daily routine?</h1>
                <p className="onboarding-question-hint">
                  Orbit treats sleep and wake times as real boundaries, never scheduling study or tasks outside your active window.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label htmlFor="wake-time">What time do you usually wake up?</label>
                  <input
                    id="wake-time"
                    type="time"
                    className="input"
                    value={profile.wake_time}
                    onChange={(e) => setProfile({ ...profile, wake_time: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="sleep-time">What time do you usually go to sleep?</label>
                  <input
                    id="sleep-time"
                    type="time"
                    className="input"
                    value={profile.sleep_time}
                    onChange={(e) => setProfile({ ...profile, sleep_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="routine-notes">Any quirks about your daily rhythm? (optional)</label>
                <input
                  id="routine-notes"
                  type="text"
                  className="input"
                  placeholder="e.g. Wake up earlier on clinic days, sleep in slightly on Fridays"
                  value={profile.routine_notes}
                  onChange={(e) => setProfile({ ...profile, routine_notes: e.target.value })}
                />
              </div>
            </>
          )}

          {/* STEP 2: Week Structure */}
          {step === 2 && (
            <>
              <div>
                <h1 className="onboarding-question-title">How does your typical weekday schedule work?</h1>
                <p className="onboarding-question-hint">
                  Tell Orbit whether your fixed commitments follow a consistent weekday pattern or change day by day.
                </p>
              </div>

              <div className="onboarding-options">
                {[
                  {
                    value: 'same_weekdays',
                    title: 'Most weekdays are similar',
                    desc: 'You have a recurring schedule across Monday to Friday (e.g. regular classes, shifts, or studio time).',
                  },
                  {
                    value: 'different_weekdays',
                    title: 'Every weekday is different',
                    desc: 'Your schedule varies day by day (e.g. rotations on Tuesday, lab on Thursday, work on Friday).',
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`onboarding-option-btn ${profile.week_structure === opt.value ? 'selected' : ''}`}
                    onClick={() => setProfile({ ...profile, week_structure: opt.value })}
                  >
                    <div className="onboarding-radio-dot">
                      {profile.week_structure === opt.value && <div className="onboarding-radio-dot-inner" />}
                    </div>
                    <div>
                      <div className="onboarding-option-title">{opt.title}</div>
                      <div className="onboarding-option-desc">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* STEP 3: Fixed Commitments Editor */}
          {step === 3 && (
            <>
              <div>
                <h1 className="onboarding-question-title">
                  {profile.week_structure === 'same_weekdays'
                    ? 'What fixed commitments do you have on weekdays?'
                    : 'What fixed commitments do you have each weekday?'}
                </h1>
                <p className="onboarding-question-hint">
                  Orbit anchors these times and will never move or displace them with flexible tasks.
                </p>
              </div>

              {/* Day Tabs if "different_weekdays" */}
              {profile.week_structure === 'different_weekdays' && (
                <div className="onboarding-day-tabs">
                  {WEEKDAYS.map((day) => {
                    const count = profile.fixed_commitments.filter((c) => c.days === day).length;
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`onboarding-day-tab ${activeDayTab === day ? 'active' : ''}`}
                        onClick={() => setActiveDayTab(day)}
                      >
                        <span>{day}</span>
                        {count > 0 && <span style={{ opacity: 0.75 }}> ({count})</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Added Commitments List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
                  {profile.week_structure === 'same_weekdays'
                    ? `WEEKDAY COMMITMENTS (${profile.fixed_commitments.length})`
                    : `${activeDayTab.toUpperCase()} COMMITMENTS (${visibleCommitments.length})`}
                </div>

                {visibleCommitments.length === 0 ? (
                  <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 'var(--text-xs)', border: '1px dashed var(--line)', borderRadius: 'var(--radius-sm)' }}>
                    No fixed commitments added yet for this {profile.week_structure === 'same_weekdays' ? 'weekday template' : activeDayTab}. Add any lectures, lab shifts, clinics, or work blocks below.
                  </div>
                ) : (
                  visibleCommitments.map((c) => (
                    <div key={c.id} className="item-entry-card">
                      <div>
                        <div className="item-entry-title">{c.name}</div>
                        <div className="item-entry-sub">
                          {c.start_time} – {c.end_time} • {c.days}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-1)', height: 'auto', color: 'var(--ink-muted)' }}
                        onClick={() => handleRemoveCommitment(c.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Commitment Form */}
              <div className="add-item-box">
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--ink)' }}>
                  Add a fixed commitment:
                </div>
                <div className="add-item-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. College lecture, Hospital rotation, Lab, Work shift, Gym"
                    value={draftCommitment.name}
                    onChange={(e) => setDraftCommitment({ ...draftCommitment, name: e.target.value })}
                  />
                  <input
                    type="time"
                    className="input"
                    value={draftCommitment.start_time}
                    onChange={(e) => setDraftCommitment({ ...draftCommitment, start_time: e.target.value })}
                  />
                  <input
                    type="time"
                    className="input"
                    value={draftCommitment.end_time}
                    onChange={(e) => setDraftCommitment({ ...draftCommitment, end_time: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAddCommitment}
                    disabled={!draftCommitment.name.trim()}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </>
          )}

          {/* STEP 4: Commute / Transition Time */}
          {step === 4 && (
            <>
              <div>
                <h1 className="onboarding-question-title">How much transition time do you need for each commitment?</h1>
                <p className="onboarding-question-hint">
                  Orbit uses these to protect real travel and decompression buffers around your fixed blocks.
                </p>
              </div>

              {profile.fixed_commitments.length === 0 ? (
                <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 'var(--text-sm)', border: '1px dashed var(--line)', borderRadius: 'var(--radius-sm)' }}>
                  No fixed commitments were added. You can continue, or go back if you have lectures, shifts, or travel blocks to protect.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {profile.fixed_commitments.map((c) => (
                    <div key={c.id} className="commute-card">
                      <div className="commute-card-header">
                        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                          {c.name} ({c.days})
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
                          {c.start_time} – {c.end_time}
                        </span>
                      </div>

                      <div className="commute-inputs-row">
                        <div className="form-group">
                          <label style={{ fontSize: '11px' }}>Travel / buffer before:</label>
                          <select
                            className="input"
                            value={c.commute_before}
                            onChange={(e) => handleUpdateCommute(c.id, 'commute_before', e.target.value)}
                          >
                            <option value={0}>0 mins (No buffer needed)</option>
                            <option value={10}>10 mins</option>
                            <option value={15}>15 mins</option>
                            <option value={30}>30 mins</option>
                            <option value={45}>45 mins</option>
                            <option value={60}>60 mins</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label style={{ fontSize: '11px' }}>Travel / buffer after:</label>
                          <select
                            className="input"
                            value={c.commute_after}
                            onChange={(e) => handleUpdateCommute(c.id, 'commute_after', e.target.value)}
                          >
                            <option value={0}>0 mins (No buffer needed)</option>
                            <option value={10}>10 mins</option>
                            <option value={15}>15 mins</option>
                            <option value={30}>30 mins</option>
                            <option value={45}>45 mins</option>
                            <option value={60}>60 mins</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* STEP 5: NEED TO Tasks */}
          {step === 5 && (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                  <span className="tier-tag need-to">NEED TO</span>
                  <h1 className="onboarding-question-title" style={{ margin: 0 }}>
                    What must get done?
                  </h1>
                </div>
                <p className="onboarding-question-hint">
                  Deadlines, exams, assignments, and mandatory requirements. Orbit gives these the highest priority and schedules them first.
                </p>
              </div>

              {/* Added Need To List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {profile.need_to_items.length === 0 ? (
                  <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 'var(--text-xs)', border: '1px dashed var(--line)', borderRadius: 'var(--radius-sm)' }}>
                    No mandatory items added yet. Add your immediate assignments, case briefs, or upcoming exam prep below.
                  </div>
                ) : (
                  profile.need_to_items.map((item) => (
                    <div key={item.id} className="item-entry-card">
                      <div>
                        <div className="item-entry-title">{item.name}</div>
                        <div className="item-entry-sub">
                          {item.deadline ? `Due: ${item.deadline}` : 'No fixed deadline'}
                          {item.duration ? ` • ~${item.duration} mins` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-1)', height: 'auto', color: 'var(--ink-muted)' }}
                        onClick={() => handleRemoveNeedTo(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Need To Form */}
              <div className="add-item-box">
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--ink)' }}>
                  Add a NEED TO deadline or task:
                </div>
                <div className="add-item-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. assignment, exam preparation, lab report"
                    value={draftNeedTo.name}
                    onChange={(e) => setDraftNeedTo({ ...draftNeedTo, name: e.target.value })}
                  />
                  <input
                    type="date"
                    className="input"
                    value={draftNeedTo.deadline}
                    onChange={(e) => setDraftNeedTo({ ...draftNeedTo, deadline: e.target.value })}
                  />
                  <input
                    type="number"
                    className="input"
                    placeholder="Est. mins (e.g. 90)"
                    value={draftNeedTo.duration}
                    onChange={(e) => setDraftNeedTo({ ...draftNeedTo, duration: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAddNeedTo}
                    disabled={!draftNeedTo.name.trim()}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </>
          )}

          {/* STEP 6: SHOULD DO Tasks */}
          {step === 6 && (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                  <span className="tier-tag should-do">SHOULD DO</span>
                  <h1 className="onboarding-question-title" style={{ margin: 0 }}>
                    What important habits do you want progress on?
                  </h1>
                </div>
                <p className="onboarding-question-hint">
                  Important recurring work you want consistent rhythm on (e.g. revision, problem practice, clinical skills, language study).
                </p>
              </div>

              {/* Added Should Do List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {profile.should_do_items.length === 0 ? (
                  <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 'var(--text-xs)', border: '1px dashed var(--line)', borderRadius: 'var(--radius-sm)' }}>
                    No recurring progress items added yet. Add whatever skills or subjects you want to practice regularly.
                  </div>
                ) : (
                  profile.should_do_items.map((item) => (
                    <div key={item.id} className="item-entry-card">
                      <div>
                        <div className="item-entry-title">{item.name}</div>
                        <div className="item-entry-sub">
                          Frequency: {item.frequency}
                          {item.duration ? ` • ~${item.duration} mins per session` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-1)', height: 'auto', color: 'var(--ink-muted)' }}
                        onClick={() => handleRemoveShouldDo(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Should Do Form */}
              <div className="add-item-box">
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--ink)' }}>
                  Add a SHOULD DO habit:
                </div>
                <div className="add-item-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. revision, practice, language learning"
                    value={draftShouldDo.name}
                    onChange={(e) => setDraftShouldDo({ ...draftShouldDo, name: e.target.value })}
                  />
                  <select
                    className="input"
                    value={draftShouldDo.frequency}
                    onChange={(e) => setDraftShouldDo({ ...draftShouldDo, frequency: e.target.value })}
                  >
                    <option value="Daily">Daily</option>
                    <option value="3-4x a week">3-4x a week</option>
                    <option value="2x a week">2x a week</option>
                    <option value="Weekly">Weekly</option>
                  </select>
                  <input
                    type="number"
                    className="input"
                    placeholder="Est. mins (e.g. 60)"
                    value={draftShouldDo.duration}
                    onChange={(e) => setDraftShouldDo({ ...draftShouldDo, duration: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAddShouldDo}
                    disabled={!draftShouldDo.name.trim()}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </>
          )}

          {/* STEP 7: LIKE TO Activities */}
          {step === 7 && (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                  <span className="tier-tag like-to">LIKE TO</span>
                  <h1 className="onboarding-question-title" style={{ margin: 0 }}>
                    What hobbies and interests keep you balanced?
                  </h1>
                </div>
                <p className="onboarding-question-hint">
                  Hobbies, creative projects, sports, and personal activities. Orbit protects these for life balance.
                </p>
              </div>

              {/* Added Like To List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {profile.like_to_items.length === 0 ? (
                  <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 'var(--text-xs)', border: '1px dashed var(--line)', borderRadius: 'var(--radius-sm)' }}>
                    No personal activities added yet. Add whatever gives you energy or relaxation.
                  </div>
                ) : (
                  profile.like_to_items.map((item) => (
                    <div key={item.id} className="item-entry-card">
                      <div>
                        <div className="item-entry-title">{item.name}</div>
                        <div className="item-entry-sub">
                          Frequency: {item.frequency}
                          {item.duration ? ` • ~${item.duration} mins` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: 'var(--space-1)', height: 'auto', color: 'var(--ink-muted)' }}
                        onClick={() => handleRemoveLikeTo(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Like To Form */}
              <div className="add-item-box">
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--ink)' }}>
                  Add a LIKE TO hobby:
                </div>
                <div className="add-item-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. reading, music, sport, gaming"
                    value={draftLikeTo.name}
                    onChange={(e) => setDraftLikeTo({ ...draftLikeTo, name: e.target.value })}
                  />
                  <select
                    className="input"
                    value={draftLikeTo.frequency}
                    onChange={(e) => setDraftLikeTo({ ...draftLikeTo, frequency: e.target.value })}
                  >
                    <option value="Daily">Daily</option>
                    <option value="2-3x a week">2-3x a week</option>
                    <option value="Weekends">Weekends only</option>
                    <option value="When possible">When possible</option>
                  </select>
                  <input
                    type="number"
                    className="input"
                    placeholder="Est. mins (e.g. 45)"
                    value={draftLikeTo.duration}
                    onChange={(e) => setDraftLikeTo({ ...draftLikeTo, duration: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAddLikeTo}
                    disabled={!draftLikeTo.name.trim()}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </>
          )}

          {/* STEP 8: Hobby / Personal Time Preference */}
          {step === 8 && (
            <>
              <div>
                <h1 className="onboarding-question-title">How should Orbit make room for things you enjoy?</h1>
                <p className="onboarding-question-hint">
                  Decide how protective Orbit should be over your hobbies and personal time when life gets busy.
                </p>
              </div>

              <div className="onboarding-options">
                {[
                  {
                    value: 'regular',
                    title: 'Schedule them regularly',
                    desc: 'Protect dedicated slots each week for your Like To activities as non-negotiable balance.',
                  },
                  {
                    value: 'flexible',
                    title: 'Keep them flexible',
                    desc: 'Place hobbies into available openings and adapt when academic deadlines surge.',
                  },
                  {
                    value: 'when_room',
                    title: "Only schedule them when there's room",
                    desc: 'Prioritize deadlines and coursework first; hobbies fill whatever spare space remains.',
                  },
                  {
                    value: 'no_pref',
                    title: 'No preference',
                    desc: 'Use Orbit balanced default scheduling.',
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`onboarding-option-btn ${profile.hobby_preference === opt.value ? 'selected' : ''}`}
                    onClick={() => setProfile({ ...profile, hobby_preference: opt.value })}
                  >
                    <div className="onboarding-radio-dot">
                      {profile.hobby_preference === opt.value && <div className="onboarding-radio-dot-inner" />}
                    </div>
                    <div>
                      <div className="onboarding-option-title">{opt.title}</div>
                      <div className="onboarding-option-desc">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* STEP 9: Task Initiation */}
          {step === 9 && (
            <>
              <div>
                <h1 className="onboarding-question-title">
                  When you sit down to start something you've been putting off, what usually helps you actually begin?
                </h1>
                <p className="onboarding-question-hint">
                  Orbit uses this to format the first block of difficult tasks.
                </p>
              </div>

              <div className="onboarding-options">
                {[
                  { value: 'clear_start', title: 'Give me a clear starting point', desc: 'Direct, unambiguous single objective with no fuzzy setup.' },
                  { value: 'tiny_step', title: 'Break it into a tiny first step', desc: 'A manageable 15–20 minute warm-up block to get past inertia.' },
                  { value: 'timed_block', title: 'Let me do a short timed block', desc: 'A quick sprint with a built-in checkpoint to see how it feels.' },
                  { value: 'ease_in', title: 'Give me some time to ease into it', desc: 'Buffer space before demanding study blocks to get oriented.' },
                  { value: 'no_pref', title: 'Not sure / no preference', desc: 'Use Orbit standard sensible pacing.' },
                  { value: 'other', title: 'Something else', desc: 'Specify custom preferences for task kickoff.' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`onboarding-option-btn ${profile.task_initiation === opt.value ? 'selected' : ''}`}
                    onClick={() => setProfile({ ...profile, task_initiation: opt.value })}
                  >
                    <div className="onboarding-radio-dot">
                      {profile.task_initiation === opt.value && <div className="onboarding-radio-dot-inner" />}
                    </div>
                    <div>
                      <div className="onboarding-option-title">{opt.title}</div>
                      <div className="onboarding-option-desc">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {profile.task_initiation === 'other' && (
                <input
                  type="text"
                  className="input"
                  placeholder="Tell us what helps you start..."
                  value={profile.initiation_custom}
                  onChange={(e) => setProfile({ ...profile, initiation_custom: e.target.value })}
                />
              )}
            </>
          )}

          {/* STEP 10: Focus Style & Breaks */}
          {step === 10 && (
            <>
              <div>
                <h1 className="onboarding-question-title">Focus & Break Preferences</h1>
                <p className="onboarding-question-hint">
                  Shape study session lengths and recovery cushions around how your attention naturally operates.
                </p>
              </div>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  FOCUS SESSION DURATION
                </div>
                <div className="onboarding-options" style={{ marginBottom: 'var(--space-4)' }}>
                  {[
                    { value: 'short', title: 'Short bursts', desc: '25–40 minute sessions. High energy, low fatigue risk.' },
                    { value: 'medium', title: 'Medium sessions', desc: '45–60 minute sessions. Good balance between momentum and endurance.' },
                    { value: 'long', title: 'Longer deep-work sessions', desc: '75–120 minute immersive blocks for complex problem sets.' },
                    { value: 'depends', title: 'It depends on the task', desc: 'Adapt block length to whether it is quick revision or a heavy assignment.' },
                    { value: 'no_pref', title: 'Not sure / no preference', desc: 'Standard balanced 60–75 minute slots.' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`onboarding-option-btn ${profile.focus_style === opt.value ? 'selected' : ''}`}
                      onClick={() => setProfile({ ...profile, focus_style: opt.value })}
                    >
                      <div className="onboarding-radio-dot">
                        {profile.focus_style === opt.value && <div className="onboarding-radio-dot-inner" />}
                      </div>
                      <div>
                        <div className="onboarding-option-title">{opt.title}</div>
                        <div className="onboarding-option-desc">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  BREAK PATTERN
                </div>
                <div className="onboarding-options">
                  {[
                    { value: 'frequent', title: 'Frequent short breaks', desc: '10–15 minute pauses between shorter sessions.' },
                    { value: 'after_session', title: 'A break after each focus session', desc: 'Reliable recovery cushion after each scheduled block.' },
                    { value: 'fewer_longer', title: 'Fewer, longer breaks', desc: 'Sustained focus followed by an extended rest period.' },
                    { value: 'when_needed', title: 'Only when I need one', desc: 'Minimal automated gaps; more continuous available work time.' },
                    { value: 'no_pref', title: 'Not sure / no preference', desc: 'Sensible automatic buffer spacing.' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`onboarding-option-btn ${profile.break_preference === opt.value ? 'selected' : ''}`}
                      onClick={() => setProfile({ ...profile, break_preference: opt.value })}
                    >
                      <div className="onboarding-radio-dot">
                        {profile.break_preference === opt.value && <div className="onboarding-radio-dot-inner" />}
                      </div>
                      <div>
                        <div className="onboarding-option-title">{opt.title}</div>
                        <div className="onboarding-option-desc">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* STEP 11: Energy, Overload, Splitting & Weekends */}
          {step === 11 && (
            <>
              <div>
                <h1 className="onboarding-question-title">Energy, Overload & Pacing</h1>
                <p className="onboarding-question-hint">
                  Fine-tune how Orbit adapts when workload peaks or weekends arrive.
                </p>
              </div>

              <div>
                {/* Energy */}
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  MENTAL ENERGY PEAK
                </div>
                <div className="onboarding-options" style={{ marginBottom: 'var(--space-4)' }}>
                  {[
                    { value: 'morning', title: 'Morning', desc: 'Peak clarity early before the day gets noisy.' },
                    { value: 'afternoon', title: 'Afternoon', desc: 'Midday and post-class momentum.' },
                    { value: 'evening', title: 'Evening', desc: 'Quiet post-dinner hours when things settle down.' },
                    { value: 'varies', title: 'It varies', desc: 'Distribute focus work evenly.' },
                    { value: 'not_sure', title: "I'm not sure", desc: 'Use standard balanced distribution.' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`onboarding-option-btn ${profile.energy === opt.value ? 'selected' : ''}`}
                      onClick={() => setProfile({ ...profile, energy: opt.value })}
                    >
                      <div className="onboarding-radio-dot">
                        {profile.energy === opt.value && <div className="onboarding-radio-dot-inner" />}
                      </div>
                      <div className="onboarding-option-title">{opt.title}</div>
                    </button>
                  ))}
                </div>

                {/* Overload */}
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  WHEN YOUR DAY FEELS TOO FULL
                </div>
                <div className="onboarding-options" style={{ marginBottom: 'var(--space-4)' }}>
                  {[
                    { value: 'struggle_start', title: 'I struggle to start difficult tasks' },
                    { value: 'need_breakdown', title: 'I need tasks broken down' },
                    { value: 'jumping', title: 'I start jumping between things' },
                    { value: 'lose_track', title: 'I lose track of priorities' },
                    { value: 'need_recovery', title: 'I need more recovery time' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`onboarding-option-btn ${profile.overload_pattern === opt.value ? 'selected' : ''}`}
                      onClick={() => setProfile({ ...profile, overload_pattern: opt.value })}
                    >
                      <div className="onboarding-radio-dot">
                        {profile.overload_pattern === opt.value && <div className="onboarding-radio-dot-inner" />}
                      </div>
                      <div className="onboarding-option-title">{opt.title}</div>
                    </button>
                  ))}
                </div>

                {/* Task Splitting */}
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  TASK SPLITTING
                </div>
                <div className="onboarding-options" style={{ marginBottom: 'var(--space-4)' }}>
                  {[
                    { value: 'yes', title: 'Yes, please break larger tasks down' },
                    { value: 'large', title: 'Only when a task is large (>90 mins)' },
                    { value: 'self', title: "I'll decide myself" },
                    { value: 'no', title: 'No, keep tasks together' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`onboarding-option-btn ${profile.task_splitting === opt.value ? 'selected' : ''}`}
                      onClick={() => setProfile({ ...profile, task_splitting: opt.value })}
                    >
                      <div className="onboarding-radio-dot">
                        {profile.task_splitting === opt.value && <div className="onboarding-radio-dot-inner" />}
                      </div>
                      <div className="onboarding-option-title">{opt.title}</div>
                    </button>
                  ))}
                </div>

                {/* Weekend Mode */}
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  WEEKEND TREATMENT
                </div>
                <div className="onboarding-options">
                  {[
                    { value: 'structure', title: 'Keep some structure', desc: 'Morning focus slot followed by open afternoon.' },
                    { value: 'flexible', title: 'Mostly flexible', desc: 'Catch-up and protected personal time.' },
                    { value: 'recovery', title: 'Prioritize recovery and personal time', desc: 'No heavy deadlines; full rest & hobby protection.' },
                    { value: 'weekdays', title: 'Similar structure to weekdays', desc: 'Consistent routine all 7 days.' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`onboarding-option-btn ${profile.weekend_mode === opt.value ? 'selected' : ''}`}
                      onClick={() => setProfile({ ...profile, weekend_mode: opt.value })}
                    >
                      <div className="onboarding-radio-dot">
                        {profile.weekend_mode === opt.value && <div className="onboarding-radio-dot-inner" />}
                      </div>
                      <div>
                        <div className="onboarding-option-title">{opt.title}</div>
                        <div className="onboarding-option-desc">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* STEP 12: Final Review & Confirmation */}
          {step === 12 && (
            <>
              <div>
                <h1 className="onboarding-question-title">Here's what Orbit learned about you</h1>
                <p className="onboarding-question-hint">
                  Your profile is ready and will serve as the source of truth for your adaptive schedule.
                </p>
              </div>

              {/* Dynamic Narrative Review */}
              <div className="narrative-box">
                {(() => {
                  const uniqueAnchors = Array.from(new Set(profile.fixed_commitments.map((c) => (c.name || c.title || '').trim()).filter(Boolean)));
                  const focusLabel = profile.focus_style === 'depends' ? 'adaptive / flexible' : profile.focus_style || 'balanced';
                  return `Orbit learned that your active rhythm is ${profile.wake_time} → ${profile.sleep_time} with ${
                    profile.week_structure === 'same_weekdays' ? 'consistent weekday commitments' : 'day-by-day varying commitments'
                  }. You have ${profile.fixed_commitments.length} protected anchor block${
                    profile.fixed_commitments.length === 1 ? '' : 's'
                  }${
                    uniqueAnchors.length > 0 ? ` (${uniqueAnchors.join(', ')})` : ''
                  }. You prefer ${focusLabel} focus sessions with ${
                    profile.energy
                  } peak energy, and want Orbit to ${
                    profile.hobby_preference === 'regular'
                      ? 'regularly schedule room for'
                      : 'protect space for'
                  } ${
                    profile.like_to_items.length > 0
                      ? profile.like_to_items.map((i) => i.name || i.title).join(', ')
                      : 'your personal hobbies and balance'
                  }.`;
                })()}
              </div>

              {/* Structured Summary Grid */}
              <div className="onboarding-summary-grid">
                <div className="onboarding-summary-item">
                  <div className="onboarding-summary-label">Routine & Boundaries</div>
                  <div className="onboarding-summary-val">{profile.wake_time} – {profile.sleep_time}</div>
                </div>
                <div className="onboarding-summary-item">
                  <div className="onboarding-summary-label">Fixed Anchors</div>
                  <div className="onboarding-summary-val">{profile.fixed_commitments.length} protected blocks</div>
                </div>
                <div className="onboarding-summary-item">
                  <div className="onboarding-summary-label">NEED TO Deadlines</div>
                  <div className="onboarding-summary-val">{profile.need_to_items.length} items</div>
                </div>
                <div className="onboarding-summary-item">
                  <div className="onboarding-summary-label">SHOULD DO & LIKE TO</div>
                  <div className="onboarding-summary-val">
                    {profile.should_do_items.length} habits • {profile.like_to_items.length} hobbies
                  </div>
                </div>
              </div>

              {/* Mode / Theme Picker */}
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  APPEARANCE
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  <button
                    type="button"
                    className={`btn ${modePreference === 'light' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
                    onClick={() => handleModeChange('light')}
                  >
                    <Sun size={14} strokeWidth={1.5} />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    className={`btn ${modePreference === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
                    onClick={() => handleModeChange('dark')}
                  >
                    <Moon size={14} strokeWidth={1.5} />
                    <span>Dark</span>
                  </button>
                  <button
                    type="button"
                    className={`btn ${modePreference === 'device' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
                    onClick={() => handleModeChange('device')}
                  >
                    <Laptop size={14} strokeWidth={1.5} />
                    <span>Match device</span>
                  </button>
                </div>
              </div>

              {/* Palette Selector */}
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  PALETTE
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  {PALETTE_OPTIONS.map((pal) => {
                    const isSelected = palette === pal.id;
                    const preview = mode === 'dark' ? pal.dark : pal.light;

                    return (
                      <button
                        key={pal.id}
                        type="button"
                        onClick={() => setPalette(pal.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-2) var(--space-3)',
                          backgroundColor: preview.bg,
                          border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <div
                            style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              backgroundColor: preview.accent,
                            }}
                          />
                          <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-xs)', color: preview.accent }}>
                            {pal.name}
                          </span>
                        </div>
                        {isSelected && <Check size={14} strokeWidth={2} style={{ color: preview.accent }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Footer buttons */}
          <div className="onboarding-footer">
            {step > 1 ? (
              <button type="button" className="btn btn-secondary" onClick={prevStep}>
                <ArrowLeft size={15} strokeWidth={1.5} />
                <span>Back</span>
              </button>
            ) : (
              <div />
            )}

            <button type="button" className="btn btn-primary" onClick={nextStep} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" strokeWidth={1.5} />
                  <span>Saving Profile…</span>
                </>
              ) : (
                <>
                  <span>{step === TOTAL_STEPS ? 'Complete Setup & Enter Planner' : 'Continue'}</span>
                  <ArrowRight size={15} strokeWidth={1.5} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;
