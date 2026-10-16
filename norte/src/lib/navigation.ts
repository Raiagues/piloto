/** Only go back inside this app session; a deep link falls back to its collection. */
let currentIndex = 0;
let initialized = false;
export function initializeNavigation() {
  if (initialized) return;
  initialized = true;
  const saved = window.history.state?.norteIndex;
  let sameAppReferrer = false;
  try { sameAppReferrer = new URL(document.referrer).origin === window.location.origin; } catch { /* A direct link has no app referrer. */ }
  currentIndex = Number.isSafeInteger(saved) ? saved : (sameAppReferrer && window.history.length > 1 ? 1 : 0);
  window.history.replaceState({ ...window.history.state, norteIndex: currentIndex }, '', window.location.href);
  window.addEventListener('hashchange', () => {
    const entry = window.history.state?.norteIndex;
    if (Number.isSafeInteger(entry)) currentIndex = entry;
    else { currentIndex++; window.history.replaceState({ ...window.history.state, norteIndex: currentIndex }, '', window.location.href); }
  });
}
export function goBack(fallback = '#/') {
  if (currentIndex > 0) window.history.back();
  else window.location.hash = fallback;
}
