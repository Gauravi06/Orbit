import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { saveOnboarding } from '../api/client';
import ThemeToggle from '../components/ThemeToggle';
import './Onboarding.css';

const TOTAL_STEPS = 6;

export function Onboarding() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
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
      await saveOnboarding(answers);
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
