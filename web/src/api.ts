export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try { message = (await res.json()).error?.message ?? message; } catch { /* keep */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type RuntimeStatus = {
  ready: boolean; attention: boolean;
  worker: { state: string };
  builds: { submitting: number; working: number; savingResult: number };
  programs: { total: number; ready: number; unavailable: { id: string; state: string; detail?: string }[] };
  capacity: { active: number };
};
export type Doctor = {
  ok: boolean;
  diagnostics: { severity: "error" | "warning" | "info"; code: string; message: string; subject?: string }[];
};
export type BuildsList = {
  builds: { id: string; createdAt: string; title?: string; outcome: string; run?: string; outputCount: number }[];
  next?: string;
};
export type BuildStatus = {
  build: {
    id: string; title?: string;
    failure?: string;
    work: { state: string; outcome?: string; requests?: { total: number; completed: number } };
    result: { state: string; outputCount?: number };
    attention?: { message: string; action?: string };
    operations?: { endpoint: string; state: string; count?: number; progress?: { phase: string; completed?: number; total?: number } ; failure?: { code: string; message: string } }[];
  } | null;
};
export type AuthStatus = {
  endpoint: string;
  credentials: { slot: string; label: string; kind: string; configured: boolean; writable: boolean }[];
};
export type ProfileEnvelope = { path: string; profile: RuntimeProfile };
export type RuntimeProfile = {
  format: string; dataRoot: string;
  worker?: { executionMemoryMb?: number };
  credentials?: Record<string, { use: string; config?: Record<string, unknown> }>;
  endpoints?: Record<string, { use: string; pool?: string; config?: Record<string, unknown> }>;
  bindings?: Record<string, string>;
};
