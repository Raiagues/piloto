import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../src/lib/auth";
import { MissionSidebar } from "../src/components/MissionSidebar";
import { HomePage } from "../src/pages/HomePage";
import { completeConception, createEmptyProject, normalizeProject, recordMemoryRevision, saveProject } from "../src/lib/projectStore";
import type { EngineeringSystemModel } from "../src/lib/engineeringSystem";

vi.mock("../src/components/UserBadge", () => ({ UserBadge: () => null }));

const model: EngineeringSystemModel = { schemaVersion: 1, id: "test-system", name: "Validation", generatedAt: "2026-09-08T00:00:00Z", generatedFromRevision: 2, relations: [], requirements: [], evidence: [], artifactSources: [], entities: [
  { id: "payload", name: "Payload", kind: "component", description: "", source: "documented", confidence: 1, evidenceRefs: [], properties: [{ key: "mass", name: "Mass", value: 120, unit: "g", source: "documented", evidenceRefs: [] }] },
  { id: "radio", name: "Rádio", kind: "component", description: "", source: "documented", confidence: 1, evidenceRefs: [], properties: [{ key: "model", name: "Model", value: "RFM95", source: "documented", evidenceRefs: [] }] }
] };
const noop = () => undefined;
function sidebar(highestUnlockedStep: number, currentStep: number | null, projectTeamName = "Team one") {
  return renderToStaticMarkup(createElement(AuthProvider, { children: createElement(MissionSidebar, { language: "en", highestUnlockedStep, currentStep, expanded: true, connectedLabel: "Connected", homeLabel: "Home", teamLabel: "Teams", homeActive: false, teamActive: false, projects: [], activeProjectId: "p", projectTeamName, onToggle: noop, onHome: noop, onTeam: noop, onProjectSelect: noop, onStepSelect: noop, activeArea: null, onAreaSelect: noop }) }));
}

describe("project-owned conception progression", () => {
  it("starts locked, persists completion and never relocks when memory becomes active", () => {
    const fresh = createEmptyProject("en");
    expect(fresh.phaseProgress.highestUnlockedStep).toBe(0);
    const completed = completeConception(fresh, model);
    const revisited = saveProject({ ...completed, navigation: { ...completed.navigation, lastRoute: "setup" } });
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(revisited)));
    expect(reloaded.phaseProgress.highestUnlockedStep).toBe(1);
    expect(reloaded.engineeringSystem).toEqual(model);
    expect(reloaded.navigation.lastConceptionWorkspace).toBe("system");
    expect(createEmptyProject().phaseProgress.highestUnlockedStep).toBe(0);
  });
  it("keeps preliminary-design access after reopening conception", () => {
    const project = { ...completeConception(createEmptyProject("en"), model), phaseProgress: { highestUnlockedStep: 2 as const }, navigation: { lastRoute: "preliminary" as const } };
    expect(normalizeProject(project).navigation.lastRoute).toBe("preliminary");
    expect(completeConception(project, model).phaseProgress.highestUnlockedStep).toBe(2);
  });
  it("normalizes a removed workspace to System while keeping Discovery", () => {
    const project = createEmptyProject();
    expect(normalizeProject({ ...project, navigation: { ...project.navigation, lastConceptionWorkspace: "timeline" } } as unknown as typeof project).navigation.lastConceptionWorkspace).toBe("system");
    expect(normalizeProject({ ...project, navigation: { ...project.navigation, lastConceptionWorkspace: "discovery" } }).navigation.lastConceptionWorkspace).toBe("discovery");
  });
  it("preserves historical progress and old boards without creating an engineering model", () => {
    const old = createEmptyProject();
    Reflect.deleteProperty(old, "phaseProgress");
    Reflect.deleteProperty(old, "memoryRevision");
    old.navigation.lastRoute = "brainstorm";
    const normalized = normalizeProject(old);
    expect(normalized.phaseProgress.highestUnlockedStep).toBe(1);
    expect(normalized.engineeringSystem).toBeUndefined();
    expect(normalized.board).toEqual(old.board);
  });
  it("changes memory revision for linked sources but not route or canvas positions", () => {
    const project = createEmptyProject();
    expect(recordMemoryRevision(project, { ...project, navigation: { lastRoute: "brainstorm" } }).memoryRevision).toBe(0);
    const changed = recordMemoryRevision(project, { ...project, context: { ...project.context, projectArtifactIds: ["datasheet"] } });
    expect(changed.memoryRevision).toBe(1);
    expect(recordMemoryRevision(changed, { ...changed, name: "Updated" }).memoryRevision).toBe(2);
  });
  it("renders one project selector, read-only owning team and route-independent conception access", () => {
    const locked = sidebar(0, 0);
    const unlocked = sidebar(1, 0);
    expect(locked).toMatch(/class="mission-phase locked"[^>]*disabled=""/u);
    expect(unlocked).toMatch(/class="mission-phase available"/u);
    expect((unlocked.match(/<select/g) ?? []).length).toBe(1);
    expect(unlocked).toContain("Team one");
    expect(sidebar(1, null, "Team two")).toContain("Team two");
    expect(sidebar(0, null)).toMatch(/class="mission-phase locked"/u);
  });
  it("enables project creation with a clear entry point", () => {
    const html = renderToStaticMarkup(createElement(AuthProvider, { children: createElement(HomePage, { language: "en", t: (key) => key, onLanguageChange: noop }) }));
    expect(html).not.toMatch(/class="home-action-card accent-create"[^>]*disabled=""/u);
    expect(html).toContain("Give it a name and start building.");
  });
});
