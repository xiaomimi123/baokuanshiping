import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { profilePath } from "./routes/profile.js";

export type TemplateDef = {
  id: string;
  title: string;
  description: string;
  sourceDir: string; // 相对 $HYPIT_REPO/examples
  runSource: string; // 相对项目根
  requires: { capability: string; label: string }[]; // 空数组 = 免模型
  variables: VariableDef[]; // Task 3 消费；本任务先给出每模板 3-8 条（锚点从源文件实取）
  cover?: string; // 相对 sourceDir 的图片路径，可无
};

export type VariableDef = { key: string; label: string; kind: "text" | "number" | "asset"; file: string; anchor: string };

// 需要模型服务的 capability 家族（bindings key 形如 "<capability>#<model>"）。
// 中文 label 供前端"需先配置 X"提示使用。
const SEEDANCE = { capability: "@hypit/seedance@1", label: "视频生成（Seedance）" };
const GPT_IMAGE = { capability: "@hypit/gpt-image@1", label: "图片生成（GPT-Image）" };
const WHISPERX = { capability: "@hypit/whisperx@1", label: "语音转写对齐（WhisperX）" };
const FISHAUDIO = { capability: "@hypit/fishaudio-speech@1", label: "语音合成（FishAudio）" };

export const TEMPLATES: TemplateDef[] = [
  {
    id: "semantic-composition",
    title: "对话动画（免模型）",
    description: "八秒纯项目组件绘制的聊天对话动画，不调用任何生成模型，本机直接可跑。",
    sourceDir: "semantic-composition",
    runSource: "chat.svrun",
    requires: [],
    variables: [
      { key: "title", label: "对话标题", kind: "text", file: "chat.svml", anchor: "Launch crew" },
      { key: "message1", label: "第一条消息（Maya）", kind: "text", file: "chat.svml", anchor: "Are we ready to launch?" },
      { key: "message2", label: "第二条消息（Leo）", kind: "text", file: "chat.svml", anchor: "The video is ready." },
      { key: "message3", label: "第三条消息（Maya）", kind: "text", file: "chat.svml", anchor: "Great. One tiny change..." },
      { key: "message4", label: "第四条消息（Leo）", kind: "text", file: "chat.svml", anchor: "I left the whole scene editable." },
    ],
  },
  {
    id: "podcast",
    title: "双人播客",
    description: "两位主播的竖屏播客片段，含 AI 配音、生图与生成式插入镜头，需要配置图片/视频/语音模型。",
    sourceDir: "podcast",
    runSource: "reference.svrun",
    requires: [SEEDANCE, GPT_IMAGE, WHISPERX, FISHAUDIO],
    variables: [
      {
        key: "openingLine",
        label: "开场台词（GUY）",
        kind: "text",
        file: "reference.svml",
        anchor: "OK Sarah || so what is || the one single thing || that you literally || can't live without?",
      },
      {
        key: "creatineLine",
        label: "主话题台词（GIRL）",
        kind: "text",
        file: "reference.svml",
        anchor:
          "Creatine. Five grams || a day, every day. @{~lifestyle} || I put it || in my coffee, || my smoothie, || and even my || pasta water.",
      },
      {
        key: "creatineReply",
        label: "吐槽回应（GUY）",
        kind: "text",
        file: "reference.svml",
        anchor: "God I think || you're treating this @{/lifestyle} || as flour.",
      },
      {
        key: "productLabel",
        label: "产品图文案",
        kind: "text",
        file: "reference.svml",
        anchor: "The main English label reads CREATINE",
      },
      {
        key: "soundtrack",
        label: "背景音乐素材",
        kind: "asset",
        file: "reference.svml",
        anchor: "./assets/shared-soundtrack.m4a",
      },
    ],
  },
  {
    id: "ranking-football",
    title: "球星梗榜单",
    description: "主播对足球明星做吐槽式排位的竖屏短视频，需要配置图片/视频/语音模型。",
    sourceDir: "ranking-football",
    runSource: "reference.svrun",
    requires: [SEEDANCE, GPT_IMAGE, WHISPERX, FISHAUDIO],
    cover: "assets/ronaldo.jpeg",
    variables: [
      {
        key: "presenterVoiceSample",
        label: "主播开场白",
        kind: "text",
        file: "reference.svml",
        anchor: "Welcome back. Today we're ranking the most ridiculous football takes.",
      },
      {
        key: "ronaldoEntry",
        label: "榜单条目：Ronaldo",
        kind: "text",
        file: "reference.svml",
        anchor:
          "Ronaldo is <D | Dee> tier. || Bro has @{hair-gel} more || hair gel than @{trophy} trophies || at this point.@{/trophy}@{/hair-gel} || Built like || @{greek-god} a Greek god, || plays like || @{greek-tragedy} a Greek tragedy.@{/greek-tragedy}@{/greek-god} || But hey, || at least @{penaldo-social} he's got || the most followers || on Instagram.@{/penaldo-social}",
      },
      {
        key: "messiEntry",
        label: "榜单条目：Messi",
        kind: "text",
        file: "reference.svml",
        anchor:
          "Messi? Man won || a World Cup || @{tired-dad} looking like || somebody's tired dad.@{/tired-dad} || Walks around || @{walks-around} for 89 minutes, || touches the ball || three times, || and somehow || @{hat-trick} you just watched || a hat trick.@{/hat-trick}@{/walks-around} || Definitely <S | Ess> tier.",
      },
      {
        key: "ronaldoIcon",
        label: "Ronaldo 头像素材",
        kind: "asset",
        file: "reference.svml",
        anchor: "./assets/ronaldo.jpeg",
      },
      {
        key: "soundtrack",
        label: "背景音乐素材",
        kind: "asset",
        file: "reference.svml",
        anchor: "./assets/shared-soundtrack.m4a",
      },
    ],
  },
  {
    id: "interview",
    title: "街头采访",
    description: "路人街头采访梗视频，问答式台词配合生成式镜头，需要配置图片/视频/语音模型。",
    sourceDir: "interview",
    runSource: "reference.svrun",
    requires: [SEEDANCE, GPT_IMAGE, WHISPERX, FISHAUDIO],
    variables: [
      {
        key: "openingQuestion",
        label: "开场提问（BOY）",
        kind: "text",
        file: "reference.svml",
        anchor: "Hey yo! || Is this || Lamborghini || yours?",
      },
      {
        key: "manifestLine",
        label: "第一条法则（WIFE）",
        kind: "text",
        file: "reference.svml",
        anchor: "OK || the || first one || is || @{manifest!} Manifest.",
      },
      {
        key: "realEstateLine",
        label: "第二条法则（WIFE）",
        kind: "text",
        file: "reference.svml",
        anchor: "@{real-estate!} Real estate. || Buy || the || building, || and || charge || everyone || rent.",
      },
      {
        key: "bitcoinLine",
        label: "第三条法则（WIFE）",
        kind: "text",
        file: "reference.svml",
        anchor: "@{bitcoin!} Bitcoin. || I || pressed || the || wrong || button || in <2012 | twenty twelve> || and || made || six figures.",
      },
      {
        key: "soundtrack",
        label: "背景音乐素材",
        kind: "asset",
        file: "reference.svml",
        anchor: "./assets/shared-soundtrack.m4a",
      },
    ],
  },
];

type Availability = Record<string, { ok: boolean; missing: string[] }>;

let cache: { at: number; value: Availability } | null = null;
const CACHE_TTL_MS = 60_000;

/** 纯读当前 Profile 的 endpoints+bindings；解析失败或文件不存在按"无 Profile"处理，全部返回空。 */
async function readProfileBindings(): Promise<{ endpointIds: Set<string>; bindings: Record<string, string> }> {
  const path = await profilePath();
  let bindings: Record<string, string> = {};
  let endpointIds = new Set<string>();
  if (existsSync(path)) {
    try {
      const profile = JSON.parse(await readFile(path, "utf8")) as {
        endpoints?: Record<string, unknown>;
        bindings?: Record<string, string>;
      };
      endpointIds = new Set(Object.keys(profile.endpoints ?? {}));
      bindings = profile.bindings ?? {};
    } catch {
      // 解析失败按"无 Profile"处理，全部模型 capability 视为未配置
    }
  }
  return { endpointIds, bindings };
}

// capability（如 "@hypit/seedance@1"）已配置 = 存在一条 bindings["<capability>#<model>"]，
// 且其目标 endpoint 确实存在于 Profile 的 endpoints 中。
function isCapabilityConfigured(capability: string, endpointIds: Set<string>, bindings: Record<string, string>): boolean {
  return Object.entries(bindings).some(([key, endpoint]) => key.startsWith(`${capability}#`) && endpointIds.has(endpoint));
}

/** 纯读当前 Profile 的 endpoints+bindings 判断每个模板 requires 是否已配置；不跑 doctor。60s 内存缓存。 */
export async function templateAvailability(): Promise<Availability> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  const { endpointIds, bindings } = await readProfileBindings();

  const value: Availability = {};
  for (const template of TEMPLATES) {
    const missing = template.requires
      .filter((r) => !isCapabilityConfigured(r.capability, endpointIds, bindings))
      .map((r) => r.label);
    value[template.id] = { ok: missing.length === 0, missing };
  }

  cache = { at: now, value };
  return value;
}

/**
 * 转写（WhisperX 对齐）能力是否有可用 endpoint。与 templateAvailability 同源判断逻辑（纯读 Profile，
 * 不跑 doctor），但不缓存——转写是显式低频调用，不像模板列表那样高频轮询。
 */
export async function isTranscribeAvailable(): Promise<boolean> {
  const { endpointIds, bindings } = await readProfileBindings();
  return isCapabilityConfigured(WHISPERX.capability, endpointIds, bindings);
}
