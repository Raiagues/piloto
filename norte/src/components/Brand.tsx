import { Compass } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="#/landing" aria-label="Norte — página inicial">
      <Compass className="norte-brand-icon" aria-hidden="true" />
      <span>NORTE</span>
    </a>
  );
}
