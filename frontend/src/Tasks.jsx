import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { errText, loadDemo, ymd } from "./api";

const when = (d) => new Date(d).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export default function Tasks() {
  const nav = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [t, setT] = useState({ title: "", task_type: "deadline", priority: 3, estimated_duration: 60, deadline: "" });
  const [f, setF] = useState({ title: "Classes", date: ymd(new Date()), time: "09:00", estimated_duration: 420, commute_minutes: 20, days: 1 });

  const load = () => api.get("/tasks").then((r) => setTasks(r.data)).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  async function act(fn, ok) {
    setErr(""); setMsg(""); setBusy(true);
    try { await fn(); setMsg(ok); await load(); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  }

  const addTask = (e) => {
    e.preventDefault();
    if (t.task_type === "deadline" && !t.deadline) return setErr("A deadline task needs a deadline.");
    const body = { title: t.title, task_type: t.task_type, priority: Number(t.priority), estimated_duration: Number(t.estimated_duration) };
    if (t.deadline) body.deadline = `${t.deadline}:00+05:30`;
    act(async () => { await api.post("/tasks", body); setT({ ...t, title: "", deadline: "" }); }, "Task added. Press “Update my plan” to include it.");
  };

  const addFixed = (e) => {
    e.preventDefault();
    act(async () => {
      for (let i = 0; i < Number(f.days); i++) {
        const d = new Date(f.date + "T00:00");
        d.setDate(d.getDate() + i);
        await api.post("/tasks", {
          title: f.title, is_fixed: true, priority: 3,
          estimated_duration: Number(f.estimated_duration), commute_minutes: Number(f.commute_minutes),
          deadline: `${ymd(d)}T${f.time}:00+05:30`,
        });
      }
    }, "Commitment added. Press “Update my plan” to include it.");
  };

  const update = () => act(async () => { await api.post("/schedules/generate"); nav("/"); }, "");
  const demo = () => act(async () => { await loadDemo(); nav("/"); }, "");
  const del = (id) => act(() => api.delete(`/tasks/${id}`), "Removed.");
  const done = (id) => act(() => api.patch(`/tasks/${id}`, { status: "done" }), "Marked done.");

  const fixed = tasks.filter((x) => x.is_fixed).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const plain = tasks.filter((x) => !x.is_fixed && x.status !== "done");
  const s = (k, o) => (e) => o({ ...(o === setT ? t : f), [k]: e.target.value });

  return (
    <>
      <div className="bar">
        <h2>Tasks & commitments</h2>
        <div>
          <button className="ghost" onClick={demo} disabled={busy}>Load demo week</button>
          <button onClick={update} disabled={busy}>Update my plan</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="banner">{msg}</div>}

      <div className="cols2">
        <section className="card">
          <h3>Add a task</h3>
          <form className="form" onSubmit={addTask}>
            <input placeholder="What needs doing?" value={t.title} onChange={s("title", setT)} required />
            <div className="row">
              <label>Type
                <select value={t.task_type} onChange={s("task_type", setT)}>
                  <option value="deadline">Deadline</option>
                  <option value="growth">Growth (ongoing)</option>
                </select>
              </label>
              <label>Priority
                <select value={t.priority} onChange={s("priority", setT)}>
                  <option value={5}>5 – most urgent</option><option value={4}>4</option><option value={3}>3</option>
                  <option value={2}>2</option><option value={1}>1 – least</option>
                </select>
              </label>
            </div>
            <div className="row">
              <label>Minutes needed<input type="number" min="15" step="15" value={t.estimated_duration} onChange={s("estimated_duration", setT)} required /></label>
              <label>Deadline {t.task_type === "growth" && "(optional)"}<input type="datetime-local" value={t.deadline} onChange={s("deadline", setT)} /></label>
            </div>
            <button disabled={busy}>Add task</button>
          </form>
        </section>

        <section className="card">
          <h3>Add a fixed commitment</h3>
          <form className="form" onSubmit={addFixed}>
            <input placeholder="Classes, gym, lab…" value={f.title} onChange={s("title", setF)} required />
            <div className="row">
              <label>First day<input type="date" value={f.date} onChange={s("date", setF)} required /></label>
              <label>Starts at<input type="time" value={f.time} onChange={s("time", setF)} required /></label>
            </div>
            <div className="row">
              <label>Length (min)<input type="number" min="15" step="15" value={f.estimated_duration} onChange={s("estimated_duration", setF)} required /></label>
              <label>Commute (min)<input type="number" min="0" step="5" value={f.commute_minutes} onChange={s("commute_minutes", setF)} required /></label>
              <label>Repeat days<input type="number" min="1" max="7" value={f.days} onChange={s("days", setF)} required /></label>
            </div>
            <button disabled={busy}>Add commitment</button>
          </form>
        </section>
      </div>

      <section className="card">
        <h3>To do ({plain.length})</h3>
        {!plain.length && <p className="muted small">Nothing yet.</p>}
        {plain.map((x) => (
          <div key={x.id} className="li">
            <div>
              <b>{x.title}</b>
              <div className="muted small">
                {x.task_type} · priority {x.priority} · {x.estimated_duration} min{x.deadline ? ` · due ${when(x.deadline)}` : ""}
              </div>
            </div>
            <div>
              <button className="ghost" onClick={() => done(x.id)} disabled={busy}>✓ Done</button>
              <button className="ghost danger" onClick={() => del(x.id)} disabled={busy}>Delete</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Fixed commitments ({fixed.length})</h3>
        {!fixed.length && <p className="muted small">Nothing yet.</p>}
        {fixed.map((x) => (
          <div key={x.id} className="li">
            <div>
              <b>{x.title}</b>
              <div className="muted small">{when(x.deadline)} · {x.estimated_duration} min · {x.commute_minutes} min commute</div>
            </div>
            <button className="ghost danger" onClick={() => del(x.id)} disabled={busy}>Delete</button>
          </div>
        ))}
      </section>
    </>
  );
}