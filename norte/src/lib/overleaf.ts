/** Opens a copy of a LaTeX ZIP export in overleaf.com. Nothing done there returns to Norte. */
export async function sendLatexToOverleaf(exportUrl: string, pt: boolean) {
  const response = await fetch(exportUrl, { credentials: 'include' });
  if (!response.ok)
    throw new Error(pt ? 'Não foi possível gerar o pacote LaTeX.' : 'Could not build the LaTeX package.');
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(pt ? 'Não foi possível ler a exportação.' : 'Could not read the export.'));
    reader.readAsDataURL(blob);
  });
  // Overleaf's documented "open in Overleaf" entry point accepts a ZIP as a data URL in snip_uri.
  const form = window.document.createElement('form');
  form.action = 'https://www.overleaf.com/docs';
  form.method = 'POST';
  form.target = '_blank';
  form.rel = 'noopener noreferrer';
  form.hidden = true;
  const input = window.document.createElement('input');
  input.type = 'hidden';
  input.name = 'snip_uri';
  input.value = data;
  form.append(input);
  window.document.body.append(form);
  form.submit();
  form.remove();
}
