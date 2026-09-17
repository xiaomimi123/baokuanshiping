#!/bin/bash
set -euo pipefail
base=http://127.0.0.1:8090
for path in /api/health /api/runtime/status /api/doctor /api/builds /api/profile /api/studio; do
  echo "== GET $path"
  curl -fsS "$base$path" | head -c 300; echo
done

echo "== assert /api/runtime/status ready:true"
status_json="$(curl -fsS "$base/api/runtime/status")"
if ! echo "$status_json" | grep -q '"ready":true'; then
  echo "FAIL: /api/runtime/status did not report ready:true" >&2
  echo "$status_json" >&2
  exit 1
fi

echo "== runtime container: hypit doctor --json (直连 Provider 未配 Key 时，除 RUNTIME_CREDENTIAL_MISSING 外不应有其他 error)"
# hypit doctor 在有 error 诊断时会以退出码 1 结束（即使只是预期内的 credential missing），
# 这里只关心诊断内容本身，用 `|| true` 避免 set -e 在拿到 JSON 之前就中断脚本。
doctor_json="$(docker compose exec -T --workdir /projects/default runtime node /opt/hypit/bin/hypit.mjs doctor --json || true)"
echo "$doctor_json" | node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const doc = JSON.parse(data);
  const diagnostics = Array.isArray(doc.diagnostics) ? doc.diagnostics : [];
  const unexpected = diagnostics.filter((d) => d.severity === "error" && d.code !== "RUNTIME_CREDENTIAL_MISSING");
  if (unexpected.length > 0) {
    console.error("FAIL: unexpected doctor errors:", JSON.stringify(unexpected, null, 2));
    process.exit(1);
  }
  console.log(`doctor OK: diagnosticCount=${doc.diagnosticCount}, no unexpected errors (RUNTIME_CREDENTIAL_MISSING allowed)`);
});
'

echo "SMOKE OK"
