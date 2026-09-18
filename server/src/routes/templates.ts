import type { FastifyInstance } from "fastify";
import { TEMPLATES, templateAvailability } from "../templates.js";

export async function templatesRoutes(app: FastifyInstance) {
  app.get("/api/templates", async () => {
    const availability = await templateAvailability();
    return {
      templates: TEMPLATES.map(({ variables, ...rest }) => ({
        ...rest,
        // anchor 字段不下发前端，避免泄露实现细节，仅下发 key/label/kind（+ text/number 类的 initial）。
        // asset 类不下发 initial：锚点是一个相对路径字符串，不是"素材原文"，下发出去只会误导表单
        // 把它当默认值回显（用户看到的应该是"未选择"，不是模板自带样例素材的路径）。
        variables: variables.map(({ key, label, kind, anchor }) => ({
          key,
          label,
          kind,
          ...(kind === "asset" ? {} : { initial: anchor }),
        })),
        availability: availability[rest.id] ?? { ok: false, missing: [] },
      })),
    };
  });
}
