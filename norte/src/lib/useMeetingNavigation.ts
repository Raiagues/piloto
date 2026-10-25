import { useEffect, useRef, useState } from 'react';

export function useMeetingNavigation() {
  const running = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const message = (event: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>('.meetings-frame');
      if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || event.data?.type !== 'norte:meeting-running') return;
      running.current = event.data.running === true;
      if (!running.current) setError('');
    };
    const preventNavigation = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-meeting-safe]')) return;
      if (!running.current || !(event.target instanceof Element) || !event.target.closest('.mission-sidebar button,.mission-sidebar a,.app-header button,.app-header a,.recent-work button')) return;
      event.preventDefault(); event.stopImmediatePropagation(); setError('Encerre ou interrompa a reunião antes de mudar de área.');
    };
    const leaving = (event: BeforeUnloadEvent) => { if (running.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('message', message); window.addEventListener('click', preventNavigation, true); window.addEventListener('beforeunload', leaving);
    return () => { window.removeEventListener('message', message); window.removeEventListener('click', preventNavigation, true); window.removeEventListener('beforeunload', leaving); };
  }, []);
  return { running, error, setError };
}
