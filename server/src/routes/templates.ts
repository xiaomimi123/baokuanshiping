import type { FastifyInstance } from "fastify";
import { TEMPLATES, templateAvailability } from "../templates.js";

export async function templatesRoutes(app: FastifyInstance) {
  app.get("/api/templates", async () => {
    const availability = await templateAvailability();
    return {
      templates: TEMPLATES.map(({ variables, ...rest }) => ({
        ...rest,
        // anchor 字段不下发前端，避免泄露实现细节，仅下发 key/label/kind
        variables: variables.map(({ key, label, kind }) => ({ key, label, kind })),
        availability: availability[rest.id] ?? { ok: false, missing: [] },
      })),
    };
  });
}
