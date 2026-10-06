import { useState } from 'react';
import ThemeToggle from '../components/ThemeToggle';
import { useTheme } from '../theme/useTheme';

export function DesignGuide() {
  const [inputValue, setInputValue] = useState('Organic Chemistry Assignment');
  const { mode, palette, setPalette } = useTheme();

  const swatches = [
    { name: '--bg', label: 'Canvas / Page Background', token: 'var(--bg)', border: true },
    { name: '--surface', label: 'Primary Surface / Cards', token: 'var(--surface)', border: true },
    { name: '--surface-2', label: 'Secondary Surface / Insets', token: 'var(--surface-2)', border: true },
    { name: '--ink', label: 'Primary Text & Contrast', token: 'var(--ink)', textLight: true },
    { name: '--ink-muted', label: 'Secondary / Subtitle Text', token: 'var(--ink-muted)', textLight: true },
    { name: '--line', label: '1px Quiet Dividers', token: 'var(--line)', border: true },
    { name: '--accent', label: 'Accent Tone (Focus / Brand)', token: 'var(--accent)', textLight: true },
    { name: '--sage', label: 'Recovery / Rest Signal', token: 'var(--sage)', textLight: true },
    { name: '--error', label: 'Muted Brick (Validation Only)', token: 'var(--error)', textLight: true },
  ];

  const typeScales = [
    { label: 'Display XL (40px)', varName: 'var(--text-xl)', family: 'var(--font-display)', sample: 'Orbit Editorial Heading' },
    { label: 'Display LG (28px)', varName: 'var(--text-lg)', family: 'var(--font-display)', sample: 'Daily Schedule & Rhythms' },
    { label: 'Display MD (20px)', varName: 'var(--text-md)', family: 'var(--font-display)', sample: 'Deep Work Session' },
    { label: 'Body Base (16px)', varName: 'var(--text-base)', family: 'var(--font-sans)', sample: 'Orbit balances your study workload calmly without overwhelming sprints or artificial urgency.' },
    { label: 'Body SM (14px)', varName: 'var(--text-sm)', family: 'var(--font-sans)', sample: 'Calculus III Problem Set 4 due tomorrow at 11:59 PM' },
    { label: 'Mono XS (12px)', varName: 'var(--text-xs)', family: 'var(--font-mono)', sample: '09:00 - 10:30 · 90 MIN STUDY BLOCK' },
  ];

  const paletteCards = [
    {
      id: 'terracotta',
      name: 'Terracotta',
      desc: 'Paper & warm brick focus. Default calm editorial tones.',
      lightHex: '#B24322',
      darkHex: '#E0875F',
      bgLight: '#F4EFE6',
      bgDark: '#14120F',
      recoveryLight: '#536D58',
      recoveryDark: '#8FAE93',
    },
    {
      id: 'sage',
      name: 'Sage',
      desc: 'Quiet botanical tones with a dusty blue recovery signal to keep breaks distinct.',
      lightHex: '#3F6B4A',
      darkHex: '#8FBF8F',
      bgLight: '#EFF3EF',
      bgDark: '#0F1510',
      recoveryLight: '#3B6079',
      recoveryDark: '#8EB5D1',
    },
    {
      id: 'dusk',
      name: 'Dusk',
      desc: 'Evening contemplation with twilight indigo focus and calm slate rest.',
      lightHex: '#4A55A2',
      darkHex: '#9AA5F0',
      bgLight: '#F0F1F7',
      bgDark: '#10111A',
      recoveryLight: '#46645E',
      recoveryDark: '#87AEA5',
    },
    {
      id: 'plum',
      name: 'Plum',
      desc: 'Deep berry focus paired with gentle eucalyptus recovery.',
      lightHex: '#A3365B',
      darkHex: '#E58AA6',
      bgLight: '#F6F0F2',
      bgDark: '#170E12',
      recoveryLight: '#466453',
      recoveryDark: '#8DAF97',
    },
  ];

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
      {/* Editorial Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          paddingBottom: 'var(--space-6)',
          borderBottom: '1px solid var(--line)',
          marginBottom: 'var(--space-8)',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <span className="tag tag-accent" style={{ marginBottom: 'var(--space-2)' }}>
            System Foundation
          </span>
          <h1 style={{ marginBottom: 'var(--space-2)' }}>Design & Token Guide</h1>
          <p className="text-muted" style={{ maxWidth: '580px', fontSize: 'var(--text-sm)' }}>
            A paper planner crossed with a calm editorial magazine. Designed for clarity,
            focus, and zero artificial pressure.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {/* 0. Palette Showcase (Requirement 11) */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2>Color Palettes</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Four calm editorial palettes. Selecting one applies it live across the entire interface.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {paletteCards.map((pal) => {
            const isCurrent = palette === pal.id;
            const currentAccent = mode === 'dark' ? pal.darkHex : pal.lightHex;
            const currentBg = mode === 'dark' ? pal.bgDark : pal.bgLight;
            const currentRecovery = mode === 'dark' ? pal.recoveryDark : pal.recoveryLight;

            return (
              <div
                key={pal.id}
                style={{
                  backgroundColor: 'var(--surface)',
                  border: `2px solid ${isCurrent ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                {/* Visual strip preview */}
                <div
                  style={{
                    height: '56px',
                    backgroundColor: currentBg,
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-around',
                    padding: 'var(--space-2)',
                  }}
                >
                  <div
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: currentAccent,
                      color: mode === 'dark' ? '#14120F' : '#FBF8F2',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Accent
                  </div>
                  <div
                    style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: currentRecovery,
                      color: mode === 'dark' ? '#14120F' : '#FBF8F2',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Recovery
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-base)' }}>{pal.name}</h3>
                    {isCurrent && <span className="tag tag-accent">Active</span>}
                  </div>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', marginTop: 'var(--space-1)' }}>
                    {pal.desc}
                  </p>
                </div>

                <button
                  type="button"
                  className={`btn ${isCurrent ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 'var(--text-xs)', marginTop: 'auto' }}
                  onClick={() => setPalette(pal.id)}
                >
                  {isCurrent ? 'Currently Active' : `Switch to ${pal.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 1. Color Palette Swatches (Current Active Palette) */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2>Current Palette Swatches ({palette.toUpperCase()} · {mode.toUpperCase()})</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Warm, quiet tones tested for WCAG AA contrast (&gt;= 4.5:1) across all background surfaces.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {swatches.map((s) => (
            <div
              key={s.name}
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '72px',
                  backgroundColor: s.token,
                  borderBottom: s.border ? '1px solid var(--line)' : 'none',
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: 'var(--space-2)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: s.textLight ? 'var(--accent-contrast)' : 'var(--ink)',
                    backgroundColor: 'rgba(0, 0, 0, 0.15)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {s.name}
                </span>
              </div>
              <div style={{ padding: 'var(--space-3)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-medium)' }}>
                  {s.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Typography Hierarchy */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2>Typography Scale</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Fraunces for editorial hierarchy, Instrument Sans for quiet UI clarity, and JetBrains Mono for time labels.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-6)',
          }}
        >
          {typeScales.map((t, idx) => (
            <div
              key={t.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr',
                gap: 'var(--space-4)',
                alignItems: 'baseline',
                borderBottom: idx < typeScales.length - 1 ? '1px solid var(--line)' : 'none',
                paddingBottom: idx < typeScales.length - 1 ? 'var(--space-4)' : '0',
              }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
                {t.label}
              </div>
              <div style={{ fontSize: t.varName, fontFamily: t.family, lineHeight: 'var(--leading-snug)' }}>
                {t.sample}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Interactive Components: Buttons & Tags */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2>Buttons & Pill Tags</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Quiet, tactile controls with 6px radius. Fully round pill radius is reserved strictly for tags.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-6)',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-6)',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
              BUTTON VARIANTS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }}>
              <button type="button" className="btn btn-primary">Primary Action</button>
              <button type="button" className="btn btn-secondary">Secondary Outline</button>
              <button type="button" className="btn btn-ghost">Ghost Button</button>
              <button type="button" className="btn btn-primary" disabled>Disabled State</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 'var(--space-2)' }}>
              TAGS / PILLS (STATUS & CONTEXT)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
              <span className="tag">Academic · 3 hrs</span>
              <span className="tag tag-accent">Accent Focus</span>
              <span className="tag tag-sage">Rest & Recovery</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Form Fields & Validation */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2>Inputs & Form Validation</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Error styles use a muted brick color, reserved strictly for form validation errors and never for displaced work.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-6)',
          }}
        >
          <div className="form-group">
            <label htmlFor="valid-input">Task Title (Normal state)</label>
            <input
              id="valid-input"
              type="text"
              className="input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="e.g. Read Chapter 4"
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
              Press Tab to verify keyboard focus ring
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="error-input">Scheduled Deadline (Error state)</label>
            <input
              id="error-input"
              type="text"
              className="input input-error"
              defaultValue="Invalid date format"
              aria-invalid="true"
              aria-describedby="demo-error-msg"
            />
            <span id="demo-error-msg" className="form-error">
              Please enter a valid future time (HH:MM)
            </span>
          </div>
        </div>
      </section>

      {/* 5. Quiet Card Example */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2>Card Layout</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
            Separated with clean 1px borders and whitespace. No flashy shadows or rounded SaaS grids.
          </p>
        </div>

        <div className="card" style={{ maxWidth: '520px' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="tag tag-sage" style={{ marginBottom: 'var(--space-1)' }}>Study Window</span>
              <h3 style={{ margin: 0 }}>Advanced Microeconomics</h3>
            </div>
            <time className="text-mono text-sm text-muted">14:00 – 16:30</time>
          </div>

          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', marginBottom: 'var(--space-4)' }}>
            Complete problem set on Nash equilibria and consumer utility theory. Prioritize
            derivations from Lecture 7.
          </p>

          <div className="card-footer">
            <button type="button" className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)' }}>
              Reschedule
            </button>
            <button type="button" className="btn btn-primary" style={{ fontSize: 'var(--text-xs)' }}>
              Start Session
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default DesignGuide;
