import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { useAuth } from '../lib/auth';
import type { Language } from '../lib/types';
import { PdfPreview } from './delivery/PdfPreview';

export function ArchivedMeetingView({ meetingId, language }: { meetingId: string; language: Language }) {
  const { api } = useAuth(), pt = language === 'pt';
  const [archive, setArchive] = useState<{ title: string; archiveText: string } | null>(null), [error, setError] = useState(''), [pdf, setPdf] = useState(false);
  const path = `/api/meetings/${encodeURIComponent(meetingId)}/archive/export`;
  useEffect(() => { let active = true; setArchive(null); setError(''); void api<{ archive: { title: string; archiveText: string } }>(`/meetings/${encodeURIComponent(meetingId)}/archive`).then(result => { if (active) setArchive(result.archive); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o arquivo.'); }); return () => { active = false; }; }, [meetingId, api]);
  return <section className="meeting-archive">
    <header><span><FileText size={18} /> {pt ? 'Arquivo da reunião · somente leitura' : 'Meeting archive · read only'}</span>{archive && <nav aria-label={pt ? 'Arquivo' : 'Archive'}><button onClick={() => setPdf(!pdf)}>{pdf ? (pt ? 'Ver texto' : 'View text') : (pt ? 'Ver PDF' : 'View PDF')}</button><a href={`${path}?format=txt`} download><Download size={16} /> TXT</a><a href={`${path}?format=json`} download>JSON</a><a href={`${path}?format=pdf`} target="_blank" rel="noreferrer">PDF</a></nav>}</header>
    {error ? <p role="alert">{error}</p> : !archive ? <p role="status">{pt ? 'Abrindo arquivo…' : 'Opening archive…'}</p> : pdf ? <PdfPreview source={`${path}?format=pdf`} title={archive.title} pt={pt} /> : <pre>{archive.archiveText}</pre>}
  </section>;
}
