import { Compass } from 'lucide-react';
import type { Language } from '../lib/types';

/** The mark always returns to the start page; signed-out visitors see the public start page there. */
export function Brand({ language = 'pt' }: { language?: Language }) {
  return (
    <a className="brand" href="#/" aria-label={language === 'pt' ? 'Norte — início' : 'Norte — home'}>
      <Compass className="norte-brand-icon" aria-hidden="true" />
      <span>NORTE</span>
    </a>
  );
}
