import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import Login from "./Login";
import Schedule from "./Schedule";
import Tasks from "./Tasks";
import "./App.css";

function Shell({ children }) {
  const logout = () => { localStorage.removeItem("token"); window.location.href = "/login"; };
  return (
    <>
      <nav className="nav">
        <div className="brand">◐ Orbit <span>Balance without burnout</span></div>
        <div className="links">
          <NavLink to="/" end>Plan</NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
        </div>
        <button className="ghost" onClick={logout}>Log out</button>
      </nav>
      <main className="wrap">{children}</main>
    </>
  );
}

export default function App() {
  const authed = !!localStorage.getItem("token");
  const guard = (el) => (authed ? <Shell>{el}</Shell> : <Navigate to="/login" replace />);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={guard(<Schedule />)} />
        <Route path="/tasks" element={guard(<Tasks />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}