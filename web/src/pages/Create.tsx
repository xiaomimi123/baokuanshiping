import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type AssetInfo,
  type ProjectDetail,
  type ProjectSummary,
  type TemplateInfo,
} from "../api";

type View = "list" | "wizard" | "detail";

const ASSET_KIND_LABEL: Record<string, string> = { video: "视频", audio: "音频", image: "图片" };

function isTranscribable(asset: AssetInfo): boolean {
  return asset.type.startsWith("video/") || asset.type.startsWith("audio/");
}

/** 上传区 + 已传素材列表 + 转写按钮，向导第②步与项目详情共用。 */
function AssetsPanel({
  projectName,
  assets,
  onAssetsChange,
}: {
  projectName: string;
  assets: AssetInfo[];
  onAssetsChange: (assets: AssetInfo[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [transcribeText, setTranscribeText] = useState<Record<string, string>>({});
  const [transcribeError, setTranscribeError] = useState<Record<string, string>>({});

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(true);
      setError("");
      setRejected([]);
      try {
        const form = new FormData();
        for (const f of list) form.append("files", f);
        const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/assets`, {
          method: "POST",
          body: form,
        });
        const data = (await res.json()) as { assets?: AssetInfo[]; rejected?: string[]; error?: { message: string } };
        if (!res.ok) throw new Error(data.error?.message ?? `${res.status}`);
        if (data.assets) onAssetsChange(data.assets);
        if (data.rejected && data.rejected.length > 0) setRejected(data.rejected);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [projectName, onAssetsChange],
  );

  const remove = async (file: string) => {
    setError("");
    try {
      const data = await api<{ assets: AssetInfo[] }>(
        `/api/projects/${encodeURIComponent(projectName)}/assets/${encodeURIComponent(file)}`,
        { method: "DELETE" },
      );
      onAssetsChange(data.assets);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const transcribe = async (file: string) => {
    setTranscribing(file);
    setTranscribeError((s) => ({ ...s, [file]: "" }));
    try {
      const data = await api<{ text: string }>(`/api/projects/${encodeURIComponent(projectName)}/transcribe`, {
        method: "POST",
        body: JSON.stringify({ asset: file }),
      });
      setTranscribeText((s) => ({ ...s, [file]: data.text }));
    } catch (e) {
      setTranscribeError((s) => ({ ...s, [file]: (e as Error).message }));
    } finally {
      setTranscribing(null);
    }
  };

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <div
        className={"upload-zone" + (dragOver ? " drag-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <p>拖拽文件到此处，或</p>
        <label className="btn">
          选择文件
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }}
          />
        </label>
        {uploading && <p className="sub">上传中…</p>}
        {rejected.length > 0 && <p className="sub" style={{ color: "var(--err)" }}>已拒绝（类型不支持）：{rejected.join("、")}</p>}
      </div>
      {assets.length === 0 ? (
        <p className="sub">还没有上传素材。</p>
      ) : (
        <table className="list" style={{ marginTop: 14 }}>
          <thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>转写</th><th></th></tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.file}>
                <td style={{ fontFamily: "monospace" }}>{a.file}</td>
                <td>{ASSET_KIND_LABEL[a.type.split("/")[0]] ?? a.type}</td>
                <td>{(a.size / 1024).toFixed(0)} KB</td>
                <td>
                  {isTranscribable(a) ? (
                    <>
                      <button className="btn" disabled={transcribing === a.file} onClick={() => void transcribe(a.file)}>
                        {transcribing === a.file ? "转写中…" : "转写"}
                      </button>
                      {transcribeError[a.file] && <div className="error-box" style={{ marginTop: 6 }}>{transcribeError[a.file]}</div>}
                      {transcribeText[a.file] !== undefined && (
                        <textarea
                          readOnly
                          className="transcript-box"
                          value={transcribeText[a.file]}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      )}
                    </>
                  ) : (
                    <span className="sub">—</span>
                  )}
                </td>
                <td><button className="btn" onClick={() => void remove(a.file)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 变量表单，向导第③步与项目详情共用。 */
function VariablesPanel({
  projectName,
  template,
  assets,
  values,
  onValuesChange,
  onSaved,
}: {
  projectName: string;
  template: TemplateInfo;
  assets: AssetInfo[];
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  onSaved?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [badKey, setBadKey] = useState<string | null>(null);
  const [badLabel, setBadLabel] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    setBadKey(null);
    try {
      const data = await api<{ variables?: Record<string, string> }>(
        `/api/projects/${encodeURIComponent(projectName)}/variables`,
        { method: "PUT", body: JSON.stringify({ values }) },
      );
      onValuesChange(data.variables ?? values);
      onSaved?.();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      const match = template.variables.find((v) => message.includes(v.label));
      if (match) { setBadKey(match.key); setBadLabel(match.label); }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {error && <div className="error-box">{error}{badKey ? `（字段：${badLabel}）` : ""}</div>}
      {template.variables.map((v) => (
        <div className="field" key={v.key}>
          <label style={badKey === v.key ? { color: "var(--err)" } : undefined}>{v.label}</label>
          {v.kind === "asset" ? (
            <select
              value={values[v.key] ?? ""}
              onChange={(e) => onValuesChange({ ...values, [v.key]: e.target.value })}
              style={badKey === v.key ? { borderColor: "var(--err)" } : undefined}
            >
              <option value="">（选择已上传素材）</option>
              {assets.map((a) => (<option key={a.file} value={a.file}>{a.file}</option>))}
            </select>
          ) : (
            <input
              type={v.kind === "number" ? "number" : "text"}
              value={values[v.key] ?? ""}
              onChange={(e) => onValuesChange({ ...values, [v.key]: e.target.value })}
              style={badKey === v.key ? { borderColor: "var(--err)" } : undefined}
            />
          )}
        </div>
      ))}
      <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>保存修改</button>
    </div>
  );
}

export default function Create() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("list");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [error, setError] = useState("");

  // 向导状态
  const [step, setStep] = useState(1);
  const [wizardTitle, setWizardTitle] = useState("");
  const [wizardTemplateId, setWizardTemplateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [current, setCurrent] = useState<ProjectDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      setError("");
      const data = await api<{ projects: ProjectSummary[] }>("/api/projects");
      setProjects(data.projects);
    } catch (e) { setError((e as Error).message); }
  }, []);
  const loadTemplates = useCallback(async () => {
    try {
      const data = await api<{ templates: TemplateInfo[] }>("/api/templates");
      setTemplates(data.templates);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void loadProjects(); void loadTemplates(); }, [loadProjects, loadTemplates]);

  const templateById = useMemo(() => {
    const map = new Map<string, TemplateInfo>();
    (templates ?? []).forEach((t) => map.set(t.id, t));
    return map;
  }, [templates]);

  const startWizard = () => {
    setStep(1);
    setWizardTitle("");
    setWizardTemplateId(null);
    setCurrent(null);
    setValues({});
    setError("");
    setView("wizard");
  };

  const createProject = async () => {
    if (!wizardTemplateId || !wizardTitle.trim()) return;
    setCreating(true);
    setError("");
    try {
      const created = await api<{ name: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ template: wizardTemplateId, title: wizardTitle.trim() }),
      });
      const detail = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(created.name)}`);
      setCurrent(detail);
      setValues(detail.variables ?? {});
      setStep(2);
    } catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  };

  const openProject = async (name: string) => {
    setError("");
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(name)}`);
      setCurrent(detail);
      setValues(detail.variables ?? {});
      setView("detail");
    } catch (e) { setError((e as Error).message); }
  };

  const refreshCurrent = async () => {
    if (!current) return;
    const detail = await api<ProjectDetail>(`/api/projects/${encodeURIComponent(current.name)}`);
    setCurrent(detail);
  };

  const startBuild = async () => {
    if (!current) return;
    setBuilding(true);
    setError("");
    try {
      const data = await api<{ buildId: string }>(`/api/projects/${encodeURIComponent(current.name)}/build`, {
        method: "POST",
      });
      sessionStorage.setItem("workbench.selectedBuild", JSON.stringify({ buildId: data.buildId, project: current.name }));
      navigate("/builds");
    } catch (e) { setError((e as Error).message); }
    finally { setBuilding(false); }
  };

  const goToBuild = (buildId: string) => {
    if (!current) return;
    sessionStorage.setItem("workbench.selectedBuild", JSON.stringify({ buildId, project: current.name }));
    navigate("/builds");
  };

  if (view === "list") {
    return (
      <>
        <div className="row">
          <div>
            <h1>创作</h1>
            <p className="sub">从模板新建视频项目，或打开已有项目继续制作</p>
          </div>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={startWizard}>新建视频</button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="grid">
          {projects?.map((p) => (
            <div className="card" key={p.name}>
              <div className="row">
                <h3>{p.title}</h3>
              </div>
              <p className="desc">模板：{templateById.get(p.template)?.title ?? p.template}</p>
              <p className="desc">Build 数：{p.builds.length}</p>
              <button className="btn" onClick={() => void openProject(p.name)}>打开</button>
            </div>
          ))}
        </div>
        {projects && projects.length === 0 && <p className="sub">还没有项目，点击「新建视频」开始。</p>}
      </>
    );
  }

  if (view === "wizard") {
    const template = wizardTemplateId ? templateById.get(wizardTemplateId) ?? null : null;
    return (
      <>
        <div className="row">
          <div>
            <h1>新建视频</h1>
            <p className="sub">三步完成：选模板 → 放素材 → 改内容并出片</p>
          </div>
          <span className="spacer" />
          <button className="btn" onClick={() => setView("list")}>返回列表</button>
        </div>
        <div className="step-bar">
          {["选模板", "放素材", "改内容并出片"].map((label, i) => (
            <div key={label} className={"step" + (step === i + 1 ? " active" : step > i + 1 ? " done" : "")}>
              <span className="step-num">{i + 1}</span>{label}
            </div>
          ))}
        </div>
        {error && <div className="error-box">{error}</div>}

        {step === 1 && (
          <>
            <div className="field" style={{ maxWidth: 360 }}>
              <label>项目标题</label>
              <input value={wizardTitle} onChange={(e) => setWizardTitle(e.target.value)} placeholder="给这个视频起个名字" />
            </div>
            <div className="grid">
              {templates?.map((t) => {
                const disabled = !t.availability.ok;
                return (
                  <div
                    key={t.id}
                    className={"card template-card" + (wizardTemplateId === t.id ? " selected" : "") + (disabled ? " disabled" : "")}
                    onClick={() => { if (!disabled) setWizardTemplateId(t.id); }}
                  >
                    <h3>{t.title}</h3>
                    <p className="desc">{t.description}</p>
                    <div className="row">
                      {t.requires.map((r) => (<span key={r.capability} className="badge">{r.label}</span>))}
                    </div>
                    {disabled && (
                      <p className="desc" style={{ color: "var(--err)", marginTop: 8 }}>
                        需先配置：{t.availability.missing.join("、")}（前往<a href="/models">模型与服务</a>）
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 20 }}>
              <span className="spacer" />
              <button
                className="btn btn-primary"
                disabled={!wizardTemplateId || !wizardTitle.trim() || creating}
                onClick={() => void createProject()}
              >
                下一步
              </button>
            </div>
          </>
        )}

        {step === 2 && current && (
          <>
            <AssetsPanel projectName={current.name} assets={current.assets} onAssetsChange={(assets) => setCurrent({ ...current, assets })} />
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn" onClick={() => setStep(1)}>上一步</button>
              <span className="spacer" />
              <button className="btn btn-primary" onClick={() => setStep(3)}>下一步</button>
            </div>
          </>
        )}

        {step === 3 && current && template && (
          <>
            <VariablesPanel
              projectName={current.name}
              template={template}
              assets={current.assets}
              values={values}
              onValuesChange={setValues}
              onSaved={() => void refreshCurrent()}
            />
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn" onClick={() => setStep(2)}>上一步</button>
              <span className="spacer" />
              <button className="btn btn-primary" disabled={building} onClick={() => void startBuild()}>
                {building ? "提交中…" : "开始生成"}
              </button>
            </div>
          </>
        )}
      </>
    );
  }

  // view === "detail"
  if (current) {
    const template = templateById.get(current.template);
    return (
      <>
        <div className="row">
          <div>
            <h1>{current.title}</h1>
            <p className="sub">模板：{template?.title ?? current.template}</p>
          </div>
          <span className="spacer" />
          <button className="btn" onClick={() => { setView("list"); void loadProjects(); }}>返回列表</button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>素材</h3>
          <AssetsPanel projectName={current.name} assets={current.assets} onAssetsChange={(assets) => setCurrent({ ...current, assets })} />
        </div>
        {template && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>内容变量</h3>
            <VariablesPanel
              projectName={current.name}
              template={template}
              assets={current.assets}
              values={values}
              onValuesChange={setValues}
              onSaved={() => void refreshCurrent()}
            />
          </div>
        )}
        <div className="card">
          <div className="row">
            <h3>Build 历史</h3>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => void startBuild()}>开始生成</button>
          </div>
          {current.builds.length === 0 ? (
            <p className="sub">还没有提交过 Build。</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {current.builds.map((id) => (
                <li key={id}>
                  <a href="#" onClick={(e) => { e.preventDefault(); goToBuild(id); }} style={{ fontFamily: "monospace" }}>{id}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  return null;
}
