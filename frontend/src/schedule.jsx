import { useEffect, useState } from "react";
import api, { errText } from "./api";

const tm = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
const dt = (d) => new Date(d + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });

export default function Schedule() {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState(null);

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

  const generate = () => { setSeen(null); run(() => api.post("/schedules/generate")); };

  async function changed(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const d = await run(() => api.post("/schedules/disrupt-text", { text }));
    if (d) { setSeen(d.interpreted); setText(""); }
  }

  const logout = () => { localStorage.removeItem("token"); window.location.href = "/login"; };

  const days = (data?.days || [])
    .map((d) => ({
      date: d.date,
      rows: [
        ...d.fixed.map((f) => ({ kind: "fixed", title: f.title, start: f.start, end: f.end })),
        ...d.items.map((i) => ({ kind: "task", ...i, start: i.start_time, end: i.end_time })),
      ].sort((a, b) => new Date(a.start) - new Date(b.start)),
    }))
    .filter((d) => d.rows.length);

  const moved = days.reduce((n, d) => n + d.rows.filter((r) => r.displacement_reason).length, 0);

  return (
    <div className="wrap">
      <header>
        <h1>Orbit</h1>
        <div>
          <button className="ghost" onClick={generate} disabled={busy}>Generate plan</button>
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
      </header>

      <form className="card change" onSubmit={changed}>
        <strong>Something changed?</strong>
        <div className="row">
          <input
            placeholder='e.g. "I am sick tomorrow afternoon" or "lab ran 2 hours late"'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button disabled={busy}>{busy ? "Reorganising…" : "Reorganise"}</button>
        </div>
        {err && <div className="error">{err}</div>}
        {seen && (
          <div className="muted small">
            Understood:{" "}
            {[...seen.blocks.map((b) => `${b.label} (${b.start.replace("T", " ").slice(0, 16)} to ${b.end.slice(11, 16)})`),
              ...seen.caps.map((c) => `max ${c.max_minutes} min on ${c.day}`)].join("; ")}
          </div>
        )}
      </form>

      {moved > 0 && <div className="banner">Nothing failed. {moved} block{moved > 1 ? "s were" : " was"} moved to keep your week workable.</div>}
      {data?.at_risk?.map((a) => (
        <div key={a.task_id} className="warn">At risk: {a.title} is short by {a.minutes_short} min. Consider a lighter scope.</div>
      ))}

      {!days.length && !busy && <p className="muted">No schedule yet. Add tasks, then press Generate plan.</p>}

      {days.map((d) => (
        <section key={d.date} className="card">
          <h2>{dt(d.date)}</h2>
          {d.rows.map((r, idx) => (
            <div key={idx} className={`row-item ${r.kind} ${r.displacement_reason ? "moved" : ""}`}>
              <div className="time">{tm(r.start)}–{tm(r.end)}</div>
              <div>
                <div className="title">{r.title}</div>
                {r.displacement_reason && <div className="reason">↻ {r.displacement_reason}</div>}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}