import { useEffect, useState } from "react";
import { api } from "../api";

type StudioState = { running: boolean; url?: string; run?: string };

export default function Studio() {
  const [state, setState] = useState<StudioState | null>(null);
  const [run, setRun] = useState("build.svrun");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => setState(await api<StudioState>("/api/studio"));
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, []);

  const studioHref = `http://${location.hostname}:5179/`;

  const start = async () => {
    setBusy(true); setError("");
    try {
      const s = await api<StudioState>("/api/studio", { method: "POST", body: JSON.stringify({ run }) });
      setState(s);
      if (s.running) window.open(studioHref, "_blank");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>Studio</h1>
      <p className="sub">官方可视化编辑器（端口 5179）</p>
      {error && <div className="error-box">{error}</div>}
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>Run 源（相对项目目录的 .svrun 路径）</label>
          <input value={run} onChange={(e) => setRun(e.target.value)} placeholder="build.svrun" />
        </div>
        <div className="row">
          {state?.running
            ? <span className="badge badge-ok">运行中 · {state.run}</span>
            : <span className="badge">未运行</span>}
          <span className="spacer" />
          {state?.running && <a className="btn" href={studioHref} target="_blank" rel="noreferrer">打开 Studio</a>}
          {state?.running && <button className="btn" disabled={busy}
            onClick={() => { void api("/api/studio", { method: "DELETE" }).then(refresh); }}>停止</button>}
          <button className="btn btn-primary" disabled={busy || !run} onClick={start}>
            {state?.running ? "切换 Run 并重启" : "启动 Studio"}
          </button>
        </div>
      </div>
    </>
  );
}
