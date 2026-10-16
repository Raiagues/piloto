import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId(), ref = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function show() { const r = ref.current?.getBoundingClientRect(); if (r) setPosition({ left: Math.max(12, Math.min(r.left - 100, window.innerWidth - 284)), top: r.bottom + 8 }); }
  return <span className="info-tip" onMouseEnter={show} onMouseLeave={() => setPosition(null)}>
    <button ref={ref} type="button" aria-label={label} aria-describedby={position ? id : undefined} onFocus={show} onBlur={() => setPosition(null)} onClick={show} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setPosition(null); } }}><Info size={15} /></button>
    {position && createPortal(<span className="info-tip-content" id={id} role="tooltip" style={position}>{children}</span>, document.body)}
  </span>;
}
