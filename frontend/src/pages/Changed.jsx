import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { disrupt, generateSchedule, errText } from '../api/client';
import './Changed.css';

export function Changed() {
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const navigate = useNavigate();

  const handleDisrupt = async (textToSubmit) => {
    const text = textToSubmit || promptText;
    if (!text.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const data = await disrupt(text);
      setResult(data);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async () => {
    setLoading(true);
    try {
      await generateSchedule();
      setResult(null);
      setPromptText('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="changed-page">
      {/* Header */}
      <div className="changed-header">
        <h1 className="changed-title">Something Changed?</h1>
        <p className="changed-subtitle">
          Life happens mid-week. Tell Orbit what came up in your own words, and it will
          quietly reorganise your workload without guilt or overdue badges.
        </p>
      </div>

      {error && (
        <div className="form-error" style={{ fontSize: 'var(--text-sm)' }}>
          {error}
        </div>
      )}

      {/* Main Disruption Form */}
      <div className="changed-card">
        <h2 className="changed-card-title">Describe what happened</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDisrupt();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        >
          <textarea
            className="input changed-textarea"
            placeholder="What changed?"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            disabled={loading}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !promptText.trim()}
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="spin" strokeWidth={1.5} />
                  <span>Rearranging your day…</span>
                </>
              ) : (
                <>
                  <span>Reorganise Plan</span>
                  <ArrowRight size={15} strokeWidth={1.5} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Rearranging Loading State */}
      {loading && (
        <div className="changed-busy-banner">
          <Loader2 size={24} className="spin" strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 'bold' }}>
            Adapting your schedule quietly…
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            Checking deadlines, buffer slots, and preserving your sleep window.
          </div>
        </div>
      )}

      {/* Disruption Results: What Changed */}
      {result && (
        <div className="changed-result-card">
          <div className="changed-result-header">
            <div>
              <span className="tag tag-accent" style={{ marginBottom: 'var(--space-1)' }}>
                Version {result.schedule?.version || 2} Generated
              </span>
              <h2 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: 'var(--text-md)' }}>
                Here is what changed
              </h2>
            </div>
            <span className="text-muted" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
              Nothing failed · Work shifted
            </span>
          </div>

          {/* Plain language bullet points */}
          <div className="changed-list">
            {result.what_changed?.map((change, idx) => (
              <div key={idx} className="changed-list-item">
                <CheckCircle2 size={16} className="changed-list-icon" strokeWidth={1.5} />
                <span>{change}</span>
              </div>
            ))}
          </div>

          {/* At risk alerts if any */}
          {result.at_risk?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {result.at_risk.map((item) => (
                <div
                  key={item.id}
                  style={{
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                  <span>
                    <strong>{item.title}</strong>: {item.reason}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Actions: Keep or Undo */}
          <div className="changed-actions-bar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleUndo}
              disabled={loading}
            >
              <RotateCcw size={14} strokeWidth={1.5} />
              <span>Undo / Restore Original</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/today')}
            >
              <span>Keep this plan</span>
              <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Changed;
