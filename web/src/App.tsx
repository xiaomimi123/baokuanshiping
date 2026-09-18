import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

const nav = [
  { to: "/", label: "总览" },
  { to: "/create", label: "创作" },
  { to: "/models", label: "模型与服务" },
  { to: "/builds", label: "任务" },
  { to: "/studio", label: "Studio" },
];

export default function App() {
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/runtime/status")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { ready?: boolean }) => { if (!cancelled) setRuntimeReady(Boolean(data.ready)); })
      .catch(() => { if (!cancelled) setRuntimeReady(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo"><span className="logo-dot" />Hy<em>pit</em> 工作台</div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar-spacer" />
        <div className="runtime-pill">
          <span className={"runtime-dot" + (runtimeReady ? " on" : "")} />
          {runtimeReady ? "Runtime 运行中" : "未运行"}
        </div>
      </aside>
      <main className="page"><Outlet /></main>
    </div>
  );
}
