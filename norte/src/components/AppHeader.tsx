import { ArrowLeft, ChevronRight, ContactRound, MessageSquare } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { UserBadge } from './UserBadge';
import type { Language } from '../lib/types';

export function AppHeader({ language, title, onHome, onLanguageChange, crumbs = [] }: { language: Language; title: string; onHome?: () => void; onLanguageChange: (language: Language) => void; crumbs?: { label: string; href: string; onClick?: () => void }[] }) {
  const pt = language === 'pt';
  return <header className="app-header">
    <nav aria-label={pt ? 'Localização' : 'Location'}>
      {onHome && <button type="button" onClick={onHome} aria-label={pt ? 'Voltar à página anterior' : 'Back to previous page'}><ArrowLeft size={18} /></button>}
      {crumbs.map((crumb, index) => <span className="app-breadcrumb-segment" key={crumb.href}>{index > 0 && <ChevronRight size={13} />}<a href={crumb.href} onClick={event => { if (crumb.onClick && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); crumb.onClick(); } }}>{crumb.label}</a></span>)}
      {title && <>{crumbs.length > 0 && <ChevronRight className="app-breadcrumb-separator" size={14} />}<span className="app-header-title" aria-current="page">{title}</span></>}
    </nav>
    <div className="app-header-account">
      <nav className="platform-shortcuts" aria-label={pt ? 'Colaboração' : 'Collaboration'}>
        <a href="#/people" aria-label={pt ? 'Contatos' : 'Contacts'} title={pt ? 'Contatos' : 'Contacts'}><ContactRound size={18} /></a>
        <a href="#/messages" aria-label={pt ? 'Mensagens' : 'Messages'} title={pt ? 'Mensagens' : 'Messages'}><MessageSquare size={18} /></a>
      </nav>
      <LanguageToggle language={language} onChange={onLanguageChange} />
      <UserBadge language={language} connectedLabel={pt ? 'Conectado' : 'Connected'} />
    </div>
  </header>;
}
