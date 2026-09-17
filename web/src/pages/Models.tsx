import { useCallback, useEffect, useState } from "react";
import { api, type AuthStatus, type Doctor, type ProfileEnvelope, type RuntimeProfile } from "../api";

const CAPABILITIES = [
  ["视频", ["seedance-2.5", "seedance-2-mini", "grok-imagine-video", "minimax-h3"]],
  ["图像", ["gpt-image-2", "nano-banana", "seedream-5-lite"]],
  ["语音", ["eleven_ttv_v3", "fishaudio/voice-design-1", "fishaudio/voice-clone", "mimo-v2.5-tts-voicedesign", "mimo-v2.5-tts-voiceclone"]],
  ["转写", ["transcription"]],
] as const;

type ProviderDef = {
  instance: string;
  use: string;
  title: string;
  desc: string;
  credLabel: string;
  models: [string, string][];
  modelField: "modelMap" | "wireModel";
  defaults: Record<string, unknown>;
  bindings: Record<string, string>;
};

const PROVIDERS: ProviderDef[] = [
  {
    instance: "volcengine.default", use: "@workbench/provider-volcengine", title: "火山引擎（方舟）",
    desc: "Seedance 生视频 ×4 · Seedream 生图", credLabel: "方舟 API Key",
    models: [
      ["seedance-2", "Seedance 2.0"],
      ["seedance-2-fast", "Seedance 2.0 Fast"],
      ["seedance-2-mini", "Seedance 2.0 Mini"],
      ["seedance-2.5", "Seedance 2.5"],
      ["seedream-5-lite", "Seedream 5 Lite"],
    ],
    modelField: "modelMap",
    defaults: {
      baseUrl: "https://ark.cn-beijing.volces.com",
      apiKey: { store: "file", key: "volcengine.ark" },
      modelMap: {
        "seedance-2": "", "seedance-2-fast": "", "seedance-2-mini": "", "seedance-2.5": "",
        "seedream-5-lite": "",
      },
      defaultConcurrency: 2, pollIntervalMs: 8000, requestTimeoutMs: 120000,
    },
    bindings: {
      "@hypit/seedance@1#seedance-2": "volcengine.default",
      "@hypit/seedance@1#seedance-2-fast": "volcengine.default",
      "@hypit/seedance@1#seedance-2-mini": "volcengine.default",
      "@hypit/seedance@1#seedance-2.5": "volcengine.default",
      "@hypit/seedream@1#seedream-5-lite": "volcengine.default",
    },
  },
  {
    instance: "openai.images", use: "@workbench/provider-openai-image", title: "OpenAI 兼容",
    desc: "GPT Image 生图 · baseUrl 可改为任意中转站", credLabel: "API Key",
    models: [["wireModel", "线上模型 ID"]], modelField: "wireModel",
    defaults: {
      baseUrl: "https://api.openai.com",
      apiKey: { store: "file", key: "openai.images" },
      wireModel: "gpt-image-1",
      defaultConcurrency: 2, requestTimeoutMs: 180000,
    },
    bindings: { "@hypit/gpt-image@1#gpt-image-2": "openai.images" },
  },
  {
    instance: "gemini.images", use: "@workbench/provider-gemini-image", title: "Google Gemini",
    desc: "Nano Banana 生图/改图", credLabel: "Gemini API Key",
    models: [
      ["nano-banana-2", "Nano Banana 2"],
      ["nano-banana-pro", "Nano Banana Pro"],
    ],
    modelField: "modelMap",
    defaults: {
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: { store: "file", key: "gemini.images" },
      modelMap: { "nano-banana-2": "gemini-2.5-flash-image", "nano-banana-pro": "gemini-3-pro-image-preview" },
      defaultConcurrency: 2, requestTimeoutMs: 180000,
    },
    bindings: {
      "@hypit/nano-banana@1#nano-banana-2": "gemini.images",
      "@hypit/nano-banana@1#nano-banana-pro": "gemini.images",
    },
  },
];

export default function Models() {
  const [env, setEnv] = useState<ProfileEnvelope | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [providerAuth, setProviderAuth] = useState<Record<string, AuthStatus | null>>({});
  const [secret, setSecret] = useState("");
  const [providerSecrets, setProviderSecrets] = useState<Record<string, string>>({});
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
      const present = PROVIDERS.filter((p) => nextEnv.profile.endpoints?.[p.instance]);
      const results = await Promise.allSettled(
        present.map((p) => api<AuthStatus>(`/api/auth/${encodeURIComponent(p.instance)}`)),
      );
      const nextProviderAuth: Record<string, AuthStatus | null> = {};
      present.forEach((p, i) => {
        const r = results[i];
        nextProviderAuth[p.instance] = r.status === "fulfilled" ? r.value : null;
      });
      setProviderAuth(nextProviderAuth);
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

  const patchNested = (endpoint: string, field: string, subKey: string, value: string) => {
    if (!env) return;
    const next = structuredClone(env.profile) as RuntimeProfile;
    const ep = next.endpoints?.[endpoint];
    if (!ep) return;
    const obj = { ...((ep.config?.[field] as Record<string, unknown>) ?? {}) };
    obj[subKey] = value;
    ep.config = { ...(ep.config ?? {}), [field]: obj };
    setEnv({ ...env, profile: next });
  };

  const saveProviderCredential = async (instance: string) => {
    const value = providerSecrets[instance];
    if (!value) return;
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`/api/auth/${encodeURIComponent(instance)}`, { method: "POST", body: JSON.stringify({ secret: value }) });
      setProviderSecrets((s) => ({ ...s, [instance]: "" }));
      setMsg(`${instance} 凭据已保存`);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const enableProvider = async (p: ProviderDef) => {
    if (!env) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const next = structuredClone(env.profile) as RuntimeProfile;
      next.endpoints = { ...(next.endpoints ?? {}) };
      next.endpoints[p.instance] = { use: p.use, config: structuredClone(p.defaults) as Record<string, unknown> };
      next.bindings = { ...(next.bindings ?? {}), ...p.bindings };
      next.credentials = { ...(next.credentials ?? {}) };
      if (!next.credentials.file) {
        next.credentials.file = { use: "@hypit/credential-store-file", config: { path: "credentials" } };
      }
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ profile: next }) });
      setMsg(`${p.title} 已启用并保存`);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
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
      <p className="sub">本地渲染与媒体处理在本机运行；生成模型服务按需接入 HypiHub 网关或以下直连厂商。保存写回 {env?.path ?? "…"}</p>
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="card" style={{ marginBottom: 16 }}>{msg}</div>}
      <div className="grid">
        {env && PROVIDERS.map((p) => {
          const ep = profile?.endpoints?.[p.instance];
          const pAuth = providerAuth[p.instance] ?? null;
          const configured = pAuth?.credentials.some((c) => c.configured) ?? false;
          if (!ep) {
            return (
              <div className="card" key={p.instance}>
                <div className="row">
                  <h3>{p.title}</h3>
                  <span className="badge badge-warn">未启用</span>
                </div>
                <p className="desc">{p.desc}</p>
                <button className="btn btn-primary" disabled={busy} onClick={() => void enableProvider(p)}>启用</button>
              </div>
            );
          }
          return (
            <div className="card" key={p.instance}>
              <div className="row">
                <h3>{p.title}</h3>
                <span className={"badge " + (configured ? "badge-ok" : "badge-warn")}>{configured ? "已连接" : "未配置凭据"}</span>
                <span className="spacer" />
                <button className="btn" disabled={busy} onClick={() => test(p.instance)}>测试</button>
              </div>
              <p className="desc">{p.desc}</p>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div className="field" style={{ flex: 2 }}>
                  <label>{p.credLabel}（粘贴后保存，不回显）</label>
                  <input
                    type="password"
                    value={providerSecrets[p.instance] ?? ""}
                    onChange={(e) => setProviderSecrets((s) => ({ ...s, [p.instance]: e.target.value }))}
                    placeholder={p.credLabel}
                  />
                </div>
                <div className="field">
                  <label>&nbsp;</label>
                  <button className="btn btn-primary" disabled={busy || !providerSecrets[p.instance]} onClick={() => void saveProviderCredential(p.instance)}>保存凭据</button>
                </div>
              </div>
              <div className="field">
                <label>baseUrl</label>
                <input
                  value={typeof ep.config?.baseUrl === "string" ? ep.config.baseUrl : ""}
                  onChange={(e) => patch(p.instance, "baseUrl", e.target.value)}
                />
              </div>
              {p.modelField === "wireModel" ? (
                <div className="field">
                  <label>线上模型 ID</label>
                  <input
                    value={typeof ep.config?.wireModel === "string" ? ep.config.wireModel : ""}
                    onChange={(e) => patch(p.instance, "wireModel", e.target.value)}
                  />
                </div>
              ) : (
                <div className="row">
                  {p.models.map(([key, label]) => {
                    const modelMap = (ep.config?.modelMap as Record<string, string> | undefined) ?? {};
                    const value = modelMap[key] ?? "";
                    return (
                      <div className="field" key={key} style={{ minWidth: 200 }}>
                        <label>{label}</label>
                        <input
                          value={value}
                          placeholder={p.instance === "volcengine.default" ? "填入方舟控制台的模型 ID" : undefined}
                          onChange={(e) => patchNested(p.instance, "modelMap", key, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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
