#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ZYNTHEOR_URL:-http://127.0.0.1:3000}"
STATUS_URL="${BASE_URL}/api/system/status"

echo "[verify-model-switch] Querying ${STATUS_URL} ..."
RESPONSE="$(curl -sS -f "${STATUS_URL}")"

printf '%s' "${RESPONSE}" | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
const data = JSON.parse(raw);

const checks = [
  ["success === true", data.success === true],
  ["model.activeKey === v2_2m", data.model?.activeKey === "v2_2m"],
  ["model.name === NativeLM v2 (2.0M)", data.model?.name === "NativeLM v2 (2.0M)"],
  ["model.weightsSource === native_data/model_checkpoint_v2.pt", data.model?.weightsSource === "native_data/model_checkpoint_v2.pt"],
  ["model.totalParams === 502912", data.model?.totalParams === 502912],
  ["model.evaluatedLoss === 1.5561", Number(data.model?.evaluatedLoss) === 1.5561],
  ["model.evaluatedPerplexity === 4.7404", Number(data.model?.evaluatedPerplexity) === 4.7404],
  ["audit.chainValid === true", data.audit?.chainValid === true],
];

const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({
  verified: failed.length === 0,
  checks: checks.map(([name, ok]) => ({ check: name, passed: ok })),
  model: data.model,
  audit: data.audit
}, null, 2));

if (failed.length > 0) {
  console.error("Verification failed:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
'
