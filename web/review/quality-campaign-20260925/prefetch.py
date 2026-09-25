"""Offline exact-fragment candidate retrieval. No model, no web, no attribution claim."""
import argparse
import json
from pathlib import Path
import subprocess
import unicodedata
import run


def normalized(text):
    text = text.translate(str.maketrans({'أ':'ا','إ':'ا','آ':'ا','ٱ':'ا','ى':'ي','ـ':None}))
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return ' '.join(''.join(c.lower() if c.isalnum() else ' ' for c in text).split())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True)
    a=parser.parse_args();source=json.loads(Path(a.source).read_text())
    queries=[]
    for segment in source:
        text=segment['arabic'].rsplit(':',1)[-1].strip()
        if len(normalized(text).split())>=3:
            queries.append((segment['id'],text))
    raw=''.join(json.dumps({'tool':'quran_fr','arguments':{'arabic_query':text}},ensure_ascii=False)+'\n' for _,text in queries)
    response=subprocess.run([str(run.ROOT/'web/.cache/references'),'--corpus',str(run.CORPUS)],input=raw,text=True,capture_output=True,check=True,timeout=30)
    results=[json.loads(line) for line in response.stdout.splitlines()]
    if len(results)!=len(queries):raise ValueError('missing local result')
    evidence={}
    for (id_,text),result in zip(queries,results):
        entries=[e for e in result.get('entries',[]) if ' '+normalized(text)+' ' in ' '+normalized(e['arabic'])+' ']
        if entries:
            evidence[id_]={'status':'ambiguous','match':'exact_normalized_fragment_candidate',
                'query':text,'version':result['version'],'coverage':result['coverage'],'entries':entries}
    run.save(Path(a.output),evidence)
    print(json.dumps({'matched_segments':len(evidence),'references':sorted({e['reference'] for r in evidence.values() for e in r['entries']})}))


if __name__=='__main__':main()
