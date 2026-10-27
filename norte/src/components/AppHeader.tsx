import { ArrowLeft, ChevronRight, Menu, MessageSquare, UsersRound } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { RecentWork } from './RecentWork';
import { UserBadge } from './UserBadge';
import type { Language } from '../lib/types';

export type HeaderCrumb = { label: string; href: string; kind?: 'team' | 'project' | 'sector'; onClick?: () => void };
type Props = { language: Language; title: string; userId?: string; onBack?: () => void; onMenu: () => void; onLanguageChange: (language: Language) => void; crumbs?: HeaderCrumb[] };

/** The only page heading: back on the left, then team › project › sector › current area. */
export function AppHeader({ language, title, userId, onBack, onMenu, onLanguageChange, crumbs = [] }: Props) {
  const pt = language === 'pt';
  return <header className="app-header">
    <button type="button" className="header-icon-button app-header-menu" onClick={onMenu} aria-label={pt ? 'Abrir navegação' : 'Open navigation'}><Menu size={19} /></button>
    {onBack && <button type="button" className="app-header-back" onClick={onBack} aria-label={pt ? 'Voltar' : 'Back'} title={pt ? 'Voltar' : 'Back'}><ArrowLeft size={17} /><span>{pt ? 'Voltar' : 'Back'}</span></button>}
    <nav className="app-breadcrumbs" aria-label={pt ? 'Localização' : 'Location'}>
      {crumbs.map(crumb => <span className="app-breadcrumb-segment" data-kind={crumb.kind} key={crumb.href + crumb.label}><a href={crumb.href} title={crumb.label} onClick={event => { if (crumb.onClick && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); crumb.onClick(); } }}>{crumb.label}</a><ChevronRight className="app-breadcrumb-separator" size={14} aria-hidden="true" /></span>)}
      {title && <span className="app-header-title" aria-current="page" title={title}>{title}</span>}
    </nav>
    <div className="app-header-account">
      <div className="platform-shortcuts">
        {userId && <RecentWork key={userId} userId={userId} language={language} />}
        <a className="header-icon-button" href="#/people" aria-label={pt ? 'Pessoas e quem está online' : 'People and who is online'} title={pt ? 'Pessoas e quem está online' : 'People and who is online'}><UsersRound size={18} /><i className="header-presence" aria-hidden="true" /></a>
        <a className="header-icon-button" href="#/messages" aria-label={pt ? 'Mensagens' : 'Messages'} title={pt ? 'Mensagens' : 'Messages'}><MessageSquare size={18} /></a>
      </div>
      <LanguageToggle language={language} onChange={onLanguageChange} />
      <UserBadge language={language} connectedLabel={pt ? 'Conectado' : 'Connected'} />
    </div>
  </header>;
}
