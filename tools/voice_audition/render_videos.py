"""Reuse finished audition takes; documentary mix, natural voice, word-aligned web captions."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import wave

from server import ROOT, DEFAULT_DB, initialize, connect, state
from benchmarks import voice_folder

sys.path.insert(0,str(ROOT/'web/cli'))
from align_subtitles import WhisperAligner, aligned_rows, readable_ends
from main import preview_command
from subtitle_audio import energy_regions
from tts_export import Paragraph, file_hash, probe
from web_subtitles import remap_segments
from workspace import CLIError, locked, read_json, write_json, load_project, atomic_write

PROJECT = ROOT/'data/workspaces/tts-logique-desktop'


def align_captions(raw, video, aligner):
    plan, timing = read_json(raw/'plan.json'), read_json(video/'timing.json')
    groups = [Paragraph(**p) for p in plan['paragraphs']]
    mapped = [Paragraph(**p) for p in timing['paragraphs']]
    rows = remap_segments(load_project(PROJECT,translated=True),groups,timing['pieces'])
    by_id = {r['id']:r for r in rows}
    aligned, energy = [], []
    for i,(group,placement) in enumerate(zip(groups,mapped)):
        audio = raw/f'{i:04d}-raw.wav'
        digest = file_hash(audio)
        if digest != timing['raw_sha256'][i]: raise CLIError('Prise brute modifiée.')
        with wave.open(str(audio)) as wav: duration = wav.getnframes()/wav.getframerate()
        cache = video/f'aligned-{i:04d}.json'
        if cache.exists():
            result = read_json(cache)
            if result['raw_sha256'] != digest: raise CLIError('Cache aligné différent.')
        else:
            result = aligner.align(audio,group.text,video/f'align-analysis-{i:04d}.wav',duration)
            result['raw_sha256'] = digest
            write_json(cache,result)
        aligned.extend(aligned_rows([by_id[sid] for sid in group.ids],group,placement,result['words'],duration))
        energy.append(energy_regions(audio))
    aligned = readable_ends(aligned,groups,mapped,energy)
    write_json(video/'aligned-segments.json',aligned)
    request = {'kind':'subtitles','segments':aligned,'width':plan['media']['width'],'height':plan['media']['height']}
    process = subprocess.run([str(ROOT/'web/.cache/local-api')],input=json.dumps(request),text=True,capture_output=True,timeout=60)
    response = json.loads(process.stdout)
    if process.returncode or response.get('error'): raise CLIError('Rendu des sous-titres impossible.')
    for key in ('ass','srt'): atomic_write(video/f'subtitles.{key}',response['result'][key].encode())
    write_json(video/'caption-method.json',{'method':'whisper-base-known-text-readable-ends','engine_sha256':file_hash(ROOT/'web/cli/align_subtitles.py'),
                                         'raw_hashes':timing['raw_sha256'],'segments':len(aligned)})


def main(database):
    initialize(database)
    voices = [v for v in state(database)['voices'] if v['decision']=='keep']
    aligner = None
    failed = 0
    lock_directory = database.parent/'video-render-lock'
    lock_directory.mkdir(exist_ok=True)
    with locked(lock_directory):
        for voice in voices:
            directory = voice_folder(database,voice['path'])
            raw, output = directory/'raw',directory/'video-v1'
            try:
                print('Vidéo : '+voice['name'],flush=True)
                with connect(database) as db:
                    db.execute("INSERT INTO benchmark_videos(voice_path,status) VALUES (?,'running') ON CONFLICT(voice_path) DO UPDATE SET status='running',error=NULL",(voice['path'],))
                complete = output/'video-complete.json'
                video = output/'audit.mp4'
                if complete.exists():
                    info = read_json(complete)
                    if info['video_sha256'] != file_hash(video): raise CLIError('Vidéo terminée modifiée.')
                else:
                    if not output.exists():
                        # VAD is already installed in the TTS environment; MLX Whisper
                        # lives in ASR. Reuse both rather than installing duplicates.
                        subprocess.run([str(ROOT/'.venv-tts/bin/python'),'-B',str(ROOT/'web/cli/retime_video.py'),
                                        '--export',str(raw),'--output',str(output),'--seconds','300','--speech-intro','--original-db','-24',
                                        '--subtitle-project',str(PROJECT),'--subtitle-timing','voice','--lean'],check=True)
                    elif not (output/'result.json').exists():
                        raise CLIError('Rendu partiel conservé : inspecter video-v1 avant reprise, aucun écrasement automatique.')
                    if aligner is None: aligner = WhisperAligner('base')
                    align_captions(raw,output,aligner)
                    if not video.exists(): preview_command(argparse.Namespace(export=output,seconds=None,credits_file=None,retimed_input=True))
                    info = {'video_sha256':file_hash(video),'video_bytes':video.stat().st_size,
                            'duration_seconds':probe(video)['duration_ms']/1000,'raw_plan_sha256':file_hash(raw/'plan.json'),
                            'french_speed':1,'original_db':-24,'speech_intro':True,'captions':'whisper-base-known-text',
                            'synthetic_narration':True}
                    write_json(complete,info)
                with connect(database) as db:
                    db.execute("UPDATE benchmark_videos SET status='ready',video_bytes=?,video_sha256=?,duration_seconds=?,error=NULL WHERE voice_path=?",
                               (info['video_bytes'],info['video_sha256'],info['duration_seconds'],voice['path']))
                print('Prête : '+voice['name'],flush=True)
            except Exception as exc:
                failed += 1
                with connect(database) as db:
                    db.execute("UPDATE benchmark_videos SET status='error',error=? WHERE voice_path=?",(str(exc)[:1000],voice['path']))
                print('Erreur : '+str(exc),flush=True)
    if failed: raise SystemExit(f'{failed} rendu(s) interrompu(s) ; détails dans benchmark_videos. Les autres sont conservés.')


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=DEFAULT_DB)
    main(parser.parse_args().database)
