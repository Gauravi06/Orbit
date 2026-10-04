import { useEffect, useMemo, useState } from "react";
import api, { errText, loadDemo } from "./api";

const START = 7 * 60, END = 23 * 60, PX = 0.85;
const mins = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };
const hhmm = (d) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const hm = (m) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
const wk = (s) => new Date(s + "T00:00").toLocaleDateString("en-IN", { weekday: "short" });
const dm = (s) => new Date(s + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const CHIPS = ["I am sick tomorrow afternoon", "Lab ran 2 hours late today", "Rough day tomorrow, go lighter", "I have a family event tomorrow evening"];

export default function Schedule() {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState(null);
  const [sel, setSel] = useState(null);

  async function run(fn) {
    setBusy(true);
    setErr("");
    try {
      const res = await fn();
      setData(res.data);
      return res.data;
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { run(() => api.get("/schedules")); }, []);

  const send = async (t) => {
    if (!t.trim()) return;
    const d = await run(() => api.post("/schedules/disrupt-text", { text: t }));
    if (d) { setSeen(d.interpreted); setText(""); }
  };
  const restore = () => { setSeen(null); run(() => api.post("/schedules/generate")); };
  async function demo() {
    setBusy(true);
    setErr("");
    try { await loadDemo(); } catch (e) { setErr(errText(e)); }
    await run(() => api.get("/schedules"));
  }

  const days = useMemo(
    () =>
      (data?.days || [])
        .map((d) => ({
          date: d.date,
          rows: [
            ...d.fixed.map((f) => ({ kind: "fixed", title: f.title, start: f.start, end: f.end })),
            ...d.items.map((i) => ({ kind: "task", ...i, start: i.start_time, end: i.end_time })),
          ].sort((a, b) => new Date(a.start) - new Date(b.start)),
          study: d.items.reduce((n, i) => n + mins(i.end_time) - mins(i.start_time), 0),
        }))
        .filter((d) => d.rows.length),
    [data]
  );

  const active = days.find((d) => d.date === sel) || days[0];
  const moved = days.flatMap((d) => d.rows.filter((r) => r.displacement_reason).map((r) => ({ ...r, date: d.date })));
  const totalStudy = days.reduce((n, d) => n + d.study, 0);
  const taskCount = new Set(days.flatMap((d) => d.rows.filter((r) => r.kind === "task").map((r) => r.task_id))).size;
  const atRisk = data?.at_risk || [];
  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START / 60 + i);

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{hm(totalStudy)}</b><span>study planned</span></div>
        <div className="stat"><b>{taskCount}</b><span>tasks scheduled</span></div>
        <div className="stat good"><b>{moved.length}</b><span>blocks reorganised</span></div>
        <div className={`stat ${atRisk.length ? "warnstat" : ""}`}><b>{atRisk.length}</b><span>at risk</span></div>
      </div>

      <section className="card">
        <h3>Something changed?</h3>
        <p className="muted small">Tell Orbit in your own words. It works out what's affected and reorganises the rest.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input placeholder='e.g. "I am sick tomorrow afternoon"' value={text} onChange={(e) => setText(e.target.value)} />
          <button disabled={busy}>{busy ? "Working…" : "Reorganise"}</button>
        </form>
        <div className="chips">
          {CHIPS.map((c) => <button key={c} type="button" className="chip" disabled={busy} onClick={() => send(c)}>{c}</button>)}
        </div>
        {err && <div className="error">{err}</div>}
        {seen && (
          <div className="understood">
            <b>Understood:</b>{" "}
            {[...seen.blocks.map((b) => `${b.label} (${b.start.replace("T", " ").slice(0, 16)} → ${b.end.slice(11, 16)})`),
              ...seen.caps.map((c) => `max ${c.max_minutes} min of study on ${c.day}`)].join("; ")}
          </div>
        )}
      </section>

      {moved.length > 0 && (
        <div className="banner">
          <span>Nothing failed. {moved.length} block{moved.length > 1 ? "s were" : " was"} moved to keep your week workable.</span>
          <button className="ghost" onClick={restore} disabled={busy}>Restore original plan</button>
        </div>
      )}
      {atRisk.map((a) => (
        <div key={a.task_id} className="warn">⚠ <b>{a.title}</b> is short by {a.minutes_short} min. Consider a lighter scope or more time.</div>
      ))}

      {!days.length && !busy && (
        <section className="card empty">
          <h3>No plan yet</h3>
          <p className="muted">Add your classes and tasks on the Tasks page, or load a sample week to see Orbit in action.</p>
          <button onClick={demo} disabled={busy}>Load demo week</button>
        </section>
      )}

      {active && (
        <>
          <div className="tabs">
            {days.map((d) => (
              <button key={d.date} className={`tab ${d.date === active.date ? "on" : ""}`} onClick={() => setSel(d.date)}>
                <b>{wk(d.date)}</b><span>{dm(d.date)}</span><em>{d.study ? hm(d.study) : "free"}</em>
              </button>
            ))}
          </div>

          <div className="cols">
            <section className="card tlwrap">
              <div className="tl" style={{ height: (END - START) * PX }}>
                {hours.map((h) => (
                  <div key={h} className="hr" style={{ top: (h * 60 - START) * PX }}><span>{String(h).padStart(2, "0")}:00</span></div>
                ))}
                {active.rows.map((r, i) => {
                  const s = Math.max(mins(r.start), START), e = Math.min(mins(r.end), END);
                  return (
                    <div key={i} className={`blk ${r.kind} ${r.displacement_reason ? "moved" : ""}`}
                      style={{ top: (s - START) * PX, height: Math.max((e - s) * PX - 2, 20) }}
                      title={r.displacement_reason || ""}>
                      <b>{r.title}</b>
                      <span>{hhmm(r.start)}–{hhmm(r.end)}{r.displacement_reason ? " · ↻ moved" : ""}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <aside>
              <section className="card">
                <h3>What changed</h3>
                {moved.length === 0 && <p className="muted small">No changes yet. Use "Something changed?" above.</p>}
                {moved.map((m, i) => (
                  <div key={i} className="chg">
                    <b>{m.title}</b> <em>{wk(m.date)} {dm(m.date)}</em>
                    <div>{m.displacement_reason}</div>
                  </div>
                ))}
              </section>
              <section className="card legend">
                <h3>Legend</h3>
                <p><i className="sw task" /> Study block</p>
                <p><i className="sw moved" /> Reorganised block</p>
                <p><i className="sw fixed" /> Fixed commitment</p>
                <p className="muted small">Gaps around fixed blocks are commute and transition buffers.</p>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}