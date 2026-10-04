import axios from "axios";

const api = axios.create({ baseURL: "http://localhost:8000" });

api.interceptors.request.use((c) => {
  const t = localStorage.getItem("token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && localStorage.getItem("token")) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(e);
  }
);

export const errText = (e) => {
  const d = e.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => `${x.loc?.slice(-1)[0]}: ${x.msg}`).join(" | ");
  if (!e.response) return "Can't reach the server. Is uvicorn running?";
  return "Something went wrong. Try again.";
};

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const iso = (d, h, m = 0) => `${ymd(d)}T${pad(h)}:${pad(m)}:00+05:30`;

// One click: fixed classes + gym for 4 days, five tasks, then generate the plan.
export async function loadDemo() {
  const base = new Date();
  base.setDate(base.getDate() + 1);
  const day = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  const post = (body) => api.post("/tasks", body);

  for (let i = 0; i < 4; i++) {
    await post({ title: "Classes", estimated_duration: 420, priority: 3, is_fixed: true, commute_minutes: 20, deadline: iso(day(i), 9) });
    await post({ title: "Gym", estimated_duration: 60, priority: 3, is_fixed: true, commute_minutes: 10, deadline: iso(day(i), 18) });
  }
  await post({ title: "DSA practice", estimated_duration: 120, priority: 3, task_type: "growth" });
  await post({ title: "Maths revision", estimated_duration: 90, priority: 2, task_type: "growth" });
  await post({ title: "DBMS assignment", estimated_duration: 180, priority: 4, task_type: "deadline", deadline: iso(day(3), 18) });
  await post({ title: "OS practical prep", estimated_duration: 120, priority: 5, task_type: "deadline", deadline: iso(day(2), 9) });
  await post({ title: "Lab report", estimated_duration: 60, priority: 3, task_type: "deadline", deadline: iso(day(4), 18) });
  await api.post("/schedules/generate");
}

export default api;