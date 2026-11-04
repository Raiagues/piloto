import '../styles/features/landing.css';
import { LandingMeeting } from '../components/LandingMeeting';
import { LandingRequirements } from '../components/LandingRequirements';
import { Brand } from '../components/Brand';
import { ThemeToggle } from '../components/ThemeToggle';
import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  ArrowRight,
  AudioLines,
  CalendarDays,
  Check,
  FileText,
  FolderOpen,
  Layers,
  MessageSquare,
  Play,
  Users,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getStoredLanguage, setStoredLanguage } from '../lib/i18n';
import { LanguageToggle } from '../components/LanguageToggle';
export function LandingPage() {
  const auth = useAuth();
  const [language, setLanguage] = useState(getStoredLanguage),
    [listenRequest, setListenRequest] = useState(0);
  const meeting = useRef<HTMLElement>(null),
    requirements = useRef<HTMLElement>(null),
    platform = useRef<HTMLElement>(null);
  const pt = language === 'pt',
    signedIn = auth.status === 'authenticated';
  const destination = signedIn ? '#/' : '#/register',
    start = signedIn ? (pt ? 'Continuar no projeto' : 'Continue working') : pt ? 'Começar' : 'Get started';
  // Routes live in the hash, so sections are reached by scrolling instead of #anchors.
  const scrollTo = (section: RefObject<HTMLElement | null>) =>
    section.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const steps = pt
    ? ([
        [
          AudioLines,
          'Fale normalmente',
          'A sala transcreve a conversa com o reconhecimento de fala do navegador. Ninguém precisa parar para anotar.',
        ],
        [
          Layers,
          'O Norte organiza',
          'Cada fala é filtrada, classificada como problema, hipótese, teste, resultado, decisão ou requisito, e entra no assunto certo com uma nota curta.',
        ],
        [
          FileText,
          'A ata fica pronta',
          'No fim, as notas viram uma ata por assunto, com referência à fala de origem. As correções da equipe são preservadas.',
        ],
      ] as const)
    : ([
        [
          AudioLines,
          'Just talk',
          'The room transcribes the conversation with the browser’s speech recognition. Nobody has to stop and take notes.',
        ],
        [
          Layers,
          'Norte organizes',
          'Each line is filtered, classified as a problem, hypothesis, test, result, decision or requirement, and lands in the right topic as a short note.',
        ],
        [
          FileText,
          'Minutes are ready',
          'At the end, the notes become minutes by topic, each item referencing its source line. Team corrections are kept.',
        ],
      ] as const);
  const checks = pt
    ? [
        'Trecho, motivo e referência oficial em cada apontamento',
        'Requisito, método, critério, fonte e resultado separados',
        'A análise só roda depois de um pedido da equipe',
      ]
    : [
        'Excerpt, reason and official reference in every finding',
        'Requirement, method, criterion, source and result kept apart',
        'Analysis only runs when the team asks for it',
      ];
  const features = pt
    ? ([
        [CalendarDays, 'Cronograma', 'Atividades, revisões e entregas ligadas aos requisitos.'],
        [FolderOpen, 'Documentos', 'Atas, matrizes e fontes reunidas na visão geral do projeto.'],
        [Users, 'Equipes', 'Projetos organizados por equipe, com acesso controlado.'],
        [MessageSquare, 'Mensagens', 'Conversas com pessoas e equipes, e um canal de ajuda.'],
      ] as const)
    : ([
        [CalendarDays, 'Schedule', 'Activities, reviews and deliverables linked to requirements.'],
        [FolderOpen, 'Documents', 'Minutes, matrices and sources gathered in the project overview.'],
        [Users, 'Teams', 'Projects organized by team, with controlled access.'],
        [MessageSquare, 'Messages', 'Conversations with people and teams, plus a help channel.'],
      ] as const);
  return (
    <main className="public-site">
      <header className="public-nav">
        <Brand language={language} />
        <nav className="public-nav-sections" aria-label={pt ? 'Seções' : 'Sections'}>
          <button type="button" onClick={() => scrollTo(meeting)}>
            {pt ? 'Reuniões' : 'Meetings'}
          </button>
          <button type="button" onClick={() => scrollTo(requirements)}>
            {pt ? 'Requisitos' : 'Requirements'}
          </button>
          <button type="button" onClick={() => scrollTo(platform)}>
            {pt ? 'Plataforma' : 'Platform'}
          </button>
        </nav>
        <div className="public-nav-actions">
          <ThemeToggle language={language} />
          <LanguageToggle
            language={language}
            onChange={value => {
              setLanguage(value);
              setStoredLanguage(value);
            }}
          />
          {signedIn ? (
            <a className="platform-primary" href="#/">
              {pt ? 'Abrir meus projetos' : 'Open my projects'}
              <ArrowRight size={16} />
            </a>
          ) : (
            <>
              <a className="public-nav-link" href="#/login">
                {pt ? 'Entrar' : 'Sign in'}
              </a>
              <a className="platform-primary" href="#/register">
                {pt ? 'Criar conta' : 'Create account'}
              </a>
            </>
          )}
        </div>
      </header>
      <section className="public-hero">
        <p className="public-eyebrow">
          <span aria-hidden="true">
            <AudioLines size={13} />
          </span>
          {pt ? 'Engenharia com rastreabilidade' : 'Engineering with traceability'}
        </p>
        <h1>
          {pt ? (
            <>
              Da reunião ao requisito,
              <br />
              <em>sem perder o fio.</em>
            </>
          ) : (
            <>
              From meeting to requirement,
              <br />
              <em>without losing the thread.</em>
            </>
          )}
        </h1>
        <p className="public-lead">
          {pt
            ? 'O Norte transcreve a reunião, organiza o que foi dito em assuntos, notas e ata, e mantém cada requisito ligado à fonte que o justifica.'
            : 'Norte transcribes the meeting, organizes what was said into topics, notes and minutes, and keeps every requirement linked to the source behind it.'}
        </p>
        <div className="public-actions">
          <a className="platform-primary" href={destination}>
            {start}
            <ArrowRight size={17} />
          </a>
          <button type="button" className="public-secondary" onClick={() => setListenRequest(value => value + 1)}>
            <Play size={15} />
            {pt ? 'Ouvir uma reunião' : 'Listen to a meeting'}
          </button>
        </div>
      </section>
      <section className="public-demo" ref={meeting} aria-labelledby="public-demo-title">
        <h2 id="public-demo-title" className="sr-only">
          {pt ? 'Sala de reunião' : 'Meeting room'}
        </h2>
        <LandingMeeting language={language} listenRequest={listenRequest} />
      </section>
      <section className="public-section public-steps">
        <div className="public-section-heading">
          <small>{pt ? 'Como funciona' : 'How it works'}</small>
          <h2>{pt ? 'A reunião vira registro enquanto acontece' : 'The meeting becomes a record as it happens'}</h2>
        </div>
        <ol>
          {steps.map(([Icon, title, copy], index) => (
            <li key={title}>
              <span className="public-step-icon">
                <Icon size={20} />
              </span>
              <small>{String(index + 1).padStart(2, '0')}</small>
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="public-section public-requirements" ref={requirements}>
        <div className="public-section-heading">
          <small>{pt ? 'Requisitos' : 'Requirements'}</small>
          <h2>{pt ? 'Do requisito à fonte' : 'From requirement to source'}</h2>
          <p>
            {pt
              ? 'Clique em um destaque para ver o apontamento e abrir a referência oficial. Mudanças relevantes invalidam evidências e aprovações antigas.'
              : 'Select a highlight to see the finding and open the official reference. Relevant changes invalidate old evidence and approvals.'}
          </p>
          <ul>
            {checks.map(item => (
              <li key={item}>
                <Check size={15} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <LandingRequirements language={language} />
      </section>
      <section className="public-section public-platform" ref={platform}>
        <div className="public-section-heading">
          <small>{pt ? 'Plataforma' : 'Platform'}</small>
          <h2>{pt ? 'O resto do projeto no mesmo lugar' : 'The rest of the project in one place'}</h2>
        </div>
        <div className="public-feature-grid">
          {features.map(([Icon, title, copy]) => (
            <article key={title}>
              <Icon size={20} />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="public-cta">
        <h2>{pt ? 'Leve a próxima reunião para o Norte' : 'Bring your next meeting to Norte'}</h2>
        <p>
          {pt
            ? 'Crie uma conta, monte a equipe e abra a primeira sala.'
            : 'Create an account, set up your team and open the first room.'}
        </p>
        <div className="public-actions">
          <a className="platform-primary" href={destination}>
            {start}
            <ArrowRight size={17} />
          </a>
          {!signedIn && (
            <a className="public-secondary" href="#/login">
              {pt ? 'Entrar' : 'Sign in'}
            </a>
          )}
        </div>
      </section>
      <footer className="public-footer">
        <Brand language={language} />
        <span>
          {pt ? 'Reuniões, requisitos e evidências de engenharia.' : 'Engineering meetings, requirements and evidence.'}
        </span>
        <nav aria-label={pt ? 'Políticas' : 'Policies'}>
          <a href="#/privacy">{pt ? 'Privacidade' : 'Privacy'}</a>
          <a href="#/terms">{pt ? 'Termos de uso' : 'Terms of use'}</a>
        </nav>
      </footer>
    </main>
  );
}
