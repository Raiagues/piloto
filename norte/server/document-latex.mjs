import { zipSync, strToU8 } from 'fflate';

const symbols = { '≥': '\\ensuremath{\\geq}', '≤': '\\ensuremath{\\leq}', '±': '\\ensuremath{\\pm}', '→': '\\ensuremath{\\rightarrow}', '×': '\\ensuremath{\\times}', '°': '\\ensuremath{^\\circ}' };
const escaped = value => String(value ?? '').replace(/[\\{}$&#_%~^≥≤±→×°]/gu, char => (symbols[char] || { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[char] || `\\${char}`));
const inline = value => escaped(value).replace(/\*\*([^*]+)\*\*/gu, '\\textbf{$1}').replace(/`([^`]+)`/gu, '\\texttt{$1}');

/** Export content as text: user prose never becomes executable TeX commands. */
export function documentLatex(document) {
  const lines = String(document.body || '').split('\n'), body = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { body.push('\\end{itemize}'); listOpen = false; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], heading = /^(#{1,3})\s+(.+)/u.exec(line);
    if (heading) {
      closeList();
      if (index === 0 && heading[2] === document.title) continue;
      body.push(`\\${['section', 'subsection', 'subsubsection'][heading[1].length - 1]}*{${inline(heading[2])}}`);
    } else if (/^\s*[-*]\s+/u.test(line)) {
      if (!listOpen) { body.push('\\begin{itemize}'); listOpen = true; }
      body.push(`\\item ${inline(line.replace(/^\s*[-*]\s+/u, ''))}`);
    } else if (/^\|/u.test(line.trim()) && /^\|?\s*:?-+/u.test(lines[index + 1]?.trim() || '')) {
      closeList();
      const row = text => text.trim().replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim());
      const headings = row(line), columns = headings.length;
      body.push(`\\begin{longtable}{${Array(columns).fill(`p{${(0.88 / columns).toFixed(3)}\\linewidth}`).join('')}}`, '\\toprule', `${headings.map(cell => `\\textbf{${inline(cell)}}`).join(' & ')} \\\\`, '\\midrule\\endhead');
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = row(lines[index]);
        body.push(`${headings.map((_, column) => inline(cells[column] || '')).join(' & ')} \\\\`);
        index++;
      }
      index--;
      body.push('\\bottomrule\\end{longtable}');
    } else {
      closeList();
      body.push(line.trim() ? `${inline(line)}\n` : '');
    }
  }
  closeList();
  const status = document.status === 'approved' ? 'Aprovado' : document.status === 'in_review' ? 'Em revisão' : 'Rascunho';
  return String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=25mm]{geometry}
\usepackage{lmodern,longtable,booktabs,xcolor,hyperref,fancyhdr}
\definecolor{norte}{HTML}{795638}
\hypersetup{colorlinks=true,urlcolor=norte,linkcolor=norte}
\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\textcolor{norte}{NORTE}}
\fancyhead[R]{\small ${escaped(document.id)} / v${document.version || 1}}
\fancyfoot[C]{\thepage}
\setlength{\parindent}{0pt}\setlength{\parskip}{7pt}
\setlength{\emergencystretch}{3em}
\title{${escaped(document.title)}}
\author{${escaped(document.authorName || 'Norte')}}
\date{${escaped(status)}}
\begin{document}
\maketitle
${body.join('\n')}
\end{document}
`;
}

export function documentLatexArchive(document) {
  const metadata = { id: document.id, version: document.version, status: document.status, updatedAt: document.updatedAt, reference: document.reference || null, taskId: document.taskId || null };
  return Buffer.from(zipSync({
    'main.tex': strToU8(documentLatex(document)),
    'source.md': strToU8(document.body || ''),
    'metadata.json': strToU8(JSON.stringify(metadata, null, 2)),
    'README.txt': strToU8('Compile main.tex com pdfLaTeX. Esta cópia não sincroniza automaticamente com o Norte. A aprovação vigente permanece no controle de versão do Norte.\n')
  }));
}
