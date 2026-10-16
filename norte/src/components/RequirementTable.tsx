import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { METHOD_LABELS, requirementSubsystems } from "../lib/projectRequirements";
import type { ProjectRequirement, VerificationMethod } from "../lib/projectRequirements";
import type { Language } from "../lib/types";

export type RequirementColumn = {
  id: string;
  head: string;
  className?: string;
  cell: (requirement: ProjectRequirement) => React.ReactNode;
};

type Props = {
  language: Language; requirements: ProjectRequirement[]; columns: RequirementColumn[];
  /** Extra filter offered by the page that owns the table, e.g. review state. */
  extraFilter?: { label: string; options: { value: string; label: string }[]; match: (requirement: ProjectRequirement, value: string) => boolean };
  empty: string;
};

/** One filtered table, shared by Requirements and Verification so a row reads the same in both. */
export function RequirementTable({ language, requirements, columns, extraFilter, empty }: Props) {
  const pt = language === "pt";
  const [search, setSearch] = useState("");
  const [subsystem, setSubsystem] = useState("");
  const [method, setMethod] = useState("");
  const [source, setSource] = useState("");
  const [extra, setExtra] = useState("");
  const subsystems = useMemo(() => requirementSubsystems(requirements), [requirements]);
  const plain = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const query = plain(search.trim());
  const rows = requirements.filter((requirement) =>
    (!query || plain(`${requirement.id} ${requirement.title} ${requirement.statement} ${requirement.linked.join(" ")}`).includes(query))
    && (!subsystem || requirement.subsystem === subsystem)
    && (!method || requirement.method === method)
    && (!source || requirement.source === source)
    && (!extra || !extraFilter || extraFilter.match(requirement, extra)));
  const filtered = Boolean(query || subsystem || method || source || extra);
  const c = pt
    ? { search: "Buscar requisito", subsystem: "Subsistema", method: "Método", source: "Origem", all: "Todos", system: "Arquitetura", program: "Programa", clear: "Limpar filtros", showing: (shown: number, total: number) => `${shown} de ${total}` }
    : { search: "Search requirement", subsystem: "Subsystem", method: "Method", source: "Source", all: "All", system: "Architecture", program: "Programme", clear: "Clear filters", showing: (shown: number, total: number) => `${shown} of ${total}` };

  return <div className="requirement-table-wrap">
    <div className="requirement-filters" role="search">
      <label className="requirement-search"><Search aria-hidden="true" /><input type="search" value={search} placeholder={c.search} aria-label={c.search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label><span>{c.subsystem}</span><select value={subsystem} onChange={(event) => setSubsystem(event.target.value)}><option value="">{c.all}</option>{subsystems.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>{c.method}</span><select value={method} onChange={(event) => setMethod(event.target.value)}><option value="">{c.all}</option>{(Object.keys(METHOD_LABELS) as VerificationMethod[]).map((item) => <option key={item} value={item}>{METHOD_LABELS[item][pt ? 0 : 1]}</option>)}</select></label>
      <label><span>{c.source}</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">{c.all}</option><option value="system">{c.system}</option><option value="program">{c.program}</option></select></label>
      {extraFilter && <label><span>{extraFilter.label}</span><select value={extra} onChange={(event) => setExtra(event.target.value)}><option value="">{c.all}</option>{extraFilter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
      <span className="requirement-count">{c.showing(rows.length, requirements.length)}</span>
      {filtered && <button type="button" className="requirement-clear" onClick={() => { setSearch(""); setSubsystem(""); setMethod(""); setSource(""); setExtra(""); }}><X aria-hidden="true" />{c.clear}</button>}
    </div>
    {rows.length === 0
      ? <p className="requirement-empty">{empty}</p>
      : <div className="requirement-scroll"><table className="requirement-table">
        <thead><tr>{columns.map((column) => <th key={column.id} className={column.className} scope="col">{column.head}</th>)}</tr></thead>
        <tbody>{rows.map((requirement) => <tr key={requirement.id} className={requirement.changed.length ? "changed" : undefined}>
          {columns.map((column) => <td key={column.id} className={column.className}>{column.cell(requirement)}</td>)}
        </tr>)}</tbody>
      </table></div>}
  </div>;
}
