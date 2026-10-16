import { LandingRequirements } from '../components/LandingRequirements';
import { ThemeToggle } from '../components/ThemeToggle';
import { useState } from 'react';
import { ArrowRight, FileText, GitBranch, ListChecks, MessageSquare, CalendarDays, Layers } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getStoredLanguage, setStoredLanguage } from '../lib/i18n';
import { LanguageToggle } from '../components/LanguageToggle';
import { UsagePrivacyControl } from '../lib/usageTelemetry';
import '../platform.css';
export function LandingPage() {
  const auth = useAuth(), [language, setLanguage] = useState(getStoredLanguage), [busy, setBusy] = useState(false), [error, setError] = useState(''); const pt = language === 'pt';
  const sections = pt ? [
    [FileText, 'Memória que tem contexto', 'Documentos por setor, fontes rastreáveis e permissões para quem trabalha em cada parte.'],
    [GitBranch, 'Arquitetura que se pode explorar', 'Sistemas, componentes, interfaces e parâmetros conectados às evidências do projeto.'],
    [ListChecks, 'Requisitos até a verificação', 'Revisores, histórico, testes e resultados. Saiba o que mudou e o que ainda precisa ser comprovado.'],
    [MessageSquare, 'Reuniões que deixam decisões', 'Use a memória do projeto durante a conversa e revise uma ata concisa com referências.'],
    [CalendarDays, 'Prazos ligados ao trabalho', 'Entregas, dependências e responsáveis conectados aos requisitos e testes.'],
    [Layers, 'Comece pelo que você já tem', 'Um nome, uma ideia ou um documento. Organize o restante conforme o projeto avança.']
  ] as const : [
    [FileText, 'Project memory with context', 'Documents by discipline, traceable sources and permissions for each team.'], [GitBranch, 'An architecture you can explore', 'Systems, components, interfaces and parameters connected to project evidence.'], [ListChecks, 'Requirements through verification', 'Reviewers, history, tests and results. See what changed and what needs evidence.'], [MessageSquare, 'Meetings with lasting decisions', 'Bring project memory into the conversation and review concise minutes with references.'], [CalendarDays, 'Schedules connected to work', 'Deliverables, dependencies and owners connected to requirements and tests.'], [Layers, 'Start with what you have', 'A name, an idea or a document. Organize the rest as your project evolves.']
  ] as const;
  return <main className="public-site"><header className="public-nav"><a className="public-brand" href="#/">NORTE</a><nav><ThemeToggle language={language} /><a href="#/plans">{pt ? 'Planos' : 'Plans'}</a><LanguageToggle language={language} onChange={value => { setLanguage(value); setStoredLanguage(value); }} /><a href="#/login">{pt ? 'Entrar' : 'Sign in'}</a><a className="platform-primary" href="#/register">{pt ? 'Criar conta' : 'Create account'}</a></nav></header>
    <section className="public-hero"><div><p className="platform-eyebrow">{pt ? 'ENGENHARIA, DO CONTEXTO À EVIDÊNCIA' : 'ENGINEERING, FROM CONTEXT TO EVIDENCE'}</p><h1>{pt ? <>Dê continuidade ao<br />seu projeto de engenharia.</> : <>Keep your engineering<br />project connected.</>}</h1><p className="public-lead">{pt ? 'Conecte documentos, arquitetura, requisitos e decisões. Uma memória compartilhada para entender o projeto, testar ideias e acompanhar o que precisa ser entregue.' : 'Connect documents, architecture, requirements and decisions. A shared memory to understand the project, explore ideas and track what needs to be delivered.'}</p><div className="public-actions"><a className="platform-primary" href="#/register">{pt ? 'Começar um projeto' : 'Start a project'}<ArrowRight size={17} /></a>{auth.demoAvailable && <button disabled={busy} onClick={() => { setBusy(true); void auth.loginDemo().then(() => { window.location.hash = '#/'; }).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}>{busy ? (pt ? 'Abrindo…' : 'Opening…') : auth.demoResumeAvailable ? (pt ? 'Retomar conta de teste' : 'Resume test account') : (pt ? 'Explorar demonstração' : 'Explore demo')}</button>}</div>{error && <p role="alert">{error}</p>}</div>
    <LandingRequirements language={language} /></section>
    <section className="public-features"><div className="public-section-head"><p className="platform-eyebrow">{pt ? 'UMA BASE PARA O TRABALHO DA EQUIPE' : 'A FOUNDATION FOR TEAMWORK'}</p><h2>{pt ? 'Menos informação solta. Mais contexto para decidir.' : 'Less scattered information. More context for decisions.'}</h2></div><div>{sections.map(([Icon, title, copy]) => <article key={title}><Icon size={23} /><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="public-start"><div><h2>{pt ? 'Comece com uma ideia. Evolua com sua equipe.' : 'Start with an idea. Build it with your team.'}</h2><p>{pt ? 'Dê um nome. Abra a concepção. Adicione documentos e organize a equipe quando fizer sentido.' : 'Give it a name. Open the architecture. Add documents and organize the team when ready.'}</p></div><a className="platform-primary" href="#/register">{pt ? 'Criar meu projeto' : 'Create my project'}<ArrowRight size={17} /></a></section>
    <footer className="public-footer"><div><strong>NORTE</strong><p>{pt ? 'Memória, decisões e evidências de engenharia.' : 'Engineering memory, decisions and evidence.'}</p></div><div><a href="#/plans">{pt ? 'Planos e contratação' : 'Plans and subscriptions'}</a><p>{pt ? 'Sugestões de IA apoiam o trabalho da equipe e exigem revisão técnica.' : 'AI suggestions support the team’s work and require technical review.'}</p><UsagePrivacyControl language={language} /></div></footer>
  </main>;
}
