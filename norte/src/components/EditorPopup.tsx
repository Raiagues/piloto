import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Native modal supplies focus containment and restores the trigger on close. */
export function EditorPopup({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!; const trigger = document.activeElement as HTMLElement | null; el.showModal(); return () => { el.close(); trigger?.focus(); }; }, []);
  return <dialog ref={ref} className="editor-popup" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header><h3>{title}</h3><button type="button" aria-label={closeLabel} onClick={onClose}><X size={18} /></button></header>{children}
  </dialog>;
}
