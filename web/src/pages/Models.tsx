import { useCallback, useEffect, useState } from "react";
import { api, type AuthStatus, type Doctor, type ProfileEnvelope, type RuntimeProfile } from "../api";

const CAPABILITIES = [
  ["视频", ["seedance-2.5", "seedance-2-mini", "grok-imagine-video", "minimax-h3"]],
  ["图像", ["gpt-image-2", "nano-banana", "seedream-5-lite"]],
  ["语音", ["eleven_ttv_v3", "fishaudio/voice-design-1", "fishaudio/voice-clone", "mimo-v2.5-tts-voicedesign", "mimo-v2.5-tts-voiceclone"]],
  ["转写", ["transcription"]],
] as const;

export default function Models() {
  const [env, setEnv] = useState<ProfileEnvelope | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const nextEnv = await api<ProfileEnvelope>("/api/profile");
      setEnv(nextEnv);
      if (nextEnv.profile.endpoints?.["hypihub.default"]) {
        setAuth(await api<AuthStatus>("/api/auth/hypihub.default"));
      } else {
        setAuth(null);
      }
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const profile = env?.profile;
  const hub = profile?.endpoints?.["hypihub.default"];
  const local = profile?.endpoints?.["hyperframes.local"];
  const hubConfigured = auth?.credentials.some((c) => c.configured) ?? false;

  const patch = (endpoint: string, key: string, value: unknown) => {
    if (!env) return;
    const next = structuredClone(env.profile) as RuntimeProfile;
    const ep = next.endpoints?.[endpoint];
    if (!ep) return;
    ep.config = { ...(ep.config ?? {}), [key]: value };
    if (value === "" || value === undefined || Number.isNaN(value)) delete (ep.config as Record<string, unknown>)[key];
    setEnv({ ...env, profile: next });
  };
  const patchCapability = (cap: string, value: number | undefined) => {
    if (!env) return;
    const next = structuredClone(env.profile) as RuntimeProfile;
    const ep = next.endpoints?.["hypihub.default"];
    if (!ep) return;
    const cc = { ...((ep.config?.capabilityConcurrency as Record<string, number>) ?? {}) };
    if (value == null || Number.isNaN(value)) delete cc[cap]; else cc[cap] = value;
    ep.config = { ...(ep.config ?? {}), capabilityConcurrency: cc };
    if (Object.keys(cc).length === 0) delete (ep.config as Record<string, unknown>).capabilityConcurrency;
    setEnv({ ...env, profile: next });
  };

  const save = async () => {
    if (!env) return;
    setBusy(true); setMsg(""); setError("");
    try {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ profile: env.profile }) });
      setMsg("已保存到 " + env.path + "（重启 Runtime / Studio 后生效）");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const login = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      await api("/api/auth/hypihub.default", { method: "POST", body: JSON.stringify({ secret }) });
      setSecret(""); setMsg("HypiHub 凭据已保存"); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const test = async (endpoint: string) => {
    setBusy(true); setError(""); setMsg("");
    try {
      const d = await api<Doctor>(`/api/doctor?endpoint=${encodeURIComponent(endpoint)}`);
      setMsg(d.ok ? `${endpoint}：连通正常` : `${endpoint}：` + d.diagnostics.map((x) => x.message).join("；"));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const num = (v: unknown) => (typeof v === "number" ? String(v) : "");
  const cc = (hub?.config?.capabilityConcurrency as Record<string, number> | undefined) ?? {};

  return (
    <>
      <h1>模型与服务</h1>
      <p className="sub">本地渲染与媒体处理在本机运行；生成模型服务按需接入。保存写回 {env?.path ?? "…"}</p>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="card" style={{ marginBottom: 16 }}>{msg}</div>}
      <div className="grid">
        {!hub && env && (
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>生成模型服务</h3>
            <p className="desc">当前未接入任何生成模型服务（HypiHub 已停用）。纯字幕 / 动效 / 代码渲染的视频不需要模型服务；需要 AI 生图 / 生视频时，可接入 HypiHub 或自建直连 Provider（见 README）。</p>
          </div>
        )}
        {hub && (
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="row">
            <h3>HypiHub 网关</h3>
            <span className={"badge " + (hubConfigured ? "badge-ok" : "badge-warn")}>{hubConfigured ? "已连接" : "未配置凭据"}</span>
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => test("hypihub.default")}>测试连通</button>
          </div>
          <p className="desc">Seedance / Seedream / GPT Image / Nano Banana / Grok / MiniMax / 语音 / 转写</p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 2 }}>
              <label>API Key（粘贴后保存，不回显）</label>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="hypihub API key" />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn btn-primary" disabled={busy || !secret} onClick={login}>保存凭据</button>
            </div>
            <div className="field">
              <label>总并发 defaultConcurrency</label>
              <input value={num(hub?.config?.defaultConcurrency)} onChange={(e) => patch("hypihub.default", "defaultConcurrency", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </div>
          {CAPABILITIES.map(([group, caps]) => (
            <div key={group}>
              <p className="desc" style={{ margin: "10px 0 6px" }}>{group} · 每模型并发上限（留空 = 跟随总并发）</p>
              <div className="row">
                {caps.map((cap) => (
                  <div className="field" key={cap} style={{ minWidth: 180 }}>
                    <label>{cap}</label>
                    <input value={cc[cap] != null ? String(cc[cap]) : ""}
                      onChange={(e) => patchCapability(cap, e.target.value === "" ? undefined : Number(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
        <div className="card">
          <div className="row">
            <h3>本地渲染</h3>
            <span className="badge badge-ok">hyperframes.local</span>
            <span className="spacer" />
            <button className="btn" disabled={busy} onClick={() => test("hyperframes.local")}>测试</button>
          </div>
          <p className="desc">HyperFrames 视频合成（Chromium + ffmpeg）</p>
          <div className="field"><label>并行 worker 数</label>
            <input value={num(local?.config?.workers)} onChange={(e) => patch("hyperframes.local", "workers", e.target.value === "" ? "" : Number(e.target.value))} /></div>
          <div className="field"><label>渲染并发 defaultConcurrency</label>
            <input value={num(local?.config?.defaultConcurrency)} onChange={(e) => patch("hyperframes.local", "defaultConcurrency", e.target.value === "" ? "" : Number(e.target.value))} /></div>
          <div className="field"><label>GPU 模式 browserGpu</label>
            <select value={String(local?.config?.browserGpu ?? "hardware")} onChange={(e) => patch("hyperframes.local", "browserGpu", e.target.value)}>
              <option value="hardware">hardware</option><option value="software">software</option><option value="auto">auto</option>
            </select></div>
          {typeof local?.config?.chromePath === "string" && (
            <p className="desc">浏览器：{String(local.config.chromePath)}（容器内固定）</p>)}
        </div>
        <div className="card">
          <div className="row"><h3>本地媒体</h3><span className="badge badge-ok">media.local</span>
            <span className="spacer" /><button className="btn" disabled={busy} onClick={() => test("media.local")}>测试</button></div>
          <p className="desc">音频时间线渲染与封装（ffmpeg）；无需配置。</p>
        </div>
      </div>
      <div className="row" style={{ marginTop: 20 }}>
        <span className="spacer" />
        <button className="btn" onClick={() => void load()}>放弃修改</button>
        <button className="btn btn-primary" disabled={busy || !env} onClick={save}>保存配置</button>
      </div>
    </>
  );
}
