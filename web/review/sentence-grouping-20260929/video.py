#!/usr/bin/env python3
"""Offline S1 Sirat render from frozen ASS; no regrouping or provider calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[2]
SOURCE = Path('/home/codex/.tarjama-sirat-grouping-input')
OUTPUT = ROOT/'web/.cache/sentence-grouping-20260929/video-delivery'
VIDEO = 'sirat-episode-4-phrases-S1-high.mp4'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage', choices=['render','verify','clips'])
    a = p.parse_args()
    if shutil.disk_usage(ROOT).free < 17*1024**3:
        raise SystemExit('Insufficient disk margin (17 GiB required)')
    OUTPUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    image = json.loads((LAB/'SELECTION.json').read_text())['image']
    name = 'tarjama-sirat-s1-' + a.stage
    base = ['docker','run','--rm','--init','--name',name,'--network','none','--read-only',
            '--cap-drop','ALL','--security-opt','no-new-privileges=true','--pids-limit','128',
            '--memory','1536m','--cpus','4','--user',f'{os.getuid()}:{os.getgid()}',
            '--tmpfs','/tmp:rw,nosuid,nodev,size=128m','-e','XDG_CACHE_HOME=/tmp/cache',
            '-v',f'{SOURCE}:/input:ro','-v',f'{LAB}:/lab:ro','-v',f'{OUTPUT}:/output',
            '--entrypoint','timeout',image,'-k','10','7200']

    def execute(label, command):
        start = time.monotonic()
        with (OUTPUT/f'{label}.stdout.log').open('wb') as out, (OUTPUT/f'{label}.stderr.log').open('wb') as err:
            try:
                result = subprocess.run(base+command, stdout=out, stderr=err, timeout=7220)
            finally:
                subprocess.run(['docker','rm','-f',name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        record = dict(command=command, image=image, seconds=round(time.monotonic()-start,2), returncode=result.returncode)
        (OUTPUT/f'{label}.run.json').write_text(json.dumps(record, indent=2)+'\n')
        if result.returncode:
            raise SystemExit(f'{label} failed; see private logs')

    ff = ['ffmpeg','-hide_banner','-nostdin','-v','warning','-n','-threads','2',
          '-filter_threads','1','-protocol_whitelist','file,pipe']
    if a.stage == 'render':
        ass = ROOT/'web/.cache/sentence-grouping-20260929/dev-s1/render-validation/subtitles.ass'
        if (OUTPUT/'subtitles.ass').exists():
            raise SystemExit('Existing render: refusing to overwrite evidence')
        shutil.copyfile(ass, OUTPUT/'subtitles.ass')
        execute('render', ff+['-i','/input/source.mp4','-map','0:v:0','-map','0:a:0',
            '-vf','setsar=1,ass=/output/subtitles.ass','-c:v','libx264','-threads','4',
            '-preset','superfast','-crf','23','-pix_fmt','yuv420p','-c:a','copy',
            '-movflags','+faststart','-map_metadata','-1','-progress','/output/render.progress',
            '/output/'+VIDEO])
    elif a.stage == 'verify':
        execute('decode', ff+['-xerror','-i','/output/'+VIDEO,'-map','0:v:0','-map','0:a:0','-f','null','-'])
        execute('probe', ['ffprobe','-v','error','-show_entries',
            'stream=codec_name,width,height,duration:format=duration,size','-of','json','/output/'+VIDEO])
        for label, path in [('source-audio','/input/source.mp4'),('output-audio','/output/'+VIDEO)]:
            execute(label, ff+['-i',path,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'])
        assert (OUTPUT/'source-audio.stdout.log').read_bytes() == (OUTPUT/'output-audio.stdout.log').read_bytes(), 'Audio packets changed'
        probe = json.loads((OUTPUT/'probe.stdout.log').read_text())
        assert abs(float(probe['format']['duration'])-3612.829) < 0.1
        assert any(s.get('width') == 1920 and s.get('height') == 1080 and s.get('codec_name') == 'h264' for s in probe['streams'])
        digest = hashlib.file_digest((OUTPUT/VIDEO).open('rb'),'sha256').hexdigest()
        (OUTPUT/'video.sha256').write_text(digest+'  '+VIDEO+'\n')
    else:
        for label, second, duration in [('extrait-10m18-phrase-entiere',618,18),
                                        ('extrait-39m10-articulations',2350,26)]:
            execute(label, ff+['-ss',str(second),'-i','/output/'+VIDEO,'-t',str(duration),
                '-map','0:v:0','-map','0:a:0','-c:v','libx264','-threads','2',
                '-preset','superfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac',
                '-b:a','128k','-movflags','+faststart','-map_metadata','-1',
                '/output/'+label+'.mp4'])
            execute(label+'-decode', ff+['-xerror','-i','/output/'+label+'.mp4',
                '-map','0:v:0','-map','0:a:0','-f','null','-'])
        execute('frame-final', ff+['-ss','624','-i','/output/'+VIDEO,
            '-frames:v','1','-update','1','/output/frame-final.png'])
    print(f'{a.stage}: completed; {OUTPUT}', flush=True)


if __name__ == '__main__':
    main()
