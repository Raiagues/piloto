import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { TeamInsights } from '../components/TeamInsights';
import { InfoTip } from '../components/InfoTip';
import type { TeamRecord } from '../lib/team';
import type { Language } from '../lib/types';

export function TeamDashboardPage({ teams, language }: { teams: TeamRecord[]; language: Language }) {
  const pt = language === 'pt', managed = teams.filter(team => team.canManage);
  const [selectedId, setSelectedId] = useState('');
  const team = managed.find(item => item.id === selectedId) || managed[0];
  return <main className="team-dashboard"><header className="workspace-heading"><div><span className="workspace-eyebrow">{pt ? 'GESTÃO' : 'MANAGEMENT'}</span><h1><BarChart3 size={24} />{pt ? 'Painel da equipe' : 'Team dashboard'}<InfoTip label={pt ? 'Sobre os indicadores' : 'About these insights'}>{pt ? 'Resumos de participação dos últimos 30 dias, disponíveis aos responsáveis autorizados. Não medem horas de trabalho ou produtividade.' : 'Participation summaries from the last 30 days, available to authorized leaders. They do not measure working hours or productivity.'}</InfoTip></h1></div>{team && <label className="workspace-field"><span>{pt ? 'Equipe' : 'Team'}</span><select aria-label={pt ? "Equipe" : "Team"} value={team.id} onChange={e => setSelectedId(e.target.value)}>{managed.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}</header>
    {team ? <TeamInsights key={team.id} teamId={team.id} language={language} /> : <p role="status">{pt ? 'Este painel está disponível para quem gerencia uma equipe.' : 'This dashboard is available to team leaders.'}</p>}
  </main>;
}
