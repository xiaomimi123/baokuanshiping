# 创作工作台设计（第一期：素材 → 模板 → 出片）

日期：2026-09-18
状态：用户已批准方向（聊天中确认三步向导 + 分期方案）

## 1. 目标

工作台新增「创作」页：用户不写代码即可——从上游示例模板起一个视频项目、上传/替换素材、改文案变量、一键 `hypit build` 出片、在任务详情页内联预览并下载成片。全链确定性，不调用 AI。

第二期（本 spec 不含实现，仅预留形态）：无头调用本机 Claude Code CLI 做"上传参考视频 → Agent 写 SVML"的全自动复刻；CLI 不存在时入口隐藏。

## 2. 非目标（YAGNI）

- 不做 SVML 可视化编辑器（编辑仍去官方 Studio）；变量编辑仅限模板声明的浅层文本/数字替换。
- 不做多用户/配额/上传断点续传。
- 不自造模板格式——模板 = 上游 `examples/` 的白名单子集原样复制。
- 第二期 Agent 集成不在本期实现。

## 3. 核心概念与数据布局

- **项目** = `projects/<name>/` 目录（与现有 `projects/default` 并列；default 仍是 Runtime Profile 宿主，不在创作页显示）。每个项目：模板拷贝内容 + `assets/uploads/` 用户素材 + `.workbench.json` 元数据。
- **`.workbench.json`**（工作台自有元数据，上游不感知）：
  ```json
  { "format": "workbench.project@1", "template": "podcast", "title": "我的播客视频",
    "createdAt": "…", "runSource": "reference.svrun",
    "builds": ["<buildId>", "…"] }
  ```
- **模板注册表**（`server/src/templates.ts` 内静态白名单，实现期逐个验证后定稿）：候选 `semantic-composition`（chat，预计免模型）、`podcast`、`ranking-football`、`interview`、`complex-explainer`。每条：id、中文名、简介、runSource 路径、可编辑变量描述（见 §5）、是否需要模型服务（capability 列表）、封面（复用上游 assets 内图片或占位色块）。**实现期用 `hypit check <runSource>` 验证每个候选并按结果裁剪白名单**；因缺素材/需付费模型而无法开箱 build 的模板标注"需先配置 X"而非剔除。
- **Runtime 共享**：新项目不复制 examples 自带的 hypit.runtime.json（它们引用 workspace 凭据），改为写入指向共享配置的方案——项目内生成与 `projects/default/hypit.runtime.json` 相同内容的 Profile（读 default 的现行文件复制），并 `hypit runtime use`。这样直连 Provider/凭据全局一份。**实现期若发现 `--workspace`/`--runtime` 指定 default 的 Profile 更干净（无需复制），允许改为该方案并记录。**

## 4. 后端 API（继续薄封装；错误统一 envelope）

- `GET /api/templates` → 模板注册表（含每个模板"当前是否可用"的 doctor 快查结果，缓存 60s）
- `GET /api/projects` → 扫描 `projects/*/.workbench.json` 列表（default 除外；无元数据的目录忽略）
- `POST /api/projects` body `{ template, title }` → 生成目录名（拼音/slug + 短随机）、复制模板（排除其 node_modules/.hypit）、写 `.workbench.json`、准备 Profile（§3）→ 返回项目详情
- `GET /api/projects/:name` → 元数据 + 变量当前值 + 素材清单（assets/uploads/ 下文件名/大小/类型）
- `POST /api/projects/:name/assets`（multipart，≤500MB/文件，仅 video/audio/image 常见类型）→ 存 `assets/uploads/`，文件名 slug 化防穿越；同名覆盖
- `DELETE /api/projects/:name/assets/:file`
- `PUT /api/projects/:name/variables` body `{ values }` → 按模板变量描述写回 .svml（§5 机制），非法值 400
- `POST /api/projects/:name/transcribe` body `{ asset }` → `hypit transcribe`（CLI 用法实现期核对），返回字幕文本；转写 endpoint 未配置时 409 + 引导文案
- `POST /api/projects/:name/build` → `hypit build <runSource> --json`（cwd=项目目录），把 build id 追加进 `.workbench.json.builds`，返回 `{ buildId }`
- 路径安全：`:name`/`:file` 一律 slug 白名单校验（`[a-z0-9-_.]`，拒绝 `.`/`..`），解析后必须落在 projects 根内。

## 5. 变量编辑机制（关键取舍）

不解析 SVML 语法树。模板注册表为每个模板声明**锚点替换规则**：`{ key, label, kind: "text"|"number"|"asset", file, anchor }`，`anchor` 是该 .svml/.svs 文件中一段**唯一出现的原文片段**（初始值），替换 = 精确子串替换并把新值记入 `.workbench.json.variables`（下次替换用上次值作锚点）。`kind:"asset"` 的值为 `assets/uploads/<file>` 相对路径，写入原素材引用位置。锚点在文件中不唯一或找不到 → 400 报具体变量名。实现期为每个入选模板手工挑 3-8 个高价值变量（标题/榜单条目/台词/主素材），宁少勿错。

## 6. 前端（新增「创作」导航，路由 /create）

- **项目列表**：卡片（标题、模板名、最近 Build 状态徽标、打开按钮）+「新建视频」入口。
- **新建向导**（单页三步，步骤条）：
  1. 选模板：卡片网格（中文名/简介/所需服务徽标；不可用的显示"需先配置 X"并链接到模型页）
  2. 放素材：拖拽/点击上传（进度条）、已传列表（删除）、参考视频行内「转写」按钮（结果展示为可复制文本）
  3. 改内容并出片：变量表单（按模板描述渲染 text/number/asset 选择器）+「开始生成」→ POST build → 跳转任务页并自动选中该 build
- **项目详情**（列表卡片点开）：同向导 ②③ 的合体 + 该项目 Build 历史。
- **任务详情增强**（Builds.tsx）：result complete 时拉产物清单并内联渲染——视频 `<video controls>`、图片 `<img>`、其余下载链接；数据源 `hypit inspect <id> --json`（输出结构实现期核对）+ 现有 outputs 下载接口。
- 视觉沿用现有设计系统；中文界面。

## 7. Docker 与本机

- 上传/项目均落在 bind mount 的 `projects/`，容器与宿主机通用；无需新卷。
- 模板源：容器内 `/opt/hypit/examples`，宿主机 `$HYPIT_REPO/examples`——统一经 `cfg.hypitRepo` 解析，无新配置。
- Fastify 需注册 multipart 插件（`@fastify/multipart`），body 大小上限 512MB 仅对上传路由生效。

## 8. 错误处理与测试

- 所有新路由复用 `{ error: { code, message } }`；Runtime 未就绪时 build 返回 502 并提示先在总览页启动。
- 单测：路径安全（穿越拒绝）、锚点替换（唯一/不唯一/连续两次替换）、.workbench.json 读写、模板复制排除项。
- 集成验收：从 chat 模板建项目 → 改一个变量 → build → 产物出现在任务页（免模型模板，实机跑通）；Docker smoke 增加 GET /api/templates 断言。

## 9. 风险

| 风险 | 对策 |
| --- | --- |
| 候选模板实际依赖付费模型/缺素材无法开箱 build | 白名单以 `hypit check` 实测定稿；至少保 1 个免模型模板（chat）走通端到端 |
| 锚点替换脆弱 | 变量宁少勿错；替换失败给具体变量名与修复指引；原文件在项目内可随时用 Studio 改 |
| examples 目录随上游升级变动 | 模板复制发生在建项目时刻，已建项目不受上游变动影响 |
