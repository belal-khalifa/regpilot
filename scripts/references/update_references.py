#!/usr/bin/env python3
"""Keeps the chatbot's reference library (Supabase tables reference_sources / reference_chunks) current.

Sources:
  * EU Cosmetics Regulation EC 1223/2009: the newest consolidated text, asked for each run from the
    EU Publications Office's open-data service (Cellar). Loaded only when a newer version exists.
  * Dubai Municipality guidelines: the PDFs at the top level of the private Supabase storage bucket
    "reference-documents". A file is (re)loaded when it is new or its content changed; a source whose
    file was removed is removed from the library.

Each document is cut into passages (one per article, annex entry or guideline section), each passage
gets an embedding from Gemini, and the passages replace the old ones in one step
(finish_reference_load), so the chatbot never sees a half-loaded document.

Runs on GitHub Actions (.github/workflows/reference-update.yml). Needs SUPABASE_URL,
SUPABASE_SERVICE_KEY and GEMINI_API_KEY; without them it explains and exits without doing anything.
When something changed it writes a short report to $REPORT_FILE for the workflow to open as an issue.

  python3 scripts/references/update_references.py            # normal run
  python3 scripts/references/update_references.py --force    # reload everything
  python3 scripts/references/update_references.py --dry-run --eu-file X.html --dm-dir DIR
                                                              # parse local files only, print passages
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import date

EU_SOURCE_ID = 'eu-1223-2009'
EU_TITLE = 'Regulation (EC) No 1223/2009 on cosmetic products (consolidated text)'
SPARQL_URL = 'https://publications.europa.eu/webapi/rdf/sparql'
CELLAR_URL = 'https://publications.europa.eu/resource/cellar/'
BUCKET = 'reference-documents'
EMBED_MODEL = 'gemini-embedding-001'
EMBED_DIMENSIONS = 768
EMBED_BATCH = 50
# Passages longer than this are split; the embedding model reads up to about 2,000 tokens.
MAX_WORDS = 450
XHTML = '{http://www.w3.org/1999/xhtml}'

REPORT_FILE = os.environ.get('REPORT_FILE', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')


# ---------------------------------------------------------------- HTTP

def http(method, url, body=None, headers=None, raw=False, tries=5):
    """Small HTTP helper with retries on rate limits and server errors."""
    data = None
    headers = dict(headers or {})
    if body is not None and not isinstance(body, (bytes, bytearray)):
        data = json.dumps(body).encode()
        headers.setdefault('Content-Type', 'application/json')
    elif body is not None:
        data = bytes(body)
    for attempt in range(tries):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                content = res.read()
                if raw:
                    return content
                return json.loads(content) if content else None
        except urllib.error.HTTPError as err:
            detail = err.read()[:400].decode(errors='replace')
            if err.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                wait = 20 * (attempt + 1) if err.code == 429 else 5 * (attempt + 1)
                print(f'  {err.code} from {url.split("?")[0]}, retrying in {wait} s')
                time.sleep(wait)
                continue
            raise RuntimeError(f'{method} {url.split("?")[0]} failed: {err.code} {detail}') from None
        except urllib.error.URLError as err:
            if attempt < tries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f'{method} {url.split("?")[0]} failed: {err.reason}') from None


def supabase_headers(extra=None):
    headers = {'apikey': SUPABASE_KEY}
    # A legacy service_role key is a JWT and also goes in Authorization; a new secret key does not.
    if SUPABASE_KEY.startswith('eyJ'):
        headers['Authorization'] = f'Bearer {SUPABASE_KEY}'
    headers.update(extra or {})
    return headers


def rest(method, path, body=None, extra_headers=None):
    return http(method, f'{SUPABASE_URL}/rest/v1/{path}', body, supabase_headers(extra_headers))


def rest_all(path):
    """Reads every row of a query, page by page."""
    rows, start = [], 0
    while True:
        page = rest('GET', path, extra_headers={'Range': f'{start}-{start + 999}'}) or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        start += 1000


# ---------------------------------------------------------------- text helpers

def clean(text):
    # Drop the consolidation markers (►M54, ▼B, ◄) and bidi control characters, squeeze spaces.
    text = re.sub(r'[►▼]\s*[A-Z]\d*', ' ', text)
    text = text.replace('◄', ' ')
    text = re.sub('[‎‏‪-‮]', '', text)
    return ' '.join(text.split())


def split_long(label, text):
    """Splits a long passage into parts of at most MAX_WORDS words, on sentence ends where possible."""
    words = text.split()
    if len(words) <= MAX_WORDS:
        return [(label, text)]
    sentences = re.split(r'(?<=[.;:])\s+', text)
    parts, current = [], []
    for sentence in sentences:
        n = len(sentence.split())
        if current and sum(len(s.split()) for s in current) + n > MAX_WORDS:
            parts.append(' '.join(current))
            current = []
        if n > MAX_WORDS:
            sw = sentence.split()
            for i in range(0, len(sw), MAX_WORDS):
                parts.append(' '.join(sw[i:i + MAX_WORDS]))
            continue
        current.append(sentence)
    if current:
        parts.append(' '.join(current))
    return [(f'{label} (part {i + 1} of {len(parts)})', part) for i, part in enumerate(parts)]


# ---------------------------------------------------------------- EU regulation

def latest_eu_version():
    """Returns (celex, cellar id, date) of the newest consolidated version of EC 1223/2009."""
    query = """
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT ?work ?celex ?date WHERE {
  ?work cdm:resource_legal_id_celex ?celex .
  FILTER(STRSTARTS(STR(?celex), "02009R1223"))
  OPTIONAL { ?work cdm:work_date_document ?date }
} ORDER BY DESC(?celex) LIMIT 1"""
    url = SPARQL_URL + '?' + urllib.parse.urlencode({'query': query})
    result = http('GET', url, headers={'Accept': 'application/sparql-results+json'})
    row = result['results']['bindings'][0]
    celex = row['celex']['value']
    cellar_id = row['work']['value'].rsplit('/', 1)[1]
    version_date = row.get('date', {}).get('value') or f'{celex[11:15]}-{celex[15:17]}-{celex[17:19]}'
    return celex, cellar_id, version_date


def download_eu_text(cellar_id):
    return http('GET', f'{CELLAR_URL}{cellar_id}.0001.02/DOC_1', headers={'Accept': 'application/xhtml+xml'}, raw=True)


def eu_passages(xhtml_bytes):
    """Cuts the consolidated regulation into passages: one per article, one per entry of Annexes
    III to VI, Annex II entries in groups of 20 numbers, and Annexes I, VII and the annex preamble as text."""
    root = ET.fromstring(xhtml_bytes)
    container = root.find(f'.//{XHTML}div[@class="eli-container"]')
    if container is None:
        raise RuntimeError('EU text has no eli-container; the format may have changed')

    def text_of(element):
        return clean(''.join(element.itertext()))

    passages = []
    for article in container.iter(f'{XHTML}div'):
        art_id = article.get('id') or ''
        if article.get('class') == 'eli-subdivision' and re.fullmatch(r'art_\d+[a-z]?', art_id):
            body = text_of(article)
            number = art_id[4:]
            passages += split_long(f'Article {number}', body)

    # Walk the annexes in document order. Tables of Annexes II-VI become entries; other annex text
    # (Annex I, the preamble to the annexes, Annex VII) is kept as running text.
    annex = None
    annex_text = {}
    tables = {}
    in_table = set()
    for element in container.iter():
        if element.get('class') == 'title-annex-1':
            annex = text_of(element).replace('ANNEX', 'Annex')
            annex_text.setdefault(annex, [])
            continue
        if annex is None:
            continue
        if element.tag == f'{XHTML}table':
            tables.setdefault(annex, []).append(element)
            in_table.update(element.iter())
        elif element.tag == f'{XHTML}p' and element not in in_table:
            annex_text[annex].append(text_of(element))

    entry_annexes = ['Annex II', 'Annex III', 'Annex IV', 'Annex V', 'Annex VI']
    for name in ['Annex I', 'Preamble to Annexes II to VI', 'Annex VII']:
        body = ' '.join(t for t in annex_text.get(name, []) if t)
        if body:
            passages += split_long(name, body)

    for name in entry_annexes:
        if name not in tables:
            raise RuntimeError(f'EU text has no table for {name}; the format may have changed')
        table = tables[name][-1]
        rows = table.findall(f'.//{XHTML}tr')
        header1 = [text_of(td) for td in rows[0].findall(f'{XHTML}td')]
        header2 = [text_of(td) for td in rows[1].findall(f'{XHTML}td')]
        entries = []  # (reference number, [cell texts])
        for row in rows[2:]:
            cells = [text_of(td) for td in row.findall(f'{XHTML}td')]
            if not cells:
                continue
            if re.fullmatch(r'\d+[a-z]?', cells[0]):
                entries.append((cells[0], cells))
            elif entries and not all(re.fullmatch(r'[a-j]', c) for c in cells if c):
                entries[-1][1].extend(c for c in cells if c)  # continuation row of a split entry
        labels = [header1[0]] + header2
        if len(header1) > 2:
            labels.append(header1[-1])

        def describe(ref, cells):
            if len(cells) < 3:
                return None  # deleted entry
            # The first row of an entry has one cell per column; rows that continue a split entry
            # (other product types, further conditions) follow without column names.
            parts = [f'{label}: {value}' for label, value in zip(labels[1:], cells[1:len(labels)]) if value]
            if len(cells) > len(labels):
                parts.append('Further rows: ' + '; '.join(cells[len(labels):]))
            return f'{name}, entry {ref}. ' + '; '.join(parts)

        if name == 'Annex II':
            groups = {}
            for ref, cells in entries:
                line = describe(ref, cells)
                if line:
                    start = int(re.match(r'\d+', ref).group()) // 20 * 20
                    groups.setdefault(start, []).append(line)
            for start, lines in sorted(groups.items()):
                label = f'Annex II (prohibited substances), entries {max(start, 1)}-{start + 19}'
                passages.append((label, '\n'.join(lines)))
        else:
            for ref, cells in entries:
                line = describe(ref, cells)
                if line:
                    passages += split_long(f'{name}, entry {ref}', line)
    return passages


# ---------------------------------------------------------------- Dubai Municipality guidelines

def fix_arabic(text):
    """pdftotext writes the lam-alef ligature with its letters swapped; repair the common cases."""
    text = re.sub('ا([إأآ])ل', r'ال\1', text)                  # اإلرشادات -> الإرشادات
    text = re.sub(r'(?<![؀-ۿ])لال', 'للا', text)       # لالستخدام -> للاستخدام
    text = re.sub(r'(?<=[ب-ي])(?<![وفبكل])ال(?=[؀-ۿ])', 'لا', text)  # السالمة -> السلامة
    return text


def dm_details(file_name):
    """Code, title and version from a DM file name such as
    DM-HSD-GU116-CPCP2_Technical-Guidelines-for-Cosmetic-Personal-Care-Products_V2.1.pdf"""
    stem = file_name.rsplit('.', 1)[0]
    code = re.search(r'GU\d+', stem)
    version = re.search(r'_V-?\s*([\d.]+)$', stem)
    middle = stem.split('_', 1)[1] if '_' in stem else stem
    middle = re.sub(r'_V-?\s*[\d.]+$', '', middle).replace('-', ' ').replace('_', ' ').strip()
    code = code.group() if code else re.sub(r'\W+', '-', stem)[:40]
    return code, f'Dubai Municipality {middle} ({code})', f'V{version.group(1)}' if version else 'unknown'


def dm_passages(pdf_bytes, code):
    with tempfile.NamedTemporaryFile(suffix='.pdf') as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        text = subprocess.run(['pdftotext', tmp.name, '-'], capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    arabic = len(re.findall('[؀-ۿ]', text)) > len(re.findall('[A-Za-z]', text))
    if arabic:
        text = fix_arabic(text)
    pages = [[clean(line) for line in page.split('\n')] for page in text.split('\f')]
    pages = [[line for line in page if line] for page in pages if any(page)]

    # Lines repeated on most pages are headers and footers.
    seen = {}
    for page in pages:
        for line in set(page):
            seen[line] = seen.get(line, 0) + 1
    repeated = {line for line, n in seen.items() if n >= max(3, len(pages) // 2)}

    heading = re.compile(r'^(\d{1,2}(?:[.\-]\d{1,2})*)[.\-]?\s+(\S.{1,90})$')
    # Arabic headings come out of the PDF reversed: "-5" for 5 and "1-5" for 5.1.
    arabic_heading = re.compile(r'^(?:-(\d{1,2})|(\d{1,2})-(\d{1,2}))\s*([\u0600-\u06ff].{1,90})$')
    sections = [['Document details', []]]
    for page in pages:
        if sum(1 for line in page if re.search(r'\.{5,}|…{3,}', line)) >= 3:
            continue  # table of contents
        for line in page:
            if line in repeated or re.search(r'Page \d+ of \d+|صفحة\s*\d+\s*من\s*\d+|\.{5,}|…{3,}', line):
                continue
            match = heading.match(line)
            arabic_match = arabic_heading.match(line) if arabic else None
            if match and not arabic and not re.search(r'\d{2,}\s*$', line) and len(line.split()) <= 14:
                sections.append([f'Section {match.group(1)} {match.group(2)}', []])
            elif arabic_match and len(line.split()) <= 16:
                number = arabic_match.group(1) or f'{arabic_match.group(3)}.{arabic_match.group(2)}'
                sections.append([f'Section {number} {arabic_match.group(4)}', []])
            else:
                sections[-1][1].append(line)

    passages = []
    for label, lines in sections:
        body = ' '.join(lines)
        if len(body.split()) >= 12:
            passages += split_long(f'{code}, {label}', body)
    return passages, 'ar' if arabic else 'en'


# ---------------------------------------------------------------- embeddings and loading

def embed(passages):
    vectors = []
    for i in range(0, len(passages), EMBED_BATCH):
        batch = passages[i:i + EMBED_BATCH]
        body = {'requests': [{
            'model': f'models/{EMBED_MODEL}',
            'content': {'parts': [{'text': text}]},
            'taskType': 'RETRIEVAL_DOCUMENT',
            'title': label,
            'outputDimensionality': EMBED_DIMENSIONS,
        } for label, text in batch]}
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:batchEmbedContents?key={GEMINI_KEY}'
        result = http('POST', url, body, tries=8)
        vectors += [e['values'] for e in result['embeddings']]
        print(f'  embedded {len(vectors)}/{len(passages)}')
        time.sleep(1)  # stay well inside the free tier's per-minute limit
    return vectors


def current_passages(source_id):
    sources = rest('GET', f'reference_sources?id=eq.{source_id}&select=current_load_id') or []
    if not sources or not sources[0]['current_load_id']:
        return {}
    rows = rest_all(f'reference_chunks?source_id=eq.{source_id}&load_id=eq.{sources[0]["current_load_id"]}&select=label,content')
    return {row['label']: row['content'] for row in rows}


def units(passages):
    """Passages broken into comparable units: Annex II groups into single entries."""
    result = {}
    for label, content in passages.items():
        lines = content.split('\n')
        if len(lines) > 1 and all(re.match(r'Annex II, entry \S+\.', line) for line in lines):
            for line in lines:
                result[line.split('.', 1)[0]] = line
        else:
            result[re.sub(r' \(part \d+ of \d+\)$', '', label)] = result.get(re.sub(r' \(part \d+ of \d+\)$', '', label), '') + content
    return result


def describe_changes(old, new):
    old_units, new_units = units(old), units(dict(new))
    added = [k for k in new_units if k not in old_units]
    removed = [k for k in old_units if k not in new_units]
    changed = [k for k in new_units if k in old_units and old_units[k] != new_units[k]]
    lines = []
    for title, keys in (('Added', added), ('Changed', changed), ('Removed', removed)):
        if keys:
            shown = ', '.join(keys[:40]) + (f' and {len(keys) - 40} more' if len(keys) > 40 else '')
            lines.append(f'- {title} ({len(keys)}): {shown}')
    return lines


def load_source(source_id, title, version, version_date, language, url, content_hash, passages):
    old = current_passages(source_id)
    vectors = embed(passages)
    load_id = str(uuid.uuid4())
    rows = [{
        'source_id': source_id, 'load_id': load_id, 'label': label, 'content': text,
        'embedding': '[' + ','.join(f'{v:.6f}' for v in vector) + ']',
    } for (label, text), vector in zip(passages, vectors)]
    for i in range(0, len(rows), 100):
        rest('POST', 'reference_chunks', rows[i:i + 100], {'Prefer': 'return=minimal'})
    rest('POST', 'rpc/finish_reference_load', {
        'p_source_id': source_id, 'p_load_id': load_id, 'p_title': title, 'p_version': version,
        'p_version_date': version_date, 'p_language': language, 'p_url': url, 'p_content_hash': content_hash,
    })
    print(f'  loaded {len(rows)} passages')
    if not old:
        return [f'- First load: {len(rows)} passages']
    return describe_changes(old, passages) or ['- Same entries; wording or layout changed only']


def upload_original(path, content, content_type):
    http('POST', f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}', content,
         supabase_headers({'Content-Type': content_type, 'x-upsert': 'true'}))


# ---------------------------------------------------------------- main

def run(force):
    loaded = {s['id']: s for s in (rest('GET', 'reference_sources?select=id,version,content_hash') or [])}
    report = []

    print('EU regulation: asking the Publications Office for the newest consolidated version')
    celex, cellar_id, version_date = latest_eu_version()
    print(f'  newest is {celex} ({version_date})')
    if force or loaded.get(EU_SOURCE_ID, {}).get('version') != celex:
        xhtml = download_eu_text(cellar_id)
        passages = eu_passages(xhtml)
        print(f'  {len(passages)} passages')
        upload_original(f'eu/{celex}.html', xhtml, 'application/xhtml+xml')
        changes = load_source(EU_SOURCE_ID, EU_TITLE, celex, version_date, 'en',
                              f'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{celex}',
                              hashlib.sha256(xhtml).hexdigest(), passages)
        report.append(f'### {EU_TITLE}\nNew version {celex}, consolidated {version_date}. '
                      f'[EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{celex})\n' + '\n'.join(changes))
    else:
        print('  already loaded')

    print('Dubai Municipality guidelines: checking the reference-documents bucket')
    files = http('POST', f'{SUPABASE_URL}/storage/v1/object/list/{BUCKET}',
                 {'prefix': '', 'limit': 1000, 'sortBy': {'column': 'name', 'order': 'asc'}}, supabase_headers()) or []
    pdfs = [f['name'] for f in files if f.get('id') and f['name'].lower().endswith('.pdf')]
    present = set()
    for name in pdfs:
        code, title, version = dm_details(name)
        source_id = f'dm-{code.lower()}'
        present.add(source_id)
        content = http('GET', f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{urllib.parse.quote(name)}',
                       headers=supabase_headers(), raw=True)
        content_hash = hashlib.sha256(content).hexdigest()
        if not force and loaded.get(source_id, {}).get('content_hash') == content_hash:
            print(f'  {name}: unchanged')
            continue
        print(f'  {name}: loading')
        passages, language = dm_passages(content, code)
        print(f'  {len(passages)} passages ({language})')
        changes = load_source(source_id, title, version, None, language, None, content_hash, passages)
        report.append(f'### {title}\nVersion {version} ({name})\n' + '\n'.join(changes))
    for source_id in loaded:
        if source_id.startswith('dm-') and source_id not in present:
            rest('POST', 'rpc/remove_reference_source', {'p_source_id': source_id})
            report.append(f'### {source_id}\n- Removed: its file is no longer in the reference-documents bucket')
            print(f'  {source_id}: removed')

    if report and REPORT_FILE:
        with open(REPORT_FILE, 'w', encoding='utf-8') as out:
            out.write(f'The chatbot\'s reference library was updated on {date.today().isoformat()}.\n\n'
                      + '\n\n'.join(report) + '\n\nPlease spot-check anything important.\n')
    print('Done:', 'library updated' if report else 'nothing new')


def dry_run(eu_file, dm_dir):
    if eu_file:
        with open(eu_file, 'rb') as f:
            passages = eu_passages(f.read())
        print(f'EU: {len(passages)} passages')
        for label, text in passages[:3] + [p for p in passages if p[0].startswith('Annex III, entry 75')]:
            print(f'--- {label}\n{text[:400]}')
    if dm_dir:
        for name in sorted(os.listdir(dm_dir)):
            if not name.lower().endswith('.pdf'):
                continue
            code, title, version = dm_details(name)
            with open(os.path.join(dm_dir, name), 'rb') as f:
                passages, language = dm_passages(f.read(), code)
            print(f'{title} {version} [{language}]: {len(passages)} passages')
            for label, text in passages[:4]:
                print(f'--- {label}\n{text[:300]}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='reload every source even if unchanged')
    parser.add_argument('--dry-run', action='store_true', help='only parse local files and print passages')
    parser.add_argument('--eu-file')
    parser.add_argument('--dm-dir')
    args = parser.parse_args()
    if args.dry_run:
        dry_run(args.eu_file, args.dm_dir)
        return
    missing = [n for n, v in (('SUPABASE_URL', SUPABASE_URL), ('SUPABASE_SERVICE_KEY', SUPABASE_KEY), ('GEMINI_API_KEY', GEMINI_KEY)) if not v]
    if missing:
        print('Skipped: these secrets are not set yet:', ', '.join(missing))
        return
    run(args.force)


if __name__ == '__main__':
    try:
        main()
    except Exception as err:  # the workflow turns a failure into an issue
        print(f'FAILED: {err}', file=sys.stderr)
        sys.exit(1)
