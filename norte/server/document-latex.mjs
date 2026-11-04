import { zipSync, strToU8 } from 'fflate';

const symbols = {
  '≥': '\\ensuremath{\\geq}',
  '≤': '\\ensuremath{\\leq}',
  '±': '\\ensuremath{\\pm}',
  '→': '\\ensuremath{\\rightarrow}',
  '←': '\\ensuremath{\\leftarrow}',
  '↔': '\\ensuremath{\\leftrightarrow}',
  '×': '\\ensuremath{\\times}',
  '°': '\\textdegree{}',
  '≈': '\\ensuremath{\\approx}',
  '≠': '\\ensuremath{\\neq}',
  '∞': '\\ensuremath{\\infty}',
  '−': '\\ensuremath{-}',
  '√': '\\ensuremath{\\surd}',
  µ: '\\ensuremath{\\mu}',
  μ: '\\ensuremath{\\mu}',
  Δ: '\\ensuremath{\\Delta}',
  Ω: '\\ensuremath{\\Omega}',
  α: '\\ensuremath{\\alpha}',
  β: '\\ensuremath{\\beta}',
  γ: '\\ensuremath{\\gamma}',
  δ: '\\ensuremath{\\delta}',
  ε: '\\ensuremath{\\varepsilon}',
  θ: '\\ensuremath{\\theta}',
  λ: '\\ensuremath{\\lambda}',
  π: '\\ensuremath{\\pi}',
  σ: '\\ensuremath{\\sigma}',
  τ: '\\ensuremath{\\tau}',
  φ: '\\ensuremath{\\varphi}',
  ω: '\\ensuremath{\\omega}',
  '\\': '\\textbackslash{}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  '%': '\\%',
};
// pdfLaTeX (Overleaf's default) only knows the characters below; anything else stays visible as its code point instead of stopping the compile.
const SAFE =
  /[\t\u0020-\u007E\u00A0-\u017F\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/u;
const control = char => char.codePointAt(0) < 32 || char === '\u007f';
const escaped = value =>
  Array.from(String(value ?? ''))
    .map(
      char =>
        symbols[char] ??
        (SAFE.test(char)
          ? char
          : control(char)
            ? ''
            : `\\texttt{[U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]}`),
    )
    .join('');
// A leading "[" would be read as the optional argument of \item or of the previous row's \\.
const inline = value =>
  escaped(value)
    .replace(/\*\*([^*]+)\*\*/gu, '\\textbf{$1}')
    .replace(/`([^`]+)`/gu, '\\texttt{$1}')
    .replace(/\bPENDENTE\b/gu, '\\textbf{PENDENTE}')
    .replace(/^\[/u, '{}[');
const url = value => `\\url{${value.replace(/[\\{}]/gu, '').replace(/[%#]/gu, '\\$&')}}`;

/** Exports content as text, so user prose stays out of TeX commands. */
export function documentLatex(document) {
  const lines = String(document.body || '').split('\n'),
    body = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      body.push('\\end{itemize}');
      listOpen = false;
    }
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      heading = /^(#{1,3})\s+(.+)/u.exec(line);
    if (heading) {
      closeList();
      if (index === 0 && heading[2] === document.title) continue;
      body.push(`\\${['section', 'subsection', 'subsubsection'][heading[1].length - 1]}*{${inline(heading[2])}}`);
    } else if (/^https?:\/\/[\x21-\x7E]+$/u.test(line.trim())) {
      closeList();
      body.push(`{\\small${url(line.trim())}}\n`);
    } else if (/^>\s?/u.test(line)) {
      // Template guidance stays visible but reads as an instruction, not as content.
      closeList();
      body.push(`\\begin{quote}\\small\\itshape\\color{guide}${inline(line.replace(/^>\s?/u, ''))}\\end{quote}`);
    } else if (/^\s*[-*]\s+/u.test(line)) {
      if (!listOpen) {
        body.push('\\begin{itemize}');
        listOpen = true;
      }
      const depth = Math.min(3, Math.floor(/^\s*/u.exec(line)[0].length / 2));
      body.push(`\\item ${depth ? `\\hspace*{${depth * 1.2}em}` : ''}${inline(line.replace(/^\s*[-*]\s+/u, ''))}`);
    } else if (/^\|/u.test(line.trim()) && /^\|?\s*:?-+/u.test(lines[index + 1]?.trim() || '')) {
      closeList();
      const row = text =>
        text
          .trim()
          .replace(/^\||\|$/gu, '')
          .split('|')
          .map(cell => cell.trim());
      const headings = row(line),
        columns = headings.length;
      // Narrow columns read better ragged; wide matrices get a smaller font and tighter padding.
      const wide = columns >= 6,
        width = ((wide ? 0.96 : 0.92) - columns * 0.012) / columns;
      if (wide) body.push('{\\footnotesize\\setlength{\\tabcolsep}{3pt}');
      body.push(
        `\\begin{longtable}{${Array(columns)
          .fill(`>{\\raggedright\\arraybackslash\\hspace{0pt}}p{${width.toFixed(3)}\\linewidth}`)
          .join('')}}`,
        '\\toprule',
        `${headings.map(cell => `\\textbf{${inline(cell)}}`).join(' & ')} \\\\`,
        '\\midrule\\endhead',
      );
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = row(lines[index]);
        body.push(`${headings.map((_, column) => inline(cells[column] || '')).join(' & ')} \\\\`);
        index++;
      }
      index--;
      body.push('\\bottomrule\\end{longtable}');
      if (wide) body.push('}');
    } else {
      closeList();
      body.push(line.trim() ? `${inline(line)}\n` : '');
    }
  }
  closeList();
  const status =
    document.status === 'approved' ? 'Aprovado' : document.status === 'in_review' ? 'Em revisão' : 'Rascunho';
  return String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=25mm]{geometry}
\usepackage{lmodern,array,longtable,booktabs,xcolor,hyperref,fancyhdr}
\Urlmuskip=0mu plus 1mu
\expandafter\def\expandafter\UrlBreaks\expandafter{\UrlBreaks\do\-}
\definecolor{norte}{HTML}{795638}
\definecolor{guide}{HTML}{5D6B77}
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
  const metadata = {
    id: document.id,
    version: document.version,
    status: document.status,
    updatedAt: document.updatedAt,
    reference: document.reference || null,
    taskId: document.taskId || null,
  };
  return Buffer.from(
    zipSync({
      'main.tex': strToU8(documentLatex(document)),
      'source.md': strToU8(document.body || ''),
      'metadata.json': strToU8(JSON.stringify(metadata, null, 2)),
      'README.txt': strToU8(
        'Compile main.tex com pdfLaTeX. Esta cópia não sincroniza automaticamente com o Norte. A aprovação vigente permanece no controle de versão do Norte.\n',
      ),
    }),
  );
}
