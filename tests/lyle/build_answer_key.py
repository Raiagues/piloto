"""Builds the LYLE answer key from the user's PDF: the 13 highlights are PDF annotations, so the expected text is exact.

Run: python3 tests/lyle/build_answer_key.py
Output stays in novo_teste/ (outside Git), with the rest of the user's documents.
"""

import html
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / 'novo_teste/LYLE_transcricoes_com_alertas.pdf'
SCENARIOS = ROOT / 'novo_teste/resultados/reunioes/cenarios/lyle-transcricoes.json'
OUTPUT = ROOT / 'novo_teste/resultados/destaques/gabarito.json'

# Alert -> rule of prompts/jev/questions.js and the times of the statements its comment cites as proof (empty: none).
EXPECTED = {
    'A01': ('regulatory_dismissal', ['00m14s', '00m43s']),
    'A02': ('meaning_conflict', ['01m36s']),
    'A03': ('contradicts_record', ['03m01s']),
    'A04': ('premature_commitment', ['03m59s', '04m21s']),
    'A05': ('unsupported_conclusion', []),
    'A06': ('controlled_transfer', []),
    'A07': ('unsupported_conclusion', ['02m55s']),
    'A08': ('schedule_conflict', ['04m30s']),
    'A09': ('meaning_conflict', ['00m10s']),
    'A10': ('contradicts_record', ['01m39s']),
    'A11': ('status_without_evidence', ['03m01s']),
    'A12': ('status_without_evidence', ['04m22s']),
    'A13': ('status_without_evidence', ['05m17s']),
}


def pdf_highlights():
    raw = PDF.read_bytes().decode('latin1')
    objects = {int(m[1]): m[2] for m in re.finditer(r'(\d+) 0 obj\s(.*?)endobj', raw, re.S)}
    tree = next(body for body in objects.values() if re.search(r'/Type\s*/Pages', body))
    kids = [int(ref) for ref in re.findall(r'(\d+) 0 R', re.search(r'/Kids\s*\[(.*?)\]', tree, re.S)[1])]
    layout = subprocess.run(['pdftotext', '-bbox', str(PDF), '-'], capture_output=True, text=True, check=True).stdout
    pages = re.findall(r'<page width="[\d.]+" height="([\d.]+)">(.*?)</page>', layout, re.S)
    for kid, (height, body) in zip(kids, pages):
        annots = re.search(r'/Annots\s*\[(.*?)\]', objects[kid], re.S)
        if not annots:
            continue
        words = [
            (float(a), float(b), float(c), float(d), html.unescape(w))
            for a, b, c, d, w in re.findall(
                r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', body
            )
        ]
        for ref in re.findall(r'(\d+) 0 R', annots[1]):
            annot = objects[int(ref)]
            if '/Highlight' not in annot:
                continue
            quad = [float(value) for value in re.search(r'/QuadPoints\s*\[(.*?)\]', annot, re.S)[1].split()]
            picked = []
            for at in range(0, len(quad), 8):
                xs, ys = quad[at : at + 8 : 2], quad[at + 1 : at + 8 : 2]
                top, bottom = float(height) - max(ys), float(height) - min(ys)
                picked += sorted(
                    (
                        w
                        for w in words
                        if min(xs) - 1 <= (w[0] + w[2]) / 2 <= max(xs) + 1
                        and top - 1 <= (w[1] + w[3]) / 2 <= bottom + 1
                    ),
                    key=lambda w: w[0],
                )
            yield re.search(r'\((A\d\d)', annot)[1], ' '.join(word[4] for word in picked)


def main():
    scenarios = json.loads(SCENARIOS.read_text(encoding='utf-8'))['scenarios']
    marks = dict(pdf_highlights())
    alerts = []
    for scenario in scenarios:
        turns = {turn['id']: turn for turn in scenario['transcript']}
        for alert in scenario['expected_alerts']:
            rule, proof_times = EXPECTED[alert['id']]
            turn, mark = turns[alert['speech_id']], marks[alert['id']]
            start = turn['text'].index(mark)
            proofs = [item['id'] for item in scenario['transcript'] if item['time'] in proof_times]
            alerts.append(
                {
                    'id': alert['id'],
                    'meeting': scenario['id'],
                    'turn': turn['id'],
                    'time': turn['time'],
                    'speaker': turn['speaker'],
                    'rule': rule,
                    'start': start,
                    'end': start + len(mark),
                    'text': mark,
                    'proofTurns': proofs,
                    'comment': re.sub(r'\s+\d / 7$', '', alert['comment']),
                }
            )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            {
                'source': PDF.name,
                'notice': 'Gabarito derivado das marcações do PDF do usuário. Cenários fictícios; não é validação jurídica.',
                'alerts': alerts,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding='utf-8',
    )
    print(f'{len(alerts)} alertas em {OUTPUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
