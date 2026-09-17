import { NavLink, Outlet } from "react-router-dom";

const nav = [
  { to: "/", label: "总览" },
  { to: "/models", label: "模型与服务" },
  { to: "/builds", label: "任务" },
  { to: "/studio", label: "Studio" },
];

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">Hy<em>pit</em> 工作台</div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            {n.label}
          </NavLink>
        ))}
      </aside>
      <main className="page"><Outlet /></main>
    </div>
  );
}
