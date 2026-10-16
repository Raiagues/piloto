#!/usr/bin/env python3
"""Download the curated Quetzal-1 sources and retain verifiable local provenance.

Uses only the Python standard library and Poppler (pdfinfo/pdftotext). No LLM,
credentials, benchmark answers, or provider requests are involved. The manifest
describes source material, never a pre-computed engineering model.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[1] / "project-documents" / "quetzal-1"
HOSTS = frozenset({"raw.githubusercontent.com", "gomspace.com", "www.gomspace.com",
                   "www.ti.com", "ti.com", "ww1.microchip.com", "jossonline.com"})
ROLES = frozenset({"project_context", "supporting_datasheet", "license", "evaluation_heldout"})
MAX_BYTES = 64 * 1024 * 1024


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_url(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or p.hostname not in HOSTS or p.username or p.password or p.port not in (None, 443):
        raise ValueError("URL fora do catálogo permitido")
    return url


class SourceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, safe_url(newurl))


def safe_file(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Caminho fora do corpus")
    return path


def xlsx_text(path: Path) -> str:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as z:
        if sum(i.file_size for i in z.infolist()) > MAX_BYTES:
            raise ValueError("Planilha descompactada excede o limite")
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
            strings = ["".join(n.itertext()) for n in tree.findall("m:si", ns)]
        output = []
        for filename in sorted(z.namelist()):
            if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", filename):
                continue
            output.append("Planilha: " + filename)
            tree = ET.fromstring(z.read(filename))
            for row in tree.findall(".//m:row", ns):
                cells = []
                for cell in row.findall("m:c", ns):
                    raw = cell.findtext("m:v", default="", namespaces=ns)
                    if cell.get("t") == "s":
                        raw = strings[int(raw)]
                    elif cell.get("t") == "inlineStr":
                        raw = "".join(cell.find("m:is", ns).itertext())
                    if raw:
                        cells.append(cell.get("r", "") + ": " + raw)
                if cells:
                    output.append(" | ".join(cells))
        return "\n".join(output) + "\n"


def extract(root: Path, record: dict) -> dict:
    source = safe_file(root, record["path"])
    group = "open-license" if record["redistribution"] == "license-terms" else "local-reference"
    target = root / "extracted" / group / (record["id"] + ".txt")
    target.parent.mkdir(parents=True, exist_ok=True)
    pages = None
    if source.suffix.lower() == ".pdf":
        info = subprocess.run(["pdfinfo", str(source)], check=True, capture_output=True, text=True, timeout=60).stdout
        page_count = int(re.search(r"^Pages:\s+(\d+)", info, re.M).group(1))
        raw = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(source), "-"], check=True,
                             capture_output=True, text=True, timeout=120).stdout
        parts = raw.split("\f")
        if len(parts) == page_count + 1 and not parts[-1].strip():
            parts.pop()
        if len(parts) != page_count:
            raise ValueError("Número de páginas extraídas difere do PDF")
        pages = [{"page": i + 1, "text": text} for i, text in enumerate(parts)]
        text = "\n\n".join("[Página " + str(p["page"]) + "]\n" + p["text"] for p in pages)
        record.update(pages=page_count, extraction_method="pdftotext -layout; sem OCR ou interpretação de diagramas",
                      empty_text_pages=[p["page"] for p in pages if len(p["text"].strip()) < 20])
    elif source.suffix.lower() == ".xlsx":
        text = xlsx_text(source)
        record.update(pages=None, extraction_method="XML original da planilha; coordenadas das células preservadas")
    else:
        text = source.read_text(encoding="utf-8-sig")
        record.update(pages=None, extraction_method="Texto UTF-8 original; sem resumo")
    data = text.encode("utf-8")
    target.write_bytes(data)
    record.update(text_path=str(target.relative_to(root)), text_sha256=digest(data), text_size_bytes=len(data),
                  text_characters=len(text))
    if pages is not None:
        target = target.with_suffix(".pages.json")
        data = (json.dumps({"document_id": record["id"], "source_sha256": record["sha256"], "pages": pages},
                           ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        target.write_bytes(data)
        record.update(pages_path=str(target.relative_to(root)), pages_sha256=digest(data))
    return record


def download(root: Path, source: dict, refresh: bool) -> dict:
    if source["role"] not in ROLES:
        raise ValueError("Papel de fonte não permitido")
    if source["role"] == "evaluation_heldout" and root.name != "evaluation-heldout":
        raise ValueError("Fontes de avaliação nunca entram na memória do projeto")
    filename = source["filename"]
    if filename != Path(filename).name:
        raise ValueError("Nome de arquivo inválido")
    group = "open-license" if source["redistribution"] == "license-terms" else "local-reference"
    relative = "licenses/" + filename if source["role"] == "license" else "originals/" + group + "/" + filename
    path = safe_file(root, relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    final_url = source["source_url"]
    if path.exists() and not refresh:
        data = path.read_bytes()
    else:
        opener = urllib.request.build_opener(SourceRedirect())
        req = urllib.request.Request(safe_url(source["source_url"]), headers={"User-Agent": "Norte-local-document-corpus/1.0"})
        with opener.open(req, timeout=45) as response:
            final_url = safe_url(response.url)
            data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("Documento excede 64 MiB")
    sha = digest(data)
    if source.get("expected_sha256") and source["expected_sha256"] != sha:
        raise ValueError("Hash da revisão fixa difere do catálogo")
    if path.suffix.lower() == ".pdf" and not data.startswith(b"%PDF-"):
        raise ValueError("Resposta não contém um PDF")
    if path.suffix.lower() == ".xlsx" and not data.startswith(b"PK"):
        raise ValueError("Resposta não contém uma planilha XLSX")
    if path.suffix.lower() not in (".pdf", ".xlsx"):
        data.decode("utf-8-sig")
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_bytes(data)
    temporary.replace(path)
    record = {**source, "path": relative, "sha256": sha, "size_bytes": len(data), "final_url": final_url,
              "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "downloaded"}
    if source.get("known_sha256") and source["known_sha256"] != sha:
        record["revision_note"] = "Documento mutável atualizado pelo editor; hash anterior difere."
    return extract(root, record) if source["role"] != "license" else record


def verify(root: Path) -> None:
    manifest = json.loads((root / "manifest.json").read_text())
    good = 0
    for record in manifest["sources"]:
        if record["status"] != "downloaded":
            continue
        for path_key, sha_key in (("path", "sha256"), ("text_path", "text_sha256"), ("pages_path", "pages_sha256")):
            if path_key in record and digest(safe_file(root, record[path_key]).read_bytes()) != record[sha_key]:
                raise ValueError("Integridade inválida: " + record[path_key])
        if record["role"] not in ROLES:
            raise ValueError("Papel de fonte não permitido")
        good += 1
    print(f"Integridade verificada: {good} fontes; originais e textos conferidos.")


def write_index(root: Path, manifest: dict) -> None:
    if root.name == "evaluation-heldout":
        lines = ["# Referências reservadas para avaliação", "", "Estes dois artigos são referências de conferência independente. Não entram na memória, no prompt, em exemplos de extração ou em correções automáticas. Não são respostas para copiar ao mapa. A comparação deve distinguir informação ausente nas fontes de entrada de erro de extração.", "", "Os PDFs e textos são cópias locais de consulta, excluídas do Git. Copyright © A. Deepak Publishing; nenhuma permissão de redistribuição foi presumida.", "", "| Referência | Páginas | Arquivos |", "| --- | ---: | --- |"]
        for source in manifest["sources"]:
            lines.append(f"| [{source['title']}]({source['source_url']}) | {source.get('pages') or '—'} | [PDF]({source.get('path','')}) · [Texto]({source.get('text_path','')}) |")
        lines += ["", "Download separado: `python3 scripts/download_project_docs.py --evaluation-only`. Verificação offline: `python3 scripts/download_project_docs.py --evaluation-only --verify`.", ""]
        (root / "README.md").write_text("\n".join(lines), encoding="utf-8")
        return
    lines = ["# Documentos do projeto Quetzal-1", "", "Corpus local para a conta de teste do Norte. Fontes originais da equipe da missão e dos fabricantes; nenhum mapa pré-fabricado ou resposta de benchmark.", "", "Origem: [Universidad del Valle de Guatemala](https://www.uvg.edu.gt/cubesat-en/).", "", "Os PDFs mantêm todas as páginas. Os textos auxiliares preservam a paginação, mas a extração textual não interpreta ligações de esquemas nem imagens; esses casos precisam de revisão visual. Datasheets descrevem componentes, não demonstram desempenho do satélite. Datasheets novos podem diferir da revisão usada em voo.", "", "Arquivos em `local-reference/` são cópias locais de consulta, excluídas do Git. Seus editores mantêm os direitos; nenhuma permissão de redistribuição foi presumida. Documentos de hardware usam CC BY-SA 4.0 e software usa GPL-3.0, conforme as licenças originais em `licenses/`.", "", "| Documento | Páginas | Uso | Original / texto |", "| --- | ---: | --- | --- |"]
    for s in manifest["sources"]:
        if s["role"] == "license":
            continue
        if s["status"] != "downloaded":
            lines.append(f"| [{s['title']}]({s['source_url']}) | — | Download indisponível | Consulte a fonte |")
        else:
            usage = "Memória de teste" if s["default_ingest"] else "Teste opcional de documento longo"
            lines.append(f"| {s['title']} | {s.get('pages') or '—'} | {usage} | [Original]({s['path']}) · [Texto]({s['text_path']}) · [Fonte]({s['source_url']}) |")
    lines += ["", "A conta de validação contém 17 documentos ativos e 2 arquivos de licença; inclui o datasheet ATmega completo de 653 páginas. São aproximadamente 3,34 milhões de caracteres, divididos em 116 trechos com a configuração atual. Os [2 artigos reservados para avaliação](evaluation-heldout/README.md) ficam fora desse conjunto e nunca são enviados ao extrator.", "", "O manifesto registra URL, revisão, licença, hash SHA-256, tamanho, páginas e caminhos. `default_ingest` indica o conjunto inicial; `role=license` não é conteúdo de engenharia.", "", "A leitura é integral e retomável, em rodadas limitadas. Citações e números precisam de comprovação. Depois de duas tentativas, se a última resposta tiver estrutura válida mas uma afirmação sem comprovação, o sistema pode omitir essa afirmação e suas dependências, validar novamente o restante e registrar cada omissão para revisão. Respostas truncadas, arquivos ilegíveis ou grafos estruturalmente inválidos não são publicados como sucesso. Cobertura de 100% significa trechos processados; não garante interpretação perfeita ou ausência de omissões. Esquemas exigem revisão visual da conectividade. Limites absolutos de fabricante não podem alimentar propriedades operacionais: quando a seção original comprova essa condição, a chave e o rótulo precisam identificá-la explicitamente; caso contrário, a propriedade é recusada para correção ou omitida com motivo.", "", "Confirme divergências entre documentos em vez de escolher automaticamente: a BOM EPS e o README de software citam códigos diferentes de medidor de bateria; isso é um ponto de revisão rastreável, não um erro a ocultar.", "", "Reproduzir o download: `python3 scripts/download_project_docs.py`. Conferir sem rede: `python3 scripts/download_project_docs.py --verify`. Atualizar documentos mutáveis deliberadamente: `python3 scripts/download_project_docs.py --refresh`.", "", "Não usar os artigos JoSS EPS/ADCS, `benchmark/quetzal1/evaluation_reference`, expectativas ou relatórios de benchmark como entrada da memória. A separação permite avaliar o projeto sem expor respostas esperadas ao modelo. A avaliação manual aqui não substitui uma validação de engenharia nem certifica segurança de voo.", ""]
    (root / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Conferir hashes locais sem usar rede")
    parser.add_argument("--refresh", action="store_true", help="Baixar novamente as fontes mutáveis")
    parser.add_argument("--evaluation-only", action="store_true", help="Baixar apenas referências de avaliação, isoladas da memória")
    args = parser.parse_args()
    root = ROOT / "evaluation-heldout" if args.evaluation_only else ROOT
    if args.verify:
        verify(root)
        return
    if not shutil.which("pdftotext") or not shutil.which("pdfinfo"):
        raise SystemExit("Instale poppler-utils para preservar todas as páginas dos PDFs.")
    catalog = json.loads((root / "sources.json").read_text())
    records = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        jobs = {executor.submit(download, root, source, args.refresh): source for source in catalog["sources"]}
        for task in concurrent.futures.as_completed(jobs):
            source = jobs[task]
            try:
                record = task.result()
                print(f"OK {source['id']}: {record['size_bytes']} bytes, {record.get('pages') or 'texto'} páginas", flush=True)
            except Exception as error:
                record = {**source, "status": "unavailable", "error": str(error)[:300]}
                print(f"INDISPONÍVEL {source['id']}: {record['error']}", flush=True)
            records[source["id"]] = record
    manifest = {"schema_version": 1, "project": "Quetzal-1", "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "policy": catalog["policy"], "sources": [records[s["id"]] for s in catalog["sources"]]}
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_index(root, manifest)
    verify(root)
    if any(s["status"] != "downloaded" and (s["default_ingest"] or args.evaluation_only) for s in manifest["sources"]):
        raise SystemExit("Algumas fontes iniciais estão indisponíveis; veja o manifesto.")


if __name__ == "__main__":
    main()
