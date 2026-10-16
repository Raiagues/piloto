import PDFDocument from 'pdfkit';

/** Markdown source remains editable. No external URLs or filesystem paths are fetched. */
export async function renderArtifactPdf(artifact) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: artifact.label, Author: 'Norte Missão' } });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  try {
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#17334a').text(artifact.label).moveDown(.5);
    if (artifact.description) doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(artifact.description).moveDown();
    const lines = artifact.documentText.split(/\r?\n/u);
    let code = false;
    const inline = text => text.replace(/\*\*(.*?)\*\*/gu, '$1').replace(/`([^`]+)`/gu, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu, '$1 ($2)');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) { code = !code; continue; }
      if (!line.trim()) { doc.moveDown(.5); continue; }
      if (doc.y > 730) doc.addPage();
      const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
      const image = /^!\[([^\]]*)\]\((data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+)\)$/u.exec(line);
      if (image) {
        try {
          if (doc.y > 480) doc.addPage();
          doc.image(image[2], { fit: [480, 240] });
          doc.font('Helvetica-Oblique').fontSize(9).text(image[1]).moveDown();
        } catch { doc.font('Helvetica').fontSize(10).text(`[Imagem indisponível: ${image[1]}]`); }
      } else if (heading) {
        if (doc.y > 680) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(Math.max(12, 20 - heading[1].length * 2)).fillColor('#17334a').text(inline(heading[2])).moveDown(.4);
      } else if (!code && line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|\s*$/u.test(lines[i + 1] || '')) {
        const cells = row => row.trim().replace(/^\||\|$/gu, '').split('|').map(inline);
        const rows = [cells(line)];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
        i--;
        const width = rows[0].length;
        doc.font('Helvetica').fontSize(10).fillColor('#111827');
        doc.table({ data: rows.map(row => Array.from({ length: width }, (_, j) => row[j] || '')), maxWidth: 499, rowStyles: index => index === 0 ? { backgroundColor: '#e5edf3' } : {} });
        doc.moveDown(.5);
      } else {
        doc.font(code ? 'Courier' : 'Helvetica').fontSize(code ? 9 : 11).fillColor('#111827').text(inline(line), { lineGap: 3 });
      }
    }
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      doc.switchToPage(page);
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Norte Missão · ${page + 1} / ${range.count}`, 48, 800, { lineBreak: false });
    }
    doc.end();
  } catch (error) { doc.destroy(error); }
  return complete;
}
