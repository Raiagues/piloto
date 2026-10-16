import { List, Network } from 'lucide-react';
import type { Language } from '../lib/types';
export type OrganizationView = 'list' | 'hierarchy';
export function ViewToggle({ value, onChange, language }: { value: OrganizationView; onChange: (value: OrganizationView) => void; language: Language }) {
  return <div className="view-toggle" role="group" aria-label={language === 'pt' ? 'Visualização' : 'View'}><button type="button" aria-pressed={value === 'list'} onClick={() => onChange('list')}><List size={16} />{language === 'pt' ? 'Lista' : 'List'}</button><button type="button" aria-pressed={value === 'hierarchy'} onClick={() => onChange('hierarchy')}><Network size={16} />{language === 'pt' ? 'Organograma' : 'Chart'}</button></div>;
}
