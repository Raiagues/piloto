import { useMemo, useState } from 'react';
import { Columns3, Folder, FolderOpen, FileText, FolderTree, List, Plus, Search, Sparkles, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react';
import type { DeliveryRequirement, DeliveryState } from '../../lib/projectDelivery';
import { deliveryMethods, deliveryStatus } from '../../lib/projectDelivery';
import { RequirementHighlights } from './RequirementHighlights';
import type { RequirementFinding } from './RequirementHighlights';
import '../../styles/requirements-workspace.css';

type Props = { compact?: boolean; selectedId?: string; data: DeliveryState; projectId: string; pt: boolean; editable: boolean; onCreate: () => void; onSelect: (id: string, finding?: RequirementFinding) => void; onAnalyze: (ids: string[]) => void; analyzing: boolean; configuration: React.ReactNode };
const columnNames = { subsystem: ['Subsistema', 'Subsystem'], method: ['Método', 'Method'], owner: ['Responsável', 'Owner'], review: ['Revisão', 'Review'], verification: ['Verificação', 'Verification'], source: ['Origem', 'Source'], version: ['Versão', 'Version'] };
type Column = keyof typeof columnNames;
type ExplorerEntry =
  | { kind: 'group'; id: string; name: string; count: number }
  | { kind: 'requirement'; row: DeliveryRequirement; groupId: string; ancestors: string[]; hasChildren: boolean };

function resultOf(row: DeliveryRequirement, pt: boolean) {
  if (!row.analysis || row.analysis.engine === 'not_analyzed') return pt ? 'A analisar' : 'Not analyzed';
  const findings = row.analysis.findings;
  if (findings.some(f => f.origin === 'regulatory_review')) return pt ? 'Revisão regulatória' : 'Regulatory review';
  return findings.length ? `${findings.length} ${pt ? 'apontamento' + (findings.length > 1 ? 's' : '') : 'findings'}` : pt ? 'Sem alertas' : 'No findings';
}
export function RequirementsExplorer({ compact = false, selectedId, data, projectId, pt, editable, onCreate, onSelect, onAnalyze, analyzing, configuration }: Props) {
  const [outline, setOutline] = useState(true), [filters, setFilters] = useState(false);
  const [query, setQuery] = useState(''), [sector, setSector] = useState(''), [status, setStatus] = useState(''), [method, setMethod] = useState(''), [result, setResult] = useState(''), [archived, setArchived] = useState(false), [tree, setTree] = useState(false);
  const storageKey = `norte:requirements-columns:${projectId}`;
  const [columns, setColumns] = useState<Column[]>(() => { try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (Array.isArray(saved)) return saved.filter((c: string) => c in columnNames); } catch { /* private browsing */ } return ['subsystem', 'review']; });
  const toggleColumn = (key: Column) => { const next = columns.includes(key) ? columns.filter(c => c !== key) : [...columns, key]; setColumns(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* optional preference */ } };
  const groupName = (r: DeliveryRequirement) => data.sectors.find(s => s.id === r.sectorId)?.name || r.sectorId || (pt ? 'Sistema' : 'System');
  const filterScope = JSON.stringify([query, sector, status, method, result, archived]);
  const [collapsed, setCollapsed] = useState<{ scope: string; keys: string[] }>({ scope: filterScope, keys: [] });
  // A changed filter opens matching branches; collapsed rows never hide a new search result.
  const isCollapsed = (key: string) => collapsed.scope === filterScope && collapsed.keys.includes(key);
  const toggleBranch = (key: string) => setCollapsed(previous => {
    const keys = previous.scope === filterScope ? previous.keys : [];
    return { scope: filterScope, keys: keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key] };
  });
  const visible = useMemo(() => data.requirements.filter(r => (archived || !r.archived) && (!sector || (sector === '__system' ? !r.sectorId : r.sectorId === sector)) && (!status || r.status === status) && (!method || r.method === method) && (!result || (result === 'pending' ? !r.analysis || r.analysis.engine === 'not_analyzed' : result === 'findings' ? r.analysis?.findings.length > 0 : r.analysis?.engine !== 'not_analyzed' && r.analysis?.findings.length === 0)) && `${r.id} ${r.title} ${r.statement}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [data, archived, sector, status, method, result, query]);
  const groups = [{ id: '__system', name: pt ? 'Sistema' : 'System' }, ...data.sectors].filter(s => data.requirements.some(r => (archived || !r.archived) && (r.sectorId || '__system') === s.id));
  const ordered = useMemo<ExplorerEntry[]>(() => {
    if (!tree) return visible.map(row => ({ kind: 'requirement', row, groupId: '', ancestors: [], hasChildren: false }));
    const grouped = new Map<string, DeliveryRequirement[]>();
    for (const row of visible) {
      const id = row.sectorId || '__system';
      grouped.set(id, [...(grouped.get(id) || []), row]);
    }
    const entries: ExplorerEntry[] = [];
    for (const [groupId, rows] of grouped) {
      const name = data.sectors.find(item => item.id === groupId)?.name || (groupId === '__system' ? (pt ? 'Sistema' : 'System') : groupId);
      entries.push({ kind: 'group', id: groupId, name, count: rows.length });
      const ids = new Set(rows.map(row => row.id));
      const children = new Map<string, DeliveryRequirement[]>();
      const roots: DeliveryRequirement[] = [];
      for (const row of rows) {
        // Nest under an actual visible parent in this subsystem; retain every source link below.
        const parent = row.parentIds.find(id => id !== row.id && ids.has(id));
        if (parent) children.set(parent, [...(children.get(parent) || []), row]);
        else roots.push(row);
      }
      const seen = new Set<string>();
      const visit = (row: DeliveryRequirement, ancestors: string[]) => {
        if (seen.has(row.id)) return;
        seen.add(row.id);
        const descendants = children.get(row.id) || [];
        entries.push({ kind: 'requirement', row, groupId, ancestors, hasChildren: descendants.some(child => !seen.has(child.id)) });
        descendants.forEach(child => visit(child, [...ancestors, row.id]));
      };
      roots.forEach(row => visit(row, []));
      rows.forEach(row => visit(row, [])); // Keep malformed historical cycles readable, without duplicates.
    }
    return entries;
  }, [visible, tree, data.sectors, pt]);
  const visibleColumns = compact ? [] : columns;
  const value = (r: DeliveryRequirement, column: Column) => column === 'subsystem' ? groupName(r) : column === 'method' ? deliveryMethods.find(m => m.id === r.method)?.[pt ? 'pt' : 'en'] : column === 'owner' ? data.members.find(m => m.id === r.ownerId)?.name || '—' : column === 'review' ? deliveryStatus(r.status, pt) : column === 'verification' ? deliveryStatus(r.verificationStatus, pt) : column === 'version' ? `v${r.version}` : [...r.parentIds, ...r.artifactIds.map(id => data.artifacts.find(a => a.id === id)?.label || id), ...r.sourceRefs.map(id => data.evidence.find(e => e.id === id)?.artifactLabel || id)].filter((s, i, a) => a.indexOf(s) === i).join(' · ') || '—';
  return <div className={`requirements-explorer${outline ? '' : ' outline-collapsed'}`}>
    <aside hidden={!outline} className="requirements-outline" aria-label={pt ? 'Hierarquia de requisitos' : 'Requirement hierarchy'}>
      <button className={!sector ? 'active' : ''} onClick={() => setSector('')}><FolderTree size={16} /><span>{pt ? 'Todos os requisitos' : 'All requirements'}</span><small>{data.requirements.filter(r => !r.archived).length}</small></button>
      {groups.map(s => <details key={s.id} open><summary onClick={() => setSector(s.id)} className={sector === s.id ? 'active' : ''}><span>{s.name}</span><small>{data.requirements.filter(r => (archived || !r.archived) && (r.sectorId || '__system') === s.id).length}</small></summary>{data.requirements.filter(r => (archived || !r.archived) && (r.sectorId || '__system') === s.id).map(r => <button key={r.id} className="outline-requirement" onClick={() => onSelect(r.id)} title={r.title}><span>{r.id}</span><small>{r.title}</small></button>)}</details>)}
    </aside>
    <section className="requirements-main">
      <div className="requirements-tools"><button aria-label={pt ? outline ? 'Recolher hierarquia' : 'Mostrar hierarquia' : outline ? 'Collapse hierarchy' : 'Show hierarchy'} aria-expanded={outline} onClick={() => setOutline(value => !value)}>{outline ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</button><label className="requirements-search"><Search size={16} /><input type="search" aria-label={pt ? 'Buscar requisitos' : 'Search requirements'} placeholder={pt ? 'Buscar requisito, ID ou texto' : 'Search requirement, ID or text'} value={query} onChange={e => setQuery(e.target.value)} /></label><div className="requirements-view-switch"><button aria-label={pt ? 'Tabela' : 'Table'} aria-pressed={!tree} onClick={() => setTree(false)}><List size={17} /></button><button aria-label={pt ? 'Árvore' : 'Tree'} aria-pressed={tree} onClick={() => setTree(true)}><FolderTree size={17} /></button></div><button aria-expanded={filters} onClick={() => setFilters(value => !value)}><SlidersHorizontal size={15}/>{pt ? 'Filtros' : 'Filters'}</button><details className="requirements-columns"><summary><Columns3 size={15} />{pt ? 'Colunas' : 'Columns'}</summary><div>{(Object.keys(columnNames) as Column[]).map(c => <label key={c}><input type="checkbox" checked={columns.includes(c)} onChange={() => toggleColumn(c)} />{columnNames[c][pt ? 0 : 1]}</label>)}<label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />{pt ? 'Arquivados' : 'Archived'}</label></div></details>{configuration}{editable && <><button data-usage-action="requirements.analyze" disabled={analyzing || !visible.length} onClick={() => onAnalyze(visible.map(r => r.id))}><Sparkles size={15} />{pt ? 'Analisar' : 'Analyze'}</button><button className="primary" data-usage-action="requirements.create" onClick={onCreate}><Plus size={15} />{pt ? 'Requisito' : 'Requirement'}</button></>}</div>
      <div hidden={!filters} className="requirements-filters"><select aria-label={pt ? 'Subsistema' : 'Subsystem'} value={sector} onChange={e => setSector(e.target.value)}><option value="">{pt ? 'Todos os subsistemas' : 'All subsystems'}</option>{groups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select aria-label={pt ? 'Situação de revisão' : 'Review status'} value={status} onChange={e => setStatus(e.target.value)}><option value="">{pt ? 'Todas as revisões' : 'All reviews'}</option>{['draft', 'in_review', 'approved', 'changes_requested'].map(s => <option key={s} value={s}>{deliveryStatus(s, pt)}</option>)}</select><select aria-label={pt ? 'Método' : 'Method'} value={method} onChange={e => setMethod(e.target.value)}><option value="">{pt ? 'Todos os métodos' : 'All methods'}</option>{deliveryMethods.map(m => <option key={m.id} value={m.id}>{m[pt ? 'pt' : 'en']}</option>)}</select><select aria-label={pt ? 'Resultado da análise' : 'Analysis result'} value={result} onChange={e => setResult(e.target.value)}><option value="">{pt ? 'Todos os resultados' : 'All results'}</option><option value="pending">{pt ? 'A analisar' : 'Not analyzed'}</option><option value="findings">{pt ? 'Com apontamentos' : 'With findings'}</option><option value="clear">{pt ? 'Sem alertas' : 'No findings'}</option></select><span>{visible.length} / {data.requirements.filter(r => archived || !r.archived).length}</span></div>
      {ordered.length ? <div className="delivery-table-wrap"><table className={`delivery-table requirements-table${compact ? ' compact-inspector' : ''}${tree ? ' requirements-tree' : ''}`} aria-label={tree ? (pt ? 'Árvore de requisitos por subsistema' : 'Requirements tree by subsystem') : (pt ? 'Tabela de requisitos' : 'Requirements table')}>
        <thead><tr><th>ID</th><th>{pt ? 'Requisito' : 'Requirement'}</th>{visibleColumns.map(c => <th key={c}>{columnNames[c][pt ? 0 : 1]}</th>)}<th>{pt ? 'Análise' : 'Analysis'}</th><th aria-label={pt ? 'Abrir' : 'Open'} /></tr></thead>
        <tbody>{ordered.map(entry => {
          if (entry.kind === 'group') {
            const closed = isCollapsed(`group:${entry.id}`);
            return <tr key={`group:${entry.id}`} className="requirements-tree-group"><th colSpan={visibleColumns.length + 4} scope="rowgroup"><button aria-expanded={!closed} aria-label={`${closed ? (pt ? 'Expandir' : 'Expand') : (pt ? 'Recolher' : 'Collapse')} ${entry.name}`} onClick={() => toggleBranch(`group:${entry.id}`)}>
              {closed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{closed ? <Folder size={16} /> : <FolderOpen size={16} />}<span>{entry.name}</span><small>{entry.count}</small>
            </button></th></tr>;
          }
          const { row: r, ancestors, groupId, hasChildren } = entry;
          if (tree && (isCollapsed(`group:${groupId}`) || ancestors.some(id => isCollapsed(`requirement:${id}`)))) return null;
          const closed = isCollapsed(`requirement:${r.id}`);
          return <tr key={r.id} className={`requirements-record${selectedId === r.id ? ' selected' : ''}`} aria-current={selectedId === r.id ? 'true' : undefined} tabIndex={0} aria-label={`${r.id}: ${r.title}`} onClick={() => onSelect(r.id)} onKeyDown={e => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); }
            else if (tree && hasChildren && ((e.key === 'ArrowRight' && closed) || (e.key === 'ArrowLeft' && !closed))) { e.preventDefault(); toggleBranch(`requirement:${r.id}`); }
          }}>
            <td>{tree ? <div className="requirements-tree-node" style={{ paddingLeft: ancestors.length * 22 }}>
              {hasChildren ? <button className="requirements-tree-toggle" aria-expanded={!closed} aria-label={`${closed ? (pt ? 'Expandir' : 'Expand') : (pt ? 'Recolher' : 'Collapse')} ${r.id}`} onClick={e => { e.stopPropagation(); toggleBranch(`requirement:${r.id}`); }}>{closed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button> : <span className="requirements-tree-leaf" aria-hidden="true"><FileText size={14} /></span>}
              <span className="delivery-id">{r.id}</span>
            </div> : <span className="delivery-id">{r.id}</span>}</td>
            <td><RequirementHighlights compact statement={r.statement} findings={r.analysis?.findings || []} language={pt ? 'pt' : 'en'} onSelect={f => onSelect(r.id, f)} />
              {tree && r.parentIds.length > 0 && <div className="requirements-tree-origins"><span>{pt ? 'Derivado de' : 'Derived from'}</span>{r.parentIds.map(id => <button key={id} onClick={e => { e.stopPropagation(); onSelect(id); }}>{id}</button>)}</div>}
            </td>
            {visibleColumns.map(c => <td key={c}><span className={c === 'review' ? `delivery-badge ${r.status}` : ''}>{value(r, c)}</span></td>)}
            <td><span className={`requirement-result ${!r.analysis || r.analysis.engine === 'not_analyzed' ? 'unchecked' : r.analysis.findings.some(f => f.severity === 'critical') ? 'critical' : r.analysis.findings.length ? 'warning' : 'clear'}`}>{resultOf(r, pt)}</span></td><td><ChevronRight size={15} /></td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="delivery-empty"><h2>{data.requirements.length ? (pt ? 'Nenhum resultado' : 'No results') : (pt ? 'Nenhum requisito ainda' : 'No requirements yet')}</h2>{editable && !data.requirements.length && <button data-usage-action="requirements.create" onClick={onCreate}><Plus size={15} />{pt ? 'Criar requisito' : 'Create requirement'}</button>}</div>}

    </section>
  </div>;
}
