import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Clock,
  Zap,
  ArrowRight,
  ShieldCheck,
  Brain,
} from 'lucide-react';
import { getInsights, submitInsightFeedback, seedDemoStudent } from '../api/client';
import './Insights.css';

export function Insights() {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [notification, setNotification] = useState('');

  const loadData = async () => {
    try {
      const list = await getInsights();
      setInsights(list || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFeedback = async (insightId, feedbackType) => {
    try {
      const updated = await submitInsightFeedback(insightId, feedbackType);
      if (updated) {
        setInsights((prev) =>
          prev.map((item) => (item.id === insightId ? { ...item, ...updated } : item))
        );
      }
    } catch {
      // ignore
    }
  };

  const handleToggleMore = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleReSeed = async () => {
    setSeeding(true);
    try {
      await seedDemoStudent();
      await loadData();
      setNotification('14-day demo student profile refreshed successfully.');
      setTimeout(() => setNotification(''), 4000);
    } catch {
      // ignore
    } finally {
      setSeeding(false);
    }
  };

  const getBadgeClass = (badge) => {
    switch (badge) {
      case 'Productivity Rhythm':
        return 'badge-yellow';
      case 'Energy Protection':
        return 'badge-lime';
      case 'Cognitive Capacity':
        return 'badge-lavender';
      default:
        return 'badge-pink';
    }
  };

  return (
    <div className="insights-page">
      {/* Header */}
      <header className="insights-header">
        <span className="insights-tag">
          <Brain size={14} strokeWidth={2.5} />
          What Orbit Learned
        </span>
        <h1 className="insights-title">Your Work Rhythm, Decoded</h1>
        <p className="insights-subtitle">
          Evidence-backed observations from your last 14 days of study sessions, completed tasks,
          cancellations, and post-day reflections.
        </p>

        <div className="insights-demo-bar">
          <div className="insights-demo-badge">
            <ShieldCheck size={16} strokeWidth={2.5} />
            <span>14-day demo student profile active (relative to today)</span>
          </div>
          <button
            type="button"
            className="insights-btn-seed"
            onClick={handleReSeed}
            disabled={seeding}
          >
            <RotateCcw size={13} strokeWidth={2} className={seeding ? 'spin' : ''} />
            <span>{seeding ? 'Seeding demo…' : 'Re-seed 14-day history'}</span>
          </button>
        </div>

        {notification && (
          <div className="feedback-status-banner" style={{ marginTop: '8px' }}>
            <CheckCircle2 size={15} strokeWidth={2.5} />
            <span>{notification}</span>
          </div>
        )}
      </header>

      {/* Observations Grid */}
      <div className="insights-grid">
        {insights.map((item) => {
          const isExpanded = expandedId === item.id;
          return (
            <article key={item.id} className="insight-card">
              <div className="insight-card-header">
                <span className={`insight-badge ${getBadgeClass(item.badge)}`}>
                  {item.badge}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-muted)' }}>
                  Observed across 14 days
                </span>
              </div>

              <h2 className="insight-title">{item.title}</h2>

              <div className="insight-observation">
                {item.observation}
              </div>

              <div className="insight-sections">
                <div className="insight-block">
                  <span className="insight-block-label">
                    <Clock size={13} strokeWidth={2.2} />
                    Evidence from 14-day history
                  </span>
                  <p className="insight-block-text">{item.evidence}</p>
                </div>

                <div className="insight-block">
                  <span className="insight-block-label">
                    <Zap size={13} strokeWidth={2.2} />
                    How Orbit adapts
                  </span>
                  <p className="insight-block-text">{item.adaptation}</p>
                </div>
              </div>

              {/* Live Demonstration Callout */}
              <div className="insight-applied-box">
                <Sparkles size={18} strokeWidth={2.2} className="insight-applied-icon" />
                <p className="insight-applied-text">
                  <strong>Affects your proposals:</strong> {item.howAffectsProposals}
                  <br />
                  <span style={{ fontStyle: 'italic', color: '#6A4C93' }}>
                    e.g. {item.appliedExample}
                  </span>
                </p>
              </div>

              {/* Expanded "Tell me more" drawer */}
              {isExpanded && (
                <div className="insight-detail-drawer">
                  <div className="insight-detail-title">
                    Detailed evidence breakdown from your 14-day log:
                  </div>
                  <ul className="insight-detail-list">
                    <li>
                      <strong>Historical completion:</strong> High-priority tasks (e.g. DSA, OS Lab) consistently succeeded when scheduled in morning blocks (07:30 – 11:00).
                    </li>
                    <li>
                      <strong>Displacement patterns:</strong> Evening study slots following heavy 5-hour lecture days experienced higher drop-off or postponement rates.
                    </li>
                    <li>
                      <strong>Buffer necessity:</strong> Inserting a 15–30 min cushion after long college commutes reduced evening disruption proposals to near zero.
                    </li>
                  </ul>
                </div>
              )}

              {/* Interactive Feedback Actions */}
              <div className="insight-feedback-bar">
                <span className="insight-feedback-label">
                  Is this observation accurate for you?
                </span>

                <div className="insight-feedback-actions">
                  <button
                    type="button"
                    className={`btn-feedback ${item.userFeedback === 'yes' ? 'btn-feedback-yes' : ''}`}
                    onClick={() => handleFeedback(item.id, 'yes')}
                  >
                    <ThumbsUp size={13} strokeWidth={2.2} />
                    <span>Yes, accurate</span>
                  </button>

                  <button
                    type="button"
                    className={`btn-feedback ${item.userFeedback === 'no' ? 'btn-feedback-no' : ''}`}
                    onClick={() => handleFeedback(item.id, 'no')}
                  >
                    <ThumbsDown size={13} strokeWidth={2.2} />
                    <span>Not quite</span>
                  </button>

                  <button
                    type="button"
                    className="btn-feedback btn-feedback-more"
                    onClick={() => handleToggleMore(item.id)}
                  >
                    <HelpCircle size={13} strokeWidth={2.2} />
                    <span>{isExpanded ? 'Less info' : 'Tell me more'}</span>
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </div>

                {item.feedbackMessage && (
                  <div className="feedback-status-banner">
                    <CheckCircle2 size={14} strokeWidth={2.5} />
                    <span>{item.feedbackMessage}</span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Demonstration Call to Action */}
      <section
        style={{
          background: 'var(--pop-yellow)',
          border: 'var(--pop-border)',
          borderRadius: 'var(--pop-radius)',
          boxShadow: 'var(--pop-shadow)',
          padding: 'var(--space-5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <h3 style={{ fontFamily: 'var(--pop-font-heading)', margin: '0 0 6px', fontSize: '1.25rem' }}>
            Experience Orbit adapting to your rhythm
          </h3>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#111111' }}>
            Test adaptive disruption: tell Orbit &quot;College cancelled. Home the entire day.&quot; and see how it prioritizes your morning focus without guilt.
          </p>
        </div>

        <Link
          to="/changed"
          className="pop-btn pop-btn-lime"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <span>Try adaptive change</span>
          <ArrowRight size={15} strokeWidth={2.5} />
        </Link>
      </section>
    </div>
  );
}

export default Insights;
