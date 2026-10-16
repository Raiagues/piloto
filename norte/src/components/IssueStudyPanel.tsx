import { useState } from "react";
import type { Language, MissionIssue, MissionNode } from "../lib/types";
import type { IssueStudy, IssueStudyHypothesis } from "../lib/projectStore";
import { ux } from "../lib/uxCopy";

type Props = {
  language: Language;
  issue: MissionIssue;
  nodes: MissionNode[];
  study: IssueStudy;
  t: (path: string) => string;
  resolveNodeTitle: (node: MissionNode) => string;
  onChange: (study: IssueStudy) => void;
  onResolve: (study: IssueStudy) => void;
  onClose: () => void;
};

export function IssueStudyPanel({ language, issue, nodes, study, t, resolveNodeTitle, onChange, onResolve, onClose }: Props) {
  const [newHypothesis, setNewHypothesis] = useState("");
  const related = nodes.filter((node) => issue.nodeIds.includes(node.id));

  function patch(patchValue: Partial<IssueStudy>) {
    onChange({ ...study, ...patchValue, updatedAt: new Date().toISOString() });
  }

  function addHypothesis() {
    const title = newHypothesis.trim();
    if (!title) return;
    const hypothesis: IssueStudyHypothesis = { id: `hyp-${Date.now()}`, title, notes: "", status: "candidate" };
    patch({ hypotheses: [...study.hypotheses, hypothesis] });
    setNewHypothesis("");
  }

  function setStatus(id: string, status: IssueStudyHypothesis["status"]) {
    patch({ hypotheses: study.hypotheses.map((item) => item.id === id ? { ...item, status } : item) });
  }

  function updateHypothesisNotes(id: string, notes: string) {
    patch({ hypotheses: study.hypotheses.map((item) => item.id === id ? { ...item, notes } : item) });
  }

  function adopt(id: string) {
    const next = { ...study, conclusionHypothesisId: id, status: "resolved" as const, updatedAt: new Date().toISOString() };
    onResolve(next);
  }

  return (
    <div className="study-layer" data-panel>
      <div className="study-panel">
        <header className="study-header">
          <div>
            <div className="modal-eyebrow">{ux(language, "issueStudy")}</div>
            <h2>{t(issue.titleKey)}</h2>
            <p>{t(issue.descriptionKey)}</p>
          </div>
          <button className="drawer-close-button" aria-label={ux(language, "closePanel")} onClick={onClose}>×</button>
        </header>

        <div className="study-grid">
          <section className="study-evidence">
            <div className="study-section-title">{ux(language, "issueEvidence")}</div>
            {related.map((node) => (
              <div className="evidence-card" key={node.id}>
                <span>{node.kickerKey.startsWith("nodes.") ? t(node.kickerKey) : node.kickerKey}</span>
                <strong>{resolveNodeTitle(node)}</strong>
              </div>
            ))}
          </section>

          <section className="study-hypotheses">
            <div className="study-section-title">{ux(language, "issueHypotheses")}</div>
            <div className="hypothesis-entry">
              <input value={newHypothesis} placeholder={ux(language, "hypothesisPlaceholder")} onChange={(event) => setNewHypothesis(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addHypothesis(); }} />
              <button className="technical-button" onClick={addHypothesis}>{ux(language, "addHypothesis")}</button>
            </div>

            <div className="hypothesis-list">
              {study.hypotheses.map((hypothesis) => (
                <article className={`hypothesis-card ${hypothesis.status}`} key={hypothesis.id}>
                  <div className="hypothesis-top">
                    <strong>{hypothesis.title}</strong>
                    <span>{hypothesis.status === "favored" ? ux(language, "favored") : hypothesis.status === "rejected" ? ux(language, "rejected") : ux(language, "candidate")}</span>
                  </div>
                  <textarea rows={2} value={hypothesis.notes} placeholder={ux(language, "studyNotesPlaceholder")} onChange={(event) => updateHypothesisNotes(hypothesis.id, event.target.value)} />
                  <div className="hypothesis-actions">
                    <button onClick={() => setStatus(hypothesis.id, "favored")}>{ux(language, "favor")}</button>
                    <button onClick={() => setStatus(hypothesis.id, "rejected")}>{ux(language, "reject")}</button>
                    <button className="primary" onClick={() => adopt(hypothesis.id)}>{ux(language, "adoptConclusion")}</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className="study-notes-block">
          <div className="study-section-title">{ux(language, "studyNotes")}</div>
          <textarea rows={4} value={study.notes} placeholder={ux(language, "studyNotesPlaceholder")} onChange={(event) => patch({ notes: event.target.value })} />
          <small>{ux(language, "conclusionHelp")}</small>
        </section>
      </div>
    </div>
  );
}