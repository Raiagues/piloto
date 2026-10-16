import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CurrentExtractionReport } from "../src/components/CurrentExtractionReport";
import type { ExtractionReport } from "../src/lib/extractionJobs";

describe("preserved current extraction report", () => {
  it("keeps every omission accessible with source names and review reasons after full coverage", () => {
    const report: ExtractionReport = {
      complete: true, needsReview: true, progress: { completedChunks: 116, totalChunks: 116 },
      documents: [{ artifactId: "source-doc", label: "Manual do componente", complete: true, totalChunks: 116, completedChunks: 116, limitations: ["Confira a conectividade no esquema original."] }],
      omissions: Array.from({ length: 27 }, (_, index) => ({ chunkId: "private-chunk-" + index, artifactId: "source-doc", kind: index ? "entity" : "evidence", id: "internal-omission-" + index, ...(index ? { name: "Componente " + index } : {}), reason: "Citação não confirmada na fonte." })),
      conflicts: [{ entityId: "internal-object", key: "internal-property-key", kept: { name: "Tensão de operação", value: 3.3, unit: "V" }, candidate: { name: "Tensão de operação", value: "5 V", unit: "V" }, reason: "Confira a condição de operação." }]
    };
    const html = renderToStaticMarkup(createElement(CurrentExtractionReport, { report, language: "pt" }));
    expect(html.match(/class="extraction-omission"/gu)).toHaveLength(27);
    expect(html).toContain("Pendências de revisão (27)");
    expect(html).toContain("Cobertura de leitura: 100% · 116/116");
    expect(html).toContain("Não garante interpretação perfeita");
    expect(html).toContain("Pendente de validação: Citação");
    expect(html).toContain("Pendente de validação: Componente 26");
    expect(html).toContain("Manual do componente");
    expect(html).toContain('href="/api/artifacts/source-doc/content"');
    expect(html).toContain("Confira a conectividade no esquema original.");
    expect(html).toContain("Tensão de operação");
    expect(html).toContain("3.3 V"); expect(html).toContain("5 V"); expect(html).not.toContain("5 V V");
    expect(html).not.toMatch(/private-chunk|internal-omission|internal-object|internal-property-key|evidenceRefs/gu);
  });
  it("derives coverage from processed document segments without claiming missing coverage or perfect extraction", () => {
    const html = renderToStaticMarkup(createElement(CurrentExtractionReport, { language: "pt", report: { complete: false, documents: [{ artifactId: "source", label: "Fonte", complete: false, totalChunks: 4, completedChunks: 1, totalPages: 20, missingPages: [7] }] } }));
    expect(html).toContain("Cobertura de leitura: 25% · 1/4");
    expect(html).toContain("Páginas sem texto suficiente: 7");
    const unknown = renderToStaticMarkup(createElement(CurrentExtractionReport, { language: "pt", report: { complete: true } }));
    expect(unknown).toContain("Cobertura de leitura não informada.");
    expect(unknown).not.toContain("100%");
  });
});
