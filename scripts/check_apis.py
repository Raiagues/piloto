#!/usr/bin/env python3
"""Check provider access without printing credentials or meeting data.

Default: authenticated model listing only. --live: small synthetic requests,
using the application adapters; may consume API credits. No production DB writes.
"""
import argparse
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import load_settings


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def probe(label, url, headers):
    try:
        with build_opener(NoRedirect()).open(Request(url, headers=headers), timeout=20) as response:
            json.loads(response.read(2_000_000))
        print(label + ': autenticação confirmada; geração ainda não testada.')
        return True
    except HTTPError as error:
        code = error.code
        error.close()
        action = {401: 'Substitua a chave ou corrija a autenticação.',
                  403: 'Revise as permissões e o acesso do projeto; saldo não garante resolver.',
                  429: 'Confira cota, saldo e limites do provedor.'}.get(code, 'Confira o acesso no painel do provedor.')
        print(f'{label}: HTTP {code}. {action}')
    except (URLError, OSError, ValueError):
        print(label + ': não foi possível consultar o provedor. Confira a conexão.')
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Testar geração com dados sintéticos (consome créditos).')
    args = parser.parse_args()
    try:
        settings = load_settings()
    except (ValueError, OSError):
        print('Configuração inválida. Confira nomes, números e formato do .env.')
        return 1
    print('Atas: ' + settings.gemini_model)
    print('Classificador: ' + settings.jev_model)
    print(f'Limites diários UTC: {settings.minutes_daily_call_limit} organizações de atas; {settings.ai_daily_call_limit} chamadas de agentes / US$ {settings.ai_daily_budget_usd:.2f}.')
    jev_ok = False
    if settings.api_key:
        jev_ok = probe('TypeSafe', 'https://api.typesafe.ai/v1/models', {'Authorization': 'Bearer ' + settings.api_key})
    else:
        print('TypeSafe: configure TYPESAFE_API_KEY.')
    google_ok = False
    if settings.gemini_api_key:
        google_ok = probe('Google', 'https://generativelanguage.googleapis.com/v1beta/models', {'x-goog-api-key': settings.gemini_api_key})
    else:
        print('Google: configure GOOGLE_API_KEY.')
    if not args.live:
        print('Para confirmar geração e contratos: python3 scripts/check_apis.py --live')
        return 0 if jev_ok and google_ok else 1

    from meetings.engine import gemini_minutes
    import server
    if jev_ok:
        try:
            body = {'model': settings.jev_model, 'state': 'Precisamos testar a viga.', 'questions': {
                'test': {'type': 'noul', 'instructions': 'Does the text request a test?'}}}
            result = server.classify(body, settings)
            jev_ok = result['response']['answers']['test']['noul'] >= .5
            print('Jev: ' + ('classificação sintética aprovada.' if jev_ok else 'resposta inesperada.'))
        except server.ProviderError as error:
            jev_ok = False
            print(f'Jev: teste falhou (status {error.status}). Confira o painel TypeSafe.')
    if google_ok:
        source = {'events': [{'event_id': 'E1', 'thread_id': 'T1', 'type': 'hypothesis',
                             'text': 'A rigidez pode causar deformação.'}],
                  'threads': [{'thread_id': 'T1', 'title': 'Rigidez'}], 'relations': [],
                  'run_status': 'done', 'relation_status': 'done'}
        try:
            gemini_minutes.generate(source, settings)
            print('Atas: geração e validação de evidências aprovadas.')
        except gemini_minutes.MinutesError as error:
            google_ok = False
            print(f'Atas: teste falhou ({error.code}, status {error.status}). Confira chave, modelo e cobrança Google.')
    return 0 if jev_ok and google_ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
