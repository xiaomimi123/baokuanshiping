import { useCallback, useEffect, useState } from "react";
import { api, type BuildStatus, type BuildsList } from "../api";

export default function Builds() {
  const [list, setList] = useState<BuildsList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BuildStatus["build"]>(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (before?: string) => {
    try {
      setError("");
      const page = await api<BuildsList>("/api/builds?limit=20" + (before ? `&before=${before}` : ""));
      setList((prev) => before && prev ? { builds: [...prev.builds, ...page.builds], next: page.next } : page);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api<BuildStatus>(`/api/builds/${selected}`);
        if (stop) return;
        setDetail(s.build);
        const l = await api<{ lines?: string[] }>(`/api/builds/${selected}/logs?lines=80`);
        if (!stop) setLogs(Array.isArray(l.lines) ? l.lines.join("\n") : JSON.stringify(l, null, 2));
        if (!stop && s.build && s.build.work.state !== "done") setTimeout(tick, 3000);
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    void tick();
    return () => { stop = true; };
  }, [selected]);

  return (
    <>
      <h1>任务</h1>
      <p className="sub">Build 历史与实时进度</p>
      {error && <div className="error-box">{error}</div>}
      <table className="list">
        <thead><tr><th>ID</th><th>标题</th><th>状态</th><th>创建时间</th><th>产物</th></tr></thead>
        <tbody>
          {list?.builds.map((b) => (
            <tr key={b.id} onClick={() => setSelected(b.id)}>
              <td style={{ fontFamily: "monospace" }}>{b.id.slice(0, 12)}</td>
              <td>{b.title ?? b.run ?? "—"}</td>
              <td><span className={"badge " + (b.outcome === "complete" ? "badge-ok" : b.outcome === "failed" ? "badge-err" : "badge-warn")}>{b.outcome}</span></td>
              <td>{new Date(b.createdAt).toLocaleString("zh-CN")}</td>
              <td>{b.outputCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list?.next && <button className="btn" style={{ marginTop: 12 }} onClick={() => void load(list.next)}>加载更多</button>}
      {list && list.builds.length === 0 && <p className="sub">还没有 Build。用你的 Agent 提交一个试试。</p>}
      {selected && detail && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="row">
            <h3>{detail.title ?? detail.id}</h3>
            <span className="badge">{detail.work.state}{detail.work.outcome ? ` · ${detail.work.outcome}` : ""}</span>
            {detail.work.requests && <span className="desc">{detail.work.requests.completed}/{detail.work.requests.total} 请求</span>}
            <span className="spacer" />
            {detail.result.state === "complete" && detail.result.outputCount != null && (
              <span className="badge badge-ok">{detail.result.outputCount} 个产物（用 hypit get 或产物链接下载）</span>)}
          </div>
          {detail.attention && <div className="error-box">{detail.attention.message}</div>}
          {detail.failure && <div className="error-box">{detail.failure}</div>}
          {detail.operations && detail.operations.length > 0 && (
            <ul style={{ paddingLeft: 18 }}>
              {detail.operations.map((op, i) => (
                <li key={i}>{op.endpoint} · {op.state}
                  {op.progress ? ` · ${op.progress.phase} ${op.progress.completed ?? ""}${op.progress.total ? "/" + op.progress.total : ""}` : ""}
                  {op.failure ? ` · ${op.failure.message}` : ""}{op.count ? ` ×${op.count}` : ""}</li>
              ))}
            </ul>
          )}
          <pre className="logs">{logs || "（暂无日志）"}</pre>
        </div>
      )}
    </>
  );
}
