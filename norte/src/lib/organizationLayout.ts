import { graphlib, layout } from '@dagrejs/dagre';
import type { OrganizationNode } from '../../shared/organization-tree.mjs';

export type OrganizationCard = { key: string; node: OrganizationNode; details: { text: string; role?: string; memberId?: string; kind: 'responsibility' | 'person' | 'sector' }[]; children: OrganizationCard[]; x: number; y: number; width: number; height: number };
export type OrganizationLayoutOptions = { /** Fold each sector into one row of its project card, for the team overview. */ collapseSectors?: boolean };
export const ORGANIZATION_CARD_WIDTH = 244;
/** One avatar row per person or responsibility, sized to the chart's CSS. */
export const ORGANIZATION_ROW_HEIGHT = 34;
export const organizationLines = (text: string, length = 27) => text.match(new RegExp(`.{1,${length}}(?:\\s|$)|.{1,${length}}`, 'gu'))?.map(line => line.trim()) || [''];

/** Keep every person and responsibility, grouped within their project/sector card. */
export function layoutOrganization(tree: OrganizationNode, options: OrganizationLayoutOptions = {}) {
  const cards: OrganizationCard[] = [], edges: { from: string; to: string }[] = [];
  function compact(node: OrganizationNode, key: string): OrganizationCard {
    const details: OrganizationCard['details'] = [];
    const children: OrganizationCard[] = [];
    function collect(child: OrganizationNode) {
      if (options.collapseSectors && child.kind === 'sector' && node.kind === 'project') {
        const manager = child.children.find(item => item.kind === 'responsibility');
        details.push({ text: child.name, role: manager?.memberIds?.length ? manager.name : undefined, memberId: manager?.memberIds?.length === 1 ? manager.memberIds[0] : undefined, kind: 'sector' });
      } else if (child.kind === 'responsibility' || child.kind === 'person') {
        details.push({ text: child.name, role: child.role, memberId: child.memberId || (child.memberIds?.length === 1 ? child.memberIds[0] : undefined), kind: child.kind });
        child.children.forEach(collect);
      } else children.push(compact(child, `${key}/${children.length}:${child.id}`));
    }
    node.children.forEach(collect);
    const card = { key, node, details, children, x: 0, y: 0, width: ORGANIZATION_CARD_WIDTH, height: 30 + organizationLines(node.name, 24).length * 20 + details.length * ORGANIZATION_ROW_HEIGHT + (node.kind === 'project' ? 40 : 14) };
    cards.push(card); children.forEach(child => edges.push({ from: key, to: child.key }));
    return card;
  }
  const root = compact(tree, tree.id);
  // A project with many sectors uses a wrapped grid so the overview remains readable.
  if (root.children.length && root.children.every(c => !c.children.length)) {
    const columns = Math.min(4, root.children.length), gap = 24, width = columns * (ORGANIZATION_CARD_WIDTH + gap) - gap + 32;
    root.x = (width - root.width) / 2; root.y = 16;
    let y = root.height + 64;
    for (let start = 0; start < root.children.length; start += columns) {
      const row = root.children.slice(start, start + columns);
      row.forEach((c, i) => { c.x = 16 + i * (ORGANIZATION_CARD_WIDTH + gap); c.y = y; });
      y += Math.max(...row.map(c => c.height)) + gap;
    }
    return { cards, edges, width, height: y };
  }
  const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 56, marginx: 16, marginy: 16 }).setDefaultEdgeLabel(() => ({}));
  cards.forEach(c => graph.setNode(c.key, { width: c.width, height: c.height }));
  edges.forEach(e => graph.setEdge(e.from, e.to)); layout(graph);
  cards.forEach(c => { const p = graph.node(c.key); c.x = p.x - c.width / 2; c.y = p.y - c.height / 2; });
  return { cards, edges, width: graph.graph().width || 256, height: graph.graph().height || 160 };
}

export function organizationEdgePath(diagram: ReturnType<typeof layoutOrganization>, edge: { from: string; to: string }) {
  const a = diagram.cards.find(c => c.key === edge.from)!, b = diagram.cards.find(c => c.key === edge.to)!;
  const start = `M${a.x + a.width / 2} ${a.y + a.height}`;
  const wrapped = a.children.length > 4 && a.children.every(c => !c.children.length);
  return `${start}${wrapped ? ` V${a.y + a.height + 16} H4` : ''} V${b.y - 12} H${b.x + b.width / 2} V${b.y}`;
}
