import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtractionProgressPanel } from "../src/components/ExtractionProgressPanel";
import type { ExtractionTask } from "../src/lib/useExtractionTasks";
import { PROJECT_RAIL, railNeighbour } from "../src/lib/projectRail";

const task: ExtractionTask = { projectId: "p", projectName: "Quetzal-1", regenerate: false, job: { jobId: "job", status: "running", progress: { totalDocuments: 17, processedDocuments: 11, totalChunks: 116, completedChunks: 72, cachedChunks: 12, failedChunks: 0, coverage: 72 / 116 }, report: { complete: false, omissionCount: 50, conflictCount: 2, documents: Array.from({ length: 17 }, (_, i) => ({ artifactId: `doc-${i}`, label: `Documento ${i + 1}`, complete: i < 11, totalChunks: 3, completedChunks: i < 11 ? 3 : 0, stage: i < 11 ? "completed" : i === 11 ? "reading" : "queued" })) } } };
const render = (overrides: Partial<Parameters<typeof ExtractionProgressPanel>[0]> = {}) => renderToStaticMarkup(createElement(ExtractionProgressPanel, { task, tasks: [task], language: "pt", expanded: true, onExpanded() {}, onSelect() {}, onReview() {}, onRetry() {}, onOpenProject() {}, ...overrides }));

describe("background extraction progress presentation", () => {
  it("shows every uploaded source, progress, reuse and summary-only review counts", () => {
    const html = render();
    expect((html.match(/<li /g) || []).length).toBe(17);
    expect(html).toContain("Documento 17"); expect(html).toContain("11 de 17 documentos lidos");
    expect(html).toContain("72 / 116 trechos"); expect(html).toContain("12");
    expect(html).toContain("50 itens sem comprovação · 2 divergências");
    expect(html).toContain("Na fila"); expect(html).toContain("Lendo"); expect(html).toContain("Lido");
    expect(html).not.toContain("conception-initialization"); expect(html).not.toContain("Continuar leitura");
  });
  it("keeps progress labels and caveats in the chosen language", () => {
    const html = render({ language: "en" });
    expect(html).toContain("Building the project map"); expect(html).toContain("50 unverified items");
    expect(html).toContain("Keep browsing"); expect(html).not.toContain("itens sem comprovação");
  });
  it("shows a deliberate restart for changed sources without claiming processing continues", () => {
    const stale: ExtractionTask = { ...task, restartRequired: true, error: "Os documentos foram alterados.", job: { ...task.job, status: "failed" } };
    const html = render({ task: stale });
    expect(html).toContain("Iniciar nova leitura"); expect(html).toContain("Os documentos foram alterados.");
    expect(html).not.toContain("A leitura segue em segundo plano"); expect(html).not.toContain("Retomar leitura");
  });
  it("keeps completed proposals unobtrusive until the user opens review", () => {
    const html = render({ task: { ...task, job: { ...task.job, status: "completed" } }, expanded: false });
    expect(html).toContain("Mapa pronto para revisão"); expect(html).toContain("Acompanhar geração do mapa");
    expect(html).not.toContain("dialog");
  });
  it("removes Software from the shared project navigation order", () => {
    expect(PROJECT_RAIL.some(item => item.key === "software")).toBe(false);
    expect(railNeighbour("requirements", 1)?.key).toBe("verification");
  });
});
