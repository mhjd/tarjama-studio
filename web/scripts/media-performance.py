#!/usr/bin/env python3
"""Bounded offline FFmpeg comparison. No API calls, broker, or production volumes."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import subprocess
import time

ROOT = (Path(__file__).resolve().parent / "../..").resolve()


def run(argv, timeout=180):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    start = time.monotonic()
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    seconds = time.monotonic() - start
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    if p.returncode:
        raise RuntimeError(f'{argv[0]} failed: {p.stderr[-3000:]}')
    return seconds, after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime, p


def ff(args):
    return ['ffmpeg', '-hide_banner', '-v', 'error', '-nostdin', '-y', '-threads', '2', '-filter_threads', '1', *args]


def stats():
    path = Path('/sys/fs/cgroup/cpu.stat')
    return dict((k, int(v)) for k, v in (line.split() for line in path.read_text().splitlines())) if path.exists() else {}


def inside(mode, cpus):
    os.chdir('/results')
    if mode == 'prepare':
        Path('subtitles.ass').write_text('''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,3,2,0,2,60,60,55,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:07.00,Default,,0,0,0,,Voici une phrase française, avec des accents.
Dialogue: 0,0:00:07.00,0:00:14.00,Default,,0,0,0,,Deuxième sous-titre : vérifier la lisibilité.
Dialogue: 0,0:00:14.00,0:00:30.00,Default,,0,0,0,,Dernière phrase — fin du passage.
''', encoding='utf8')
        run(ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25', '-frames:v', '1', '-threads', '1', 'still.png']))
        for name in ['static', 'motion']:
            inp = ['-loop', '1', '-framerate', '25', '-i', 'still.png'] if name == 'static' else ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25']
            run(ff([*inp, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', f'{name}.mp4']))
        if Path('/source.mp4').exists():
            run(ff(['-ss', '30', '-i', '/source.mp4', '-t', '20', '-c', 'copy', 'real.mp4']))
        Path('versions.txt').write_text(run(['ffmpeg', '-version'])[2].stdout)
        return
    # Balanced order across repetitions; sequential runs, never simultaneous encodes.
    variants = [('export-original', 'veryfast', 2, False), ('export-preset', 'superfast', 2, False), ('export-audio', 'veryfast', 2, True), ('export-combined', 'superfast', 2, True)] if cpus == 2 else [('export-4-veryfast', 'veryfast', 4, True), ('export-4-superfast', 'superfast', 4, True)]
    records = []
    for source in ['static', 'motion', 'real']:
        if not Path(f'{source}.mp4').exists():
            continue
        for repeat in range(2):
            for label, preset, threads, audio_copy in (variants if repeat == 0 else list(reversed(variants))):
                output = f'{source}-{label}-{repeat}.mp4'
                audio = ['-c:a', 'copy'] if audio_copy else ['-c:a', 'aac', '-b:a', '128k']
                argv = ff(['-i', f'{source}.mp4', '-t', '20', '-map', '0:v:0', '-map', '0:a:0', '-vf', 'scale=1920:1080,setsar=1,ass=subtitles.ass', '-c:v', 'libx264', '-threads', str(threads), '-preset', preset, '-crf', '23', '-pix_fmt', 'yuv420p', *audio, '-movflags', '+faststart', '-map_metadata', '-1', output])
                pre = stats()
                seconds, cpu, _ = run(argv)
                post = stats()
                record = dict(source=source, variant=label, repeat=repeat, cpus=cpus, wall_seconds=seconds, cpu_seconds=cpu, bytes=Path(output).stat().st_size, cpu_stat_delta={k: post[k]-pre[k] for k in post}, argv=argv)
                # Compare to the decoded source WITH the same subtitles, not to a
                # subtitle-free reference. SSIM is a metric, not a visual verdict.
                _, _, measured = run(ff(['-i', f'{source}.mp4', '-threads', '2', '-i', output, '-t', '20', '-filter_complex_threads', '1', '-lavfi', '[0:v]scale=1920:1080,setsar=1,ass=subtitles.ass,setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[out];[ref][out]ssim=stats_file=ssim.txt', '-an', '-f', 'null', '-']))
                values = [float(v) for v in re.findall(r'All:([\d.]+)', Path('ssim.txt').read_text())]
                record['ssim_mean'] = sum(values)/len(values) if values else None
                records.append(record)
                Path(f'results-{cpus}.json').write_text(json.dumps(records, indent=2)+'\n')
                print(json.dumps({k: record[k] for k in ['source', 'variant', 'repeat', 'wall_seconds', 'bytes', 'ssim_mean']}), flush=True)
            if cpus == 2:
                for label, codecs in [('normalize-original', ['-vf', 'scale=1920:1080,setsar=1', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']), ('normalize-remux', ['-c', 'copy'])]:
                    output = f'{source}-{label}-{repeat}.mp4'
                    argv = ff(['-i', f'{source}.mp4', '-map', '0:v:0', '-map', '0:a:0', *codecs, '-movflags', '+faststart', '-map_metadata', '-1', output])
                    seconds, cpu, _ = run(argv)
                    records.append(dict(source=source, variant=label, repeat=repeat, cpus=cpus, wall_seconds=seconds, cpu_seconds=cpu, bytes=Path(output).stat().st_size, argv=argv))
                    Path(f'results-{cpus}.json').write_text(json.dumps(records, indent=2)+'\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inside', choices=['prepare', 'measure'])
    p.add_argument('--cpus', type=int, default=2, choices=[2, 4])
    p.add_argument('--source', type=Path, help='Optional authorized local MP4 sample, mounted read-only; only 20 s used')
    a = p.parse_args()
    if a.inside:
        inside(a.inside, a.cpus)
        return
    if shutil.disk_usage(ROOT).free < 4*1024**3:
        raise SystemExit('At least 4 GiB free required')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    dest = ROOT/'web/.cache/media-performance'/stamp
    dest.mkdir(parents=True, mode=0o700)
    image_id = subprocess.check_output(['docker', 'image', 'inspect', 'tarjama-web-tools:test', '--format', '{{.Id}}'], text=True).strip()
    (dest/'host.json').write_text(json.dumps({'logical_cpus': os.cpu_count(), 'started_utc': stamp, 'source': str(a.source) if a.source else None, 'source_sha256': hashlib.sha256(a.source.read_bytes()).hexdigest() if a.source else None, 'tools_image_id': image_id, 'note': 'Offline local containers only. No production profile changes.'}, indent=2))
    for mode, cpus in [('prepare', 2), ('measure', 2), ('measure', 4)]:
        name = f'tarjama-perf-{stamp.lower()}-{mode}-{cpus}'
        cmd = ['docker', 'run', '--rm', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--user', f'{os.getuid()}:{os.getgid()}', '--cpus', str(cpus), '--memory', '1536m', '--pids-limit', '128', '--tmpfs', '/tmp:rw,nosuid,nodev,size=96m', '-v', f'{Path(__file__).resolve()}:/bench.py:ro', '-v', f'{dest}:/results']
        if a.source:
            cmd += ['-v', f'{a.source.resolve()}:/source.mp4:ro']
        # Timeout INSIDE the container survives disappearance of this launcher.
        cmd += ['--entrypoint', 'timeout', image_id, '-k', '5', '900', 'python3', '/bench.py', '--inside', mode, '--cpus', str(cpus)]
        try:
            subprocess.run(cmd, check=True, timeout=920)
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    print(f'Artifacts: {dest}', flush=True)


if __name__ == '__main__':
    main()
