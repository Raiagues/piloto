import '../styles/features/landing.css';
import { LandingRequirements } from '../components/LandingRequirements';
import { Brand } from '../components/Brand';
import { ThemeToggle } from '../components/ThemeToggle';
import { useState } from 'react';
import { ArrowRight, FolderOpen, ListChecks, MessageSquare, CalendarDays } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getStoredLanguage, setStoredLanguage } from '../lib/i18n';
import { LanguageToggle } from '../components/LanguageToggle';
export function LandingPage() {
  const auth = useAuth();
  const [language, setLanguage] = useState(getStoredLanguage);
  const pt = language === 'pt', signedIn = auth.status === 'authenticated';
  const destination = signedIn ? '#/' : '#/register';
  const sections = pt ? [
    [ListChecks, 'Requisitos e evidências', 'Da origem do requisito ao resultado da verificação.'],
    [MessageSquare, 'Reuniões objetivas', 'Decisões e próximos passos em blocos concisos.'],
    [CalendarDays, 'Planejamento da equipe', 'Atividades, revisões e entregas no mesmo fluxo.'],
    [FolderOpen, 'Documentos organizados', 'Atas, matrizes e planos ligados ao projeto.']
  ] as const : [
    [ListChecks, 'Requirements and evidence', 'From the source requirement to verification results.'],
    [MessageSquare, 'Focused meetings', 'Decisions and next steps in concise blocks.'],
    [CalendarDays, 'Team planning', 'Activities, reviews and deliverables in one workflow.'],
    [FolderOpen, 'Organized documents', 'Minutes, matrices and plans connected to the project.']
  ] as const;
  return <main className="public-site">
    <header className="public-nav"><Brand /><nav><ThemeToggle language={language} /><LanguageToggle language={language} onChange={value => { setLanguage(value); setStoredLanguage(value); }} />{signedIn ? <a className="platform-primary" href="#/">{pt ? 'Abrir meus projetos' : 'Open my projects'}<ArrowRight size={16} /></a> : <><a href="#/login">{pt ? 'Entrar' : 'Sign in'}</a><a className="platform-primary" href="#/register">{pt ? 'Criar conta' : 'Create account'}</a></>}</nav></header>
    <section className="public-hero"><div><h1>{pt ? <>Engenharia com<br />rastreabilidade.</> : <>Engineering<br />with traceability.</>}</h1><p className="public-lead">{pt ? 'Requisitos, decisões e evidências. Um espaço para sua equipe trabalhar.' : 'Requirements, decisions and evidence. A workspace for your team.'}</p><div className="public-actions"><a className="platform-primary" href={destination}>{signedIn ? (pt ? 'Continuar no projeto' : 'Continue working') : (pt ? 'Começar' : 'Get started')}<ArrowRight size={17} /></a></div></div><LandingRequirements language={language} /></section>
    <section className="public-features"><div>{sections.map(([Icon, title, copy]) => <article key={title}><Icon size={23} /><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <footer className="public-footer"><Brand /><span>{pt ? 'Requisitos, decisões e evidências.' : 'Requirements, decisions and evidence.'}</span><nav aria-label={pt ? 'Políticas' : 'Policies'}><a href="#/privacy">{pt ? 'Privacidade' : 'Privacy'}</a><a href="#/terms">{pt ? 'Termos de uso' : 'Terms of use'}</a></nav></footer>
  </main>;
}
