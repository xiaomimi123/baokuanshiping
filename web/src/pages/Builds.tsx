import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type BuildOutput, type BuildOutputs, type BuildStatus, type BuildsList } from "../api";

export default function Builds() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState<BuildsList | null>(null);
  // 选中态存活于 URL 的 ?project=&id= 查询参数（而非 sessionStorage）：刷新页面、分享链接、
  // 浏览器前进/后退都能保持/还原选中的 build（I7）。新建项目的 build 不在默认（default 项目）
  // 列表里，选中态靠 project 参数维持。
  const selected = searchParams.get("id");
  const selectedProject = searchParams.get("project") ?? undefined;
  const [detail, setDetail] = useState<BuildStatus["build"]>(null);
  const [logs, setLogs] = useState("");
  const [outputs, setOutputs] = useState<BuildOutput[] | null>(null);
  const [outputsError, setOutputsError] = useState("");
  const [error, setError] = useState("");

  const select = useCallback((buildId: string, project?: string) => {
    const next = new URLSearchParams();
    next.set("id", buildId);
    if (project) next.set("project", project);
    setSearchParams(next);
  }, [setSearchParams]);

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
    setDetail(null);
    setOutputs(null);
    setOutputsError("");
    const projectQuery = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";
    const tick = async () => {
      try {
        const s = await api<BuildStatus>(`/api/builds/${selected}${projectQuery}`);
        if (stop) return;
        setDetail(s.build);
        const l = await api<{ lines?: string[] }>(`/api/builds/${selected}/logs?lines=80${projectQuery ? "&" + projectQuery.slice(1) : ""}`);
        if (!stop) setLogs(Array.isArray(l.lines) ? l.lines.join("\n") : JSON.stringify(l, null, 2));
        if (!stop && s.build && s.build.work.state !== "done") setTimeout(tick, 3000);
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    void tick();
    return () => { stop = true; };
  }, [selected, selectedProject]);

  // 产物清单只在结果 complete 时拉一次（result complete 意味着轮询已停止，不会重复触发）。
  useEffect(() => {
    if (!selected || detail?.result.state !== "complete") return;
    let stop = false;
    const projectQuery = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";
    (async () => {
      try {
        const o = await api<BuildOutputs>(`/api/builds/${selected}/outputs${projectQuery}`);
        if (!stop) setOutputs(o.build.outputs);
      } catch (e) { if (!stop) setOutputsError((e as Error).message); }
    })();
    return () => { stop = true; };
  }, [selected, selectedProject, detail?.result.state]);

  // 下载链接不带 type（保持后端 attachment + octet-stream 语义）；内联播放/展示需要额外的
  // `&type=<mediaType>`，让后端按真实 MIME 内联返回——Safari 对 <video>/<img> 的 MIME 声明比较严格，
  // octet-stream 会被拒播。type 值来自 outputs 清单的 mediaType，只在白名单命中时后端才会内联。
  const outputUrl = useCallback((name: string, mediaType?: string) => {
    const params = new URLSearchParams();
    if (selectedProject) params.set("project", selectedProject);
    if (mediaType) params.set("type", mediaType);
    const qs = params.toString();
    return `/api/builds/${selected}/outputs/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`;
  }, [selected, selectedProject]);

  return (
    <>
      <h1>任务</h1>
      <p className="sub">Build 历史与实时进度</p>
      {error && <div className="error-box">{error}</div>}
      <table className="list">
        <thead><tr><th>ID</th><th>标题</th><th>状态</th><th>创建时间</th><th>产物</th></tr></thead>
        <tbody>
          {list?.builds.map((b) => (
            <tr key={b.id} onClick={() => select(b.id)}>
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
          {detail.result.state === "complete" && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>产物</h4>
              {outputsError && <div className="error-box">{outputsError}</div>}
              {!outputsError && outputs === null && <p className="sub">加载产物清单…</p>}
              {outputs && outputs.length === 0 && <p className="sub">该 Build 没有产物。</p>}
              {outputs && outputs.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {outputs.map((o) => (
                    <OutputPreview
                      key={o.name}
                      output={o}
                      downloadUrl={outputUrl(o.name)}
                      previewUrl={outputUrl(o.name, o.mediaType)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <pre className="logs">{logs || "（暂无日志）"}</pre>
        </div>
      )}
    </>
  );
}

function OutputPreview({ output, downloadUrl, previewUrl }: { output: BuildOutput; downloadUrl: string; previewUrl: string }) {
  const [playFailed, setPlayFailed] = useState(false);
  const isVideo = output.mediaType?.startsWith("video/") === true;
  const isImage = output.mediaType?.startsWith("image/") === true;
  const isComposite = output.kind === "composite";

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
      <div className="row">
        <strong>{output.name}</strong>
        {output.target && <span className="badge">target</span>}
        <span className="desc">{output.mediaType ?? output.type}{output.size != null ? ` · ${(output.size / 1024).toFixed(1)} KB` : ""}</span>
        <span className="spacer" />
        {!isComposite && (
          <a className="btn" href={downloadUrl} download={output.name}>下载</a>
        )}
      </div>
      {isComposite && (
        <p className="sub" style={{ marginTop: 8 }}>
          该产物为复合目录，暂不支持网页内联预览或下载，请用 <code>hypit get</code> 导出。
        </p>
      )}
      {!isComposite && isVideo && !playFailed && (
        <video
          controls
          src={previewUrl}
          style={{ maxWidth: "100%", marginTop: 8 }}
          onError={() => setPlayFailed(true)}
        />
      )}
      {!isComposite && isImage && !playFailed && (
        <img
          src={previewUrl}
          alt={output.name}
          style={{ maxWidth: "100%", marginTop: 8 }}
          onError={() => setPlayFailed(true)}
        />
      )}
      {!isComposite && (isVideo || isImage) && playFailed && (
        <p className="sub" style={{ marginTop: 8 }}>无法内联预览该产物，请使用上方下载按钮。</p>
      )}
    </div>
  );
}
