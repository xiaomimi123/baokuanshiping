import { useCallback, useEffect, useState } from "react";
import { api, type Doctor, type RuntimeStatus } from "../api";

export default function Dashboard() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [s, d] = await Promise.all([
        api<RuntimeStatus>("/api/runtime/status"),
        api<Doctor>("/api/doctor"),
      ]);
      setStatus(s); setDoctor(d);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = async (dir: "up" | "down") => {
    setBusy(true);
    try { await api(`/api/runtime/${dir}`, { method: "POST" }); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>总览</h1>
      <p className="sub">Runtime 状态与环境诊断</p>
      {error && <div className="error-box">{error}</div>}
      <div className="grid">
        <div className="card">
          <h3>Runtime</h3>
          <p className="desc">本地 Build Worker</p>
          <div className="row">
            {status
              ? <span className={"badge " + (status.ready ? "badge-ok" : "badge-warn")}>
                  {status.ready ? "运行中" : status.worker.state}
                </span>
              : <span className="badge">加载中…</span>}
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => toggle("up")}>启动</button>
            <button className="btn" disabled={busy} onClick={() => toggle("down")}>停止</button>
          </div>
          {status && (
            <p className="desc" style={{ marginTop: 12 }}>
              进行中 {status.builds.working} · 提交中 {status.builds.submitting} · 程序 {status.programs.ready}/{status.programs.total}
            </p>
          )}
        </div>
        <div className="card">
          <h3>诊断</h3>
          <p className="desc">hypit doctor</p>
          {doctor && (
            <>
              <span className={"badge " + (doctor.ok ? "badge-ok" : "badge-err")}>
                {doctor.ok ? "无问题" : `${doctor.diagnostics.filter(d => d.severity === "error").length} 个错误`}
              </span>
              <ul style={{ paddingLeft: 18, marginTop: 10 }}>
                {doctor.diagnostics.slice(0, 5).map((d, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <span className={"badge badge-" + (d.severity === "error" ? "err" : d.severity === "warning" ? "warn" : "ok")}>{d.severity}</span>{" "}
                    {d.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
