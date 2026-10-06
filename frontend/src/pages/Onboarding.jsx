import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Sun, Moon, Laptop } from 'lucide-react';
import { saveOnboarding } from '../api/client';
import { useTheme } from '../theme/useTheme';
import ThemeToggle from '../components/ThemeToggle';
import './Onboarding.css';

const TOTAL_STEPS = 7;

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

export function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const { mode, palette, setMode, setPalette } = useTheme();
  const [modePreference, setModePreference] = useState('device'); // 'light' | 'dark' | 'device'

  const [answers, setAnswers] = useState({
    wake_time: '07:00',
    sleep_time: '23:30',
    focus_length: 90,
    prefer_long_sessions: true,
    allow_splitting: true,
    juggles: ['classes', 'gym', 'assignments'],
    anything_else: '',
  });

  const navigate = useNavigate();

  const handleFinish = async () => {
    setLoading(true);
    try {
      await saveOnboarding({
        ...answers,
        palette,
        mode,
      });
    } catch {
      // Ignore network errors in onboarding, proceed to today
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

  const toggleJuggle = (key) => {
    setAnswers((prev) => {
      const exists = prev.juggles.includes(key);
      return {
        ...prev,
        juggles: exists
          ? prev.juggles.filter((k) => k !== key)
          : [...prev.juggles, key],
      };
    });
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
        {/* Progress track */}
        <div>
          <div className="onboarding-progress-track">
            <div
              className="onboarding-progress-bar"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
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
          {/* Step 1: Wake & Sleep */}
          {step === 1 && (
            <>
              <div>
                <h1 className="onboarding-question-title">What is your daily rhythm?</h1>
                <p className="onboarding-question-hint">
                  Orbit protects your sleep and bounds all study slots between your active hours.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label htmlFor="wake-time">Typical wake-up time</label>
                  <input
                    id="wake-time"
                    type="time"
                    className="input"
                    value={answers.wake_time}
                    onChange={(e) => setAnswers({ ...answers, wake_time: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="sleep-time">Typical bedtime</label>
                  <input
                    id="sleep-time"
                    type="time"
                    className="input"
                    value={answers.sleep_time}
                    onChange={(e) => setAnswers({ ...answers, sleep_time: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}

          {/* Step 2: Focus Session Length */}
          {step === 2 && (
            <>
              <div>
                <h1 className="onboarding-question-title">How long is your ideal focus session?</h1>
                <p className="onboarding-question-hint">
                  We'll use this length when carving out deep-work blocks.
                </p>
              </div>

              <div className="onboarding-options">
                {[
                  { value: 45, title: '45 minutes', desc: 'Short, sharp sprints. Best if you prefer frequent pauses.' },
                  { value: 90, title: '90 minutes (Recommended)', desc: 'Natural ultradian focus cycle. Deep enough to get into flow.' },
                  { value: 150, title: '2 to 3 hours', desc: 'Extended deep dive for complex problem sets and projects.' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`onboarding-option-btn ${answers.focus_length === opt.value ? 'selected' : ''}`}
                    onClick={() => setAnswers({ ...answers, focus_length: opt.value })}
                  >
                    <div className="onboarding-radio-dot">
                      {answers.focus_length === opt.value && <div className="onboarding-radio-dot-inner" />}
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

          {/* Step 3: Work Style */}
          {step === 3 && (
            <>
              <div>
                <h1 className="onboarding-question-title">How do you like your study sessions distributed?</h1>
                <p className="onboarding-question-hint">
                  Different subjects and goals demand different energy shapes.
                </p>
              </div>

              <div className="onboarding-options">
                {[
                  {
                    value: true,
                    title: 'Dedicated deep-work blocks',
                    desc: 'Group similar tasks into larger, focused periods with fewer interruptions.',
                  },
                  {
                    value: false,
                    title: 'Varied, shorter blocks',
                    desc: 'Mix different subjects throughout the day to keep energy varied.',
                  },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className={`onboarding-option-btn ${answers.prefer_long_sessions === opt.value ? 'selected' : ''}`}
                    onClick={() => setAnswers({ ...answers, prefer_long_sessions: opt.value })}
                  >
                    <div className="onboarding-radio-dot">
                      {answers.prefer_long_sessions === opt.value && <div className="onboarding-radio-dot-inner" />}
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

          {/* Step 4: Task Splitting */}
          {step === 4 && (
            <>
              <div>
                <h1 className="onboarding-question-title">Can large assignments be split across days?</h1>
                <p className="onboarding-question-hint">
                  If a task needs 4 hours, Orbit can break it into two 2-hour slots before the deadline.
                </p>
              </div>

              <div className="onboarding-options">
                {[
                  {
                    value: true,
                    title: 'Yes, split across days when helpful (Recommended)',
                    desc: 'Prevents cramming and gives you buffer if life gets disrupted.',
                  },
                  {
                    value: false,
                    title: 'No, keep each task in one continuous session',
                    desc: 'Only schedule when there is enough contiguous free time.',
                  },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className={`onboarding-option-btn ${answers.allow_splitting === opt.value ? 'selected' : ''}`}
                    onClick={() => setAnswers({ ...answers, allow_splitting: opt.value })}
                  >
                    <div className="onboarding-radio-dot">
                      {answers.allow_splitting === opt.value && <div className="onboarding-radio-dot-inner" />}
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

          {/* Step 5: What they juggle */}
          {step === 5 && (
            <>
              <div>
                <h1 className="onboarding-question-title">What are you juggling this term?</h1>
                <p className="onboarding-question-hint">
                  Select all that apply so Orbit builds realistic transition and recovery buffers.
                </p>
              </div>

              <div className="onboarding-chips">
                {[
                  { key: 'classes', label: 'College Classes & Labs' },
                  { key: 'gym', label: 'Gym & Fitness' },
                  { key: 'placements', label: 'Placements & Job Search' },
                  { key: 'assignments', label: 'Coursework & Deadlines' },
                  { key: 'family', label: 'Family & Home Life' },
                  { key: 'hobbies', label: 'Hobbies & Creative Projects' },
                  { key: 'part_time', label: 'Part-time Work' },
                ].map((item) => {
                  const isSelected = answers.juggles.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`onboarding-chip-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleJuggle(item.key)}
                    >
                      {isSelected && <Check size={13} strokeWidth={2} />}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Step 6: Free-text note */}
          {step === 6 && (
            <>
              <div>
                <h1 className="onboarding-question-title">Anything else Orbit should know?</h1>
                <p className="onboarding-question-hint">
                  Commute quirks, rough weekdays, or personal study rules.
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="anything-else">Notes or constraints (optional)</label>
                <textarea
                  id="anything-else"
                  rows={4}
                  className="input"
                  placeholder="e.g. Wednesday lab always runs 30 mins over; prefer reading theory in the morning."
                  value={answers.anything_else}
                  onChange={(e) => setAnswers({ ...answers, anything_else: e.target.value })}
                />
              </div>
            </>
          )}

          {/* Step 7: Pick your look (Final step) */}
          {step === 7 && (
            <>
              <div>
                <h1 className="onboarding-question-title">Pick your look</h1>
                <p className="onboarding-question-hint">
                  Choose a quiet palette and theme. Changes apply instantly and can be updated anytime.
                </p>
              </div>

              {/* Mode selector: Light / Dark / Match my device */}
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  APPEARANCE
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
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

              {/* Four Palette Cards with Mini Preview */}
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
                  COLOR PALETTE
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          padding: 'var(--space-3)',
                          backgroundColor: 'var(--surface)',
                          border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'border-color var(--transition-fast)',
                        }}
                      >
                        {/* Mini preview card */}
                        <div
                          style={{
                            height: '52px',
                            borderRadius: '4px',
                            backgroundColor: preview.bg,
                            border: '1px solid rgba(0,0,0,0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-around',
                            padding: 'var(--space-1) var(--space-2)',
                            marginBottom: 'var(--space-2)',
                          }}
                        >
                          <div
                            style={{
                              width: '32px',
                              height: '24px',
                              borderRadius: '3px',
                              backgroundColor: preview.surface,
                              borderLeft: `3px solid ${preview.accent}`,
                            }}
                          />
                          <div
                            style={{
                              width: '28px',
                              height: '14px',
                              borderRadius: '9999px',
                              backgroundColor: preview.accent,
                            }}
                          />
                          <div
                            style={{
                              width: '20px',
                              height: '14px',
                              borderRadius: '3px',
                              backgroundColor: preview.sage,
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                            {pal.name}
                          </span>
                          {isSelected && <Check size={14} strokeWidth={2} style={{ color: 'var(--accent)' }} />}
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                          {pal.desc}
                        </span>
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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={prevStep}
              >
                <ArrowLeft size={15} strokeWidth={1.5} />
                <span>Back</span>
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={nextStep}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" strokeWidth={1.5} />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <span>{step === TOTAL_STEPS ? 'Enter Planner' : 'Continue'}</span>
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
