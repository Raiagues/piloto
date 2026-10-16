/** Why is conception blocked? Development-only inspection of Project Memory.
 *
 * Prints, per artifact, what Norte actually stored and whether that content
 * reaches the extraction model. This is a command, not a user dashboard: it is
 * the fastest way to see a `metadata_only` link masquerading as a source.
 *
 *   npm run diagnose:project-memory
 *   npm run diagnose:project-memory -- --project quetzal1-eps-comms --json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeStoredData, VALIDATION_PROJECT_ID } from "../server/data-store.mjs";
import { prepareProjectArtifacts, projectArtifacts, projectMemoryStatus } from "../server/system-ai.mjs";

const readable = (status) => ["parsed", "pdf"].includes(status);

export function diagnoseProjectMemory(value, projectId = VALIDATION_PROJECT_ID) {
  const data = normalizeStoredData(value);
  const record = data.workspace.projects?.[projectId];
  if (!record) throw new Error(`Project ${projectId} was not found. Available: ${Object.keys(data.workspace.projects).join(", ") || "none"}`);
  const project = record.document;
  const linked = projectArtifacts(project, data.artifacts);
  const parsed = prepareProjectArtifacts(project, data.artifacts);
  const readiness = projectMemoryStatus(project, data.artifacts);
  const byId = new Map(linked.map((artifact) => [artifact.id, artifact]));
  return {
    projectId,
    projectName: project.name,
    teamName: project.context?.teamName ?? "",
    referenceProgram: project.context?.programId ?? project.context?.referenceProgram ?? "none",
    memoryRevision: project.memoryRevision || 0,
    engineeringSystem: project.engineeringSystem ? `present (from revision ${project.systemGeneratedFromRevision ?? "?"})` : "absent",
    readiness,
    artifacts: parsed.map((item) => {
      const artifact = byId.get(item.source.artifactId);
      return {
        artifactId: item.source.artifactId,
        label: item.source.artifactLabel,
        source: artifact?.provenance?.sourceUrl || (String(artifact?.url || "").startsWith("data:") ? "stored file" : artifact?.url || ""),
        mimeType: artifact?.mimeType || "",
        size: artifact?.size || 0,
        status: item.source.status,
        reason: item.source.reason || "",
        textCharacters: item.text.length,
        inlinePdf: Boolean(item.inlineData),
        sentToModel: readable(item.source.status)
      };
    })
  };
}

function print(report) {
  console.log(`Project        ${report.projectName} (${report.projectId})`);
  console.log(`Team           ${report.teamName || "—"}`);
  console.log(`Reference      ${report.referenceProgram}`);
  console.log(`memoryRevision ${report.memoryRevision}`);
  console.log(`System         ${report.engineeringSystem}\n`);
  for (const artifact of report.artifacts) {
    console.log(artifact.label);
    console.log(`  artifact  ${artifact.artifactId}`);
    console.log(`  source    ${artifact.source}`);
    console.log(`  mime      ${artifact.mimeType || "—"}   size=${artifact.size}`);
    console.log(`  parse     ${artifact.status}${artifact.reason ? ` — ${artifact.reason}` : ""}`);
    console.log(`  content   ${artifact.inlinePdf ? "inline PDF" : `${artifact.textCharacters} characters of text`}`);
    console.log(`  sent      ${artifact.sentToModel ? "yes" : "no"}\n`);
  }
  if (!report.artifacts.length) console.log("(no artifacts linked to this project's memory)\n");
  console.log(`Readable ${report.readiness.readableCount} of ${report.readiness.linkedCount} linked artifacts.`);
  console.log(report.readiness.ready
    ? "Memory is ready: Start conception will be accepted."
    : `Memory is NOT ready. Missing: ${report.readiness.missing.join(", ")}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const file = option("--file", "var/mission-dev-data.json");
  const report = diagnoseProjectMemory(JSON.parse(await readFile(resolve(file), "utf8")), option("--project", VALIDATION_PROJECT_ID));
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else print(report);
  if (!report.readiness.ready) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
