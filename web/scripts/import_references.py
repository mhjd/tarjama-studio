"""Build an immutable local corpus. No credentials, model calls or live writes.

French Quran text is limited by Tanzil's non-commercial translation terms.
Keep raw originals and their notices beside the indexed copy. Hadith Arabic is
the classical text; structured dataset CC0 is not a license for third-party translations.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import re
import urllib.request

REVISION = '1d6365b2d7e97b56627bfdca2c41052877d8a5dd'
ARCHIVE_SHA256 = '13ffb061ea3afbfb009c015d76daf4a5c131fa966574f77ab8c2841a019972d2'
EXPECTED_SHA256 = {
    'fr.hamidullah': '9834cfcd14b506a6c0223d86ac259e896f2bfb44c0823d83d827c27ffea57f03',
    'quran-simple.txt': 'f3268cfe7a400add8a8024fe23368d66f58cc8baa51773fe94e323625c66344b',
    'collections.zip': ARCHIVE_SHA256,
    'HADITH_LICENSE': '532cc19ac5bc80c3fe28a8e36a1189f3128d6d01d9da210590650a77b25398de',
}
SOURCES = {
    'fr.hamidullah': 'https://tanzil.net/trans/fr.hamidullah',
    'quran-simple.txt': 'https://tanzil.net/pub/download/index.php?quranType=simple&outType=txt-2&agree=true',
    'collections.zip': 'https://github.com/Jaguar16/open-hadith-data/releases/download/v1.1.0/collections-json.zip',
    'HADITH_LICENSE': f'https://raw.githubusercontent.com/Jaguar16/open-hadith-data/{REVISION}/DATA_LICENSE.md',
}

def verses(path):
    result = {}
    for line in path.read_text().splitlines():
        if not line or not line[0].isdigit():
            continue
        s, v, text = line.split('|', 2)
        key = f'{int(s)}:{int(v)}'
        if key in result or not text.strip():
            raise ValueError('invalid verse')
        result[key] = text
    if len(result) != 6236:
        raise ValueError('Quran must contain 6236 verses')
    return result

def build(target):
    target.mkdir(parents=True, exist_ok=False)  # Never overwrite a corpus version.
    raw = target / 'originals'; raw.mkdir()
    originals = {}
    for name, url in SOURCES.items():
        with urllib.request.urlopen(url, timeout=60) as response:
            content = response.read(32 * 1024 * 1024 + 1)
        if len(content) > 32 * 1024 * 1024:
            raise ValueError('source too large')
        if hashlib.sha256(content).hexdigest() != EXPECTED_SHA256[name]:
            raise ValueError('source changed; review the edition before importing')
        (raw / name).write_bytes(content)
        originals[name] = {'source': url, 'sha256': hashlib.sha256(content).hexdigest()}
    ar, fr = verses(raw / 'quran-simple.txt'), verses(raw / 'fr.hamidullah')
    if ar.keys() != fr.keys():
        raise ValueError('Quran editions not aligned')
    entries = []
    for ref, text in ar.items():
        s, v = ref.split(':')
        entries.append(dict(collection='quran', reference=ref, arabic=text, french=fr[ref],
            numbering='surah:verse', source_url=f'https://tanzil.net/#trans/fr.hamidullah/{ref}',
            canonical_url=f'https://quran.com/{s}/{v}'))
    coverage = {'quran': dict(count=6236, edition='Tanzil Simple 1.1 + fr.hamidullah (2011-07-18)',
        license='Arabic CC BY 3.0, verbatim only; French non-commercial only: https://tanzil.net/trans/',
        source='https://tanzil.net', complete=True,
        notes='Opening Arabic verses may include the basmala attached by Tanzil; the French verse does not necessarily include it. Match only the words actually spoken. Quran.com does not select the French edition.')}
    omitted = {}
    archive = raw / 'collections.zip'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('release asset changed; review before import')
    with zipfile.ZipFile(archive) as z:
        for name in ('bukhari', 'muslim', 'abudawud', 'riyadussalihin'):
            # Never extract paths supplied by a remote archive.
            info = z.getinfo(name + '.json')
            if info.file_size > 32 * 1024 * 1024:
                raise ValueError('collection too large')
            document = json.loads(z.read(info))
            source = [x for book in document['books'] for x in book['hadiths']]
            if len(source) != document['stats']['total_hadiths']:
                raise ValueError('collection count mismatch')
            omitted[name] = []
            before = len(entries)
            for item in source:
                ref = item['hadith_number']
                url = item['url_source']
                if not re.fullmatch(r'[0-9]+[a-z]?(?:-[0-9]+[a-z]?)?', ref) or url != f'https://sunnah.com/{name}:{ref}':
                    raise ValueError('unqualified reference URL; do not invent a mapping')
                if not item['text_ar'].strip():
                    omitted[name].append(ref); continue
                entries.append(dict(collection=name, reference=ref, arabic=item['text_ar'],
                    numbering='Sunnah reference and variant as recorded by open-hadith-data v1.1.0',
                    source_url=url, canonical_url=url))
            coverage[name] = dict(count=len(entries)-before,
                edition=f'open-hadith-data v1.1.0@{REVISION}; Arabic text only',
                license='Structured data CC0; classical Arabic public domain; English excluded',
                source='https://raw.githubusercontent.com/Jaguar16/open-hadith-data/'+REVISION+'/DATA_LICENSE.md',
                # The release does not certify complete variant coverage.
                complete=False)
    payload = ''.join(json.dumps(e, ensure_ascii=False, separators=(',', ':'))+'\n' for e in entries).encode()
    (target / 'entries.jsonl').write_bytes(payload)
    manifest = dict(version=target.name, sha256=hashlib.sha256(payload).hexdigest(), collections=coverage)
    (target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    provenance = dict(originals=originals, missing_arabic_ids=omitted,
        canonical_links='url_source stored by source dataset; format checked for every entry, content independently spot-checked only',
        canonical_links_checked_on='2026-09-25',
        spot_checks=['bukhari:1', 'abudawud:1', 'riyadussalihin:1'],
        note='Quran.com links identify verses, not the selected French edition. Arabic text is unchanged, including basmala attached by the source to some opening verses. Index normalization is separate. Missing variants and extraction errors remain possible in hadith release; complete=false deliberately.')
    (target / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2)+'\n')
    notice = (raw/'quran-simple.txt').read_text().split('# PLEASE DO NOT REMOVE')[1]
    (target/'NOTICE.txt').write_text('# PLEASE DO NOT REMOVE'+notice+'\nFrench translation terms: https://tanzil.net/trans/ (non-commercial only).\nHadith dataset license: originals/HADITH_LICENSE\n')
    print(json.dumps({'corpus': str(target), 'entries': len(entries), 'collections': coverage}, ensure_ascii=False))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    build(Path(parser.parse_args().output))
