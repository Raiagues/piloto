"""Compares minutes of different providers on the LYLE meetings: facts, numbers, negations, names, sources, cost and time.

    python3 tests/lyle/compare_minutes.py --saved   free: scores the minutes already saved (baseline)
    python3 tests/lyle/compare_minutes.py --live    paid: generates new minutes with the configured provider

Results stay in novo_teste/resultados/comparacao-provedores, outside Git.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
ARTIFACTS = ROOT / 'novo_teste/resultados/reunioes/artefatos'
FOLDER = ROOT / 'novo_teste/resultados/comparacao-provedores'
MEETINGS = ('LYLE-01', 'LYLE-02', 'LYLE-03')
SAVED_RATES = (0.75, 3.75)  # USD per million tokens of the Gemini runs of October 2026.

NUMBER = re.compile(r'\d+(?:[.,]\d+)?')
NEGATION = re.compile(r'\b(?:não|sem|nunca|nenhum|nenhuma|nem)\b', re.I)
NAME = re.compile(r'(?<=[\w,] )[A-ZÀ-Ú][\wÀ-ú]{2,}')


def ratio(kept, total):
    return kept / total if total else None


def score(source, document):
    """Share of what the source said that survived in the entry written for the same event."""
    events = {event['event_id']: event['text'] for event in source['events']}
    entries = [entry for topic in document['topics'] for entry in topic['entries']]
    written = {}
    for entry in entries:
        written[entry['event_id']] = written.get(entry['event_id'], '') + ' ' + entry['text']
    numbers, negations, names = [0, 0], [0, 0], [0, 0]
    for event_id, text in written.items():
        original = events.get(event_id)
        if original is None:
            continue
        for value in NUMBER.findall(original):
            numbers[1] += 1
            numbers[0] += value in text
        if NEGATION.search(original):
            negations[1] += 1
            negations[0] += bool(NEGATION.search(text))
        for value in NAME.findall(original):
            names[1] += 1
            names[0] += value in text
    return {
        'facts': ratio(len(set(written) & set(events)), len(events)),
        'numbers': ratio(*numbers),
        'negations': ratio(*negations),
        'names': ratio(*names),
        'sources': ratio(sum(entry['event_id'] in events for entry in entries), len(entries)),
    }


def tokens(usage):
    if 'input_tokens' in usage:
        return usage['input_tokens'], usage.get('output_tokens', 0)
    return usage.get('promptTokenCount', 0), usage.get('candidatesTokenCount', 0) + usage.get('thoughtsTokenCount', 0)


def row(name, meeting, source, document, rates):
    entry, exit_ = tokens(document.get('usage_metadata') or {})
    cost = (entry * rates[0] + exit_ * rates[1]) / 1e6 if rates[0] is not None else None
    return {
        'run': name,
        'meeting': meeting,
        **score(source, document),
        'seconds': (document.get('generation_ms') or 0) / 1000,
        'usd': cost,
    }


def sources():
    return {
        meeting: json.loads((ARTIFACTS / f'{meeting}-gemini-candidate.json').read_text(encoding='utf-8'))['source']
        for meeting in MEETINGS
    }


def saved():
    for meeting, source in sources().items():
        yield row(
            'Gemini (salvo)',
            meeting,
            source,
            json.loads((ARTIFACTS / f'{meeting}-minutes.json').read_text(encoding='utf-8')),
            SAVED_RATES,
        )


def live():
    from config import load_settings
    from meetings.engine import llm, minutes

    settings = load_settings()
    if not llm.api_key(settings):
        raise SystemExit('Configure a chave do provedor para gerar novas atas.')
    name = f'{settings.llm_provider} {settings.minutes_model}'
    for meeting, source in sources().items():
        started = time.monotonic()
        document = minutes.generate(source, settings)
        document['generation_ms'] = document.get('generation_ms') or round((time.monotonic() - started) * 1000)
        (FOLDER / f'{name.replace(" ", "-")}-{meeting}.json').write_text(
            json.dumps(document, ensure_ascii=False, indent=1), encoding='utf-8'
        )
        yield row(
            name,
            meeting,
            source,
            document,
            (settings.minutes_input_usd_per_million, settings.minutes_output_usd_per_million),
        )


def percent(value):
    return '—' if value is None else f'{100 * value:.0f}%'


def report(rows):
    lines = [
        '# Comparação de atas por provedor',
        '',
        'Entrada: as três reuniões LYLE já classificadas, em `novo_teste/resultados/reunioes/artefatos/`.',
        'Prompt: `prompts/llm/minutes.md`.',
        'Esperado: cada fato, número, negação, nome e fonte da fala continua na nota da ata do mesmo evento.',
        'Cada coluna é a parte do que a fala disse que continuou. Um traço diz que a reunião não tinha esse tipo de item.',
        '',
        '| Execução | Reunião | Fatos | Números | Negações | Nomes | Fontes | Tempo (s) | Custo (US$) |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ]
    for item in rows:
        cost = '—' if item['usd'] is None else f"{item['usd']:.4f}"
        lines.append(
            f"| {item['run']} | {item['meeting']} | {percent(item['facts'])} | {percent(item['numbers'])} | {percent(item['negations'])} | {percent(item['names'])} | {percent(item['sources'])} | {item['seconds']:.1f} | {cost} |"
        )
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--saved', action='store_true')
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    if not args.saved and not args.live:
        parser.error('Use --saved ou --live.')
    FOLDER.mkdir(parents=True, exist_ok=True)
    table = FOLDER / 'resultados.json'
    previous = json.loads(table.read_text(encoding='utf-8')) if table.exists() else []
    fresh = [*(saved() if args.saved else ()), *(live() if args.live else ())]
    rows = [
        item
        for item in previous
        if (item['run'], item['meeting']) not in {(new['run'], new['meeting']) for new in fresh}
    ] + fresh
    table.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    (FOLDER / 'RELATORIO.md').write_text(report(rows), encoding='utf-8')
    print(report(rows))


if __name__ == '__main__':
    main()
