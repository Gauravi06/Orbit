import { useState } from "react";
import api, { errText } from "./api";

export default function Login() {
  const [signup, setSignup] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      if (signup) await api.post("/auth/signup", f);
      const { data } = await api.post("/auth/login", { email: f.email, password: f.password });
      localStorage.setItem("token", data.access_token);
      window.location.href = "/";
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <div className="auth">
      <div className="hero">
        <h1>◐ Orbit</h1>
        <h2>Balance without burnout.</h2>
        <p>A schedule you can actually follow. When life changes mid-week, Orbit reorganises your plan instead of marking things "failed".</p>
        <ul>
          <li>Rules guarantee no clashes, sleep, or missed deadlines</li>
          <li>AI understands what changed, in your own words</li>
          <li>Every move comes with a reason</li>
        </ul>
      </div>
      <form className="card authcard" onSubmit={submit}>
        <h2>{signup ? "Create your account" : "Welcome back"}</h2>
        {signup && <input placeholder="Name" value={f.name} onChange={set("name")} required />}
        <input type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
        <input type="password" placeholder="Password (8+ characters)" value={f.password} onChange={set("password")} required />
        {err && <div className="error">{err}</div>}
        <button>{signup ? "Sign up" : "Log in"}</button>
        <a className="link" onClick={() => setSignup(!signup)}>
          {signup ? "Have an account? Log in" : "New here? Sign up"}
        </a>
      </form>
    </div>
  );
}