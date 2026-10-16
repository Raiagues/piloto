/** Live intent interpretation over an entirely synthetic model. No project documents or database are read. */
import assert from "node:assert/strict";
import { normalizeQuantity } from "../shared/impact-engine.mjs";
import { createSystemAiService } from "../server/system-ai.mjs";
import { createEngineeringValidationModel } from "../examples/engineering-validation.mjs";
const model = createEngineeringValidationModel();
const service = createSystemAiService({ onAttempt: (record, detail) => console.log(JSON.stringify({ model: record.model, status: record.status, httpStatus: record.httpStatus, providerStatus: detail.response?.error?.status, elapsedMs: record.elapsedMs })) });
const cameraModel = structuredClone(model);
const camera = cameraModel.entities.find((item) => item.id === "payload");
camera.name = "Imaging payload";
camera.description = "Camera for mission imaging";
camera.properties = [];
const cases = [
  { text: "mudar peso da camera para 1kg", model: cameraModel, language: "en", target: "payload", value: 1, unit: "kg" },

  { text: "E se a massa do Payload instrument dobrasse?", target: "payload", value: 240, unit: "g" },
  { text: "O Radio R1 vai precisar de mais 0,2 A de corrente de pico.", target: "radio", value: 600, unit: "mA" },
  { text: "Talvez pudéssemos melhorar o projeto." }
];
for (const item of cases) {
  const result = await service.interpret(item.model ?? model, item.text, item.language ?? "pt");
  if (item.target) {
    assert.equal(result.status, "resolved", JSON.stringify(result));
    assert.equal(result.change.targetEntityId, item.target);
    assert.equal(normalizeQuantity(result.change.newValues[0].value, result.change.newValues[0].unit)?.value, normalizeQuantity(item.value, item.unit)?.value);
  } else {
    assert.equal(result.status, "clarification", JSON.stringify(result));
    assert.ok(result.question.length > 0);
  }
  console.log(JSON.stringify({ text: item.text, result }));
}
console.log("PASS: live AI interpretation, synthetic model only; no extraction or production writes.");
