import { ArrowLeft, ChevronRight, UsersRound, MessageSquare, CreditCard, Compass } from 'lucide-react';
import { LanguageToggle } from './LanguageToggle';
import { UserBadge } from './UserBadge';
import type { Language } from '../lib/types';

export function AppHeader({ language, title, onHome, onLanguageChange, canManageTeams }: { language: Language; title: string; onHome?: () => void; onLanguageChange: (language: Language) => void; canManageTeams: boolean }) {
  return <header className="app-header">
    <nav aria-label={language === 'pt' ? 'Localização' : 'Location'}>
      {onHome && <button type="button" onClick={onHome} aria-label={language === 'pt' ? 'Voltar à página anterior' : 'Back to previous page'}><ArrowLeft size={18} /></button>}
      <span className="app-header-brand">NORTE</span>{title && <><ChevronRight size={14} /><span className="app-header-title">{title}</span></>}
    </nav>
    <div className="app-header-account"><nav className="platform-shortcuts" aria-label={language === "pt" ? "Conta e colaboração" : "Account and collaboration"}><a href="#/guide" aria-label={language === "pt" ? "Guia do projeto" : "Project guide"} title={language === "pt" ? "Guia do projeto" : "Project guide"}><Compass size={18} /></a><a href="#/people" aria-label={language === "pt" ? "Pessoas" : "People"} title={language === "pt" ? "Pessoas" : "People"}><UsersRound size={18} /></a><a href="#/messages" aria-label={language === "pt" ? "Mensagens" : "Messages"} title={language === "pt" ? "Mensagens" : "Messages"}><MessageSquare size={18} /></a><a href="#/plans" aria-label={language === "pt" ? "Planos" : "Plans"} title={language === "pt" ? "Planos" : "Plans"}><CreditCard size={18} /></a></nav><LanguageToggle language={language} onChange={onLanguageChange} /><UserBadge language={language} connectedLabel={language === 'pt' ? 'Conectado' : 'Connected'} canManageTeams={canManageTeams} /></div>
  </header>;
}
