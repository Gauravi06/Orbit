import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { errText } from "./api";

export default function Login() {
  const nav = useNavigate();
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
    <div className="card login">
      <h1>Orbit</h1>
      <p className="muted">Balance without burnout.</p>
      <form onSubmit={submit}>
        {signup && <input placeholder="Name" value={f.name} onChange={set("name")} required />}
        <input type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
        <input type="password" placeholder="Password" value={f.password} onChange={set("password")} required />
        {err && <div className="error">{err}</div>}
        <button>{signup ? "Sign up" : "Log in"}</button>
      </form>
      <a className="link" onClick={() => setSignup(!signup)}>
        {signup ? "Have an account? Log in" : "New here? Sign up"}
      </a>
    </div>
  );
}