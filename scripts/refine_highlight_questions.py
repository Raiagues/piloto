"""Asks the language model for changes to the JEV highlight questions, based on the errors of a LYLE round and on human corrections.

    python3 scripts/refine_highlight_questions.py --round 3 [--corrections correcoes-alertas.json]

Paid and explicit. The proposal is written next to the round to be read by a person: nothing changes prompts/jev/questions.js by itself.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from config import load_settings
from meetings.engine import llm

FOLDER = ROOT / 'novo_teste/resultados/destaques'
SCHEMA = {
    'type': 'object',
    'required': ['changes'],
    'additionalProperties': False,
    'properties': {
        'changes': {
            'type': 'array',
            'items': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['question', 'instructions', 'true', 'false', 'reason'],
                'properties': {
                    name: {'type': 'string'} for name in ('question', 'instructions', 'true', 'false', 'reason')
                },
            },
        }
    },
}


def round_errors(number):
    code = f"""const m=require('./tests/lyle/metrics.cjs'),fs=require('fs');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),folder='novo_teste/resultados/destaques/';
const r=read(folder+'rodada-{number}/resultado.json'),s=m.score(read(folder+'gabarito.json').alerts,r.meetings.flatMap(x=>x.findings),1);
console.log(JSON.stringify({{missed:s.rows.filter(x=>!x.found).map(x=>({{rule:x.alert.rule,sentence:x.alert.text}})),wrongRule:s.rows.filter(x=>x.found&&!x.rightRule).map(x=>({{expected:x.alert.rule,got:x.finding.ruleId,sentence:x.alert.text}})),falseAlarms:s.falseAlarms.map(x=>({{rule:x.ruleId,sentence:x.affectedText}}))}}))"""
    return json.loads(subprocess.run(['node', '-e', code], cwd=ROOT, capture_output=True, text=True, check=True).stdout)


def leaks(change, sentences):
    """A proposal that repeats four words in a row from a meeting would carry that meeting into every other one."""
    written = ' '.join(change[name] for name in ('instructions', 'true', 'false')).lower()
    for sentence in sentences:
        words = re.findall(r'\w+', sentence.lower())
        if any(' '.join(words[at : at + 4]) in written for at in range(len(words) - 3)):
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--round', type=int, required=True)
    parser.add_argument('--corrections', type=Path)
    args = parser.parse_args()
    settings = load_settings()
    if not llm.api_key(settings):
        raise SystemExit('Configure a chave do provedor para pedir a proposta.')
    folder = FOLDER / f'rodada-{args.round}'
    questions = json.loads((folder / 'perguntas.json').read_text(encoding='utf-8'))['highlights']
    errors = round_errors(args.round)
    corrections = json.loads(args.corrections.read_text(encoding='utf-8'))['corrections'] if args.corrections else []
    url, headers, payload = llm.request(
        settings,
        settings.minutes_model,
        llm.prompt('highlight-questions.md'),
        json.dumps({'questions': questions, 'errors': errors, 'human_corrections': corrections}, ensure_ascii=False),
        4096,
        SCHEMA,
        'question_changes',
    )
    with urlopen(
        Request(url, data=json.dumps(payload).encode(), headers=headers, method='POST'), timeout=120
    ) as response:
        reply = llm.answer(settings, json.load(response))
    if not reply['finished']:
        raise SystemExit(f"O provedor não concluiu a resposta ({reply['reason']}). Nada foi salvo.")
    changes = json.loads(reply['text'])['changes']
    sentences = [item['sentence'] for group in errors.values() for item in group] + [
        item['sentence'] for item in corrections
    ]
    kept = [change for change in changes if change['question'] in questions and not leaks(change, sentences)]
    (folder / 'proposta.json').write_text(
        json.dumps(
            {'model': reply['model'], 'rejected': len(changes) - len(kept), 'changes': kept},
            ensure_ascii=False,
            indent=1,
        ),
        encoding='utf-8',
    )
    print(
        f'{len(kept)} mudanças propostas em {folder.relative_to(ROOT)}/proposta.json; {len(changes) - len(kept)} recusadas. Revise antes de copiar para prompts/jev/questions.js.'
    )


if __name__ == '__main__':
    main()
