"""Generate the same known French passage for SQLite-selected reference voices.

Reuses web/cli's Qwen generation, validation, batching, hashes and resume logic.
No video rendering, tempo fitting, paid API or project changes.
"""
import argparse
from pathlib import Path
import subprocess
import sys
import time
import wave

from server import ROOT, DEFAULT_DB, initialize, connect, state
from benchmarks import KEY, folder, voice_folder

sys.path.insert(0,str(ROOT / "web/cli"))
from qwen_sample import sample_plan, generate_raw
from qwen_voice import QwenVoice
from tts_export import file_hash, run
from workspace import CLIError, locked, read_json, write_json

SOURCE = ROOT / "exports/logique-desktop-tts-plan"


def main(database):
    initialize(database)
    selection = state(database)
    voices = [v for v in selection["voices"] if v["decision"] == "keep"]
    if not voices:
        raise CLIError("Aucune voix gardée.")
    output = folder(database)
    output.mkdir(parents=True,exist_ok=True)
    with locked(output):
        recipe = {"benchmark_id":KEY,"source_plan_sha256":file_hash(SOURCE/"plan.json"),
                  "seconds":300,"temperature":.3,"seed":20261018,"batch_size":4,
                  "script_sha256":file_hash(Path(__file__)),"natural_audio_only":True}
        manifest=output/"recipe.json"
        if manifest.exists() and read_json(manifest)!=recipe:
            raise CLIError("Recette du benchmark modifiée ; conserver l'ancien dossier et choisir un nouvel identifiant.")
        write_json(manifest,recipe)
        selection_file=output/f"selection-{selection['revision']}.json"
        write_json(selection_file,{"revision":selection["revision"],"voices":[{"path":v["path"]} for v in voices]})
        # All selected voices use the exact same ten complete source paragraphs.
        original=read_json(SOURCE/"plan.json")
        count=next(i+1 for i,p in enumerate(original["paragraphs"]) if p["end_ms"]>=300000)
        with connect(database) as db:
            for voice in voices:
                db.execute("INSERT OR IGNORE INTO benchmarks(benchmark_id,voice_path,status,total_parts) VALUES (?,?,'pending',?)",
                           (KEY,voice["path"],count))
        subprocess.run([str(ROOT/".venv-asr/bin/python"),"-B",str(Path(__file__).with_name("prepare_references.py")),
                        "--database",str(database),"--selection",str(selection_file)],check=True)
        shared = None
        def factory(backend,model,speaker,reference,max_tokens,**kwargs):
            nonlocal shared
            if shared is None:
                shared=QwenVoice(backend,model,speaker,reference,max_tokens,**kwargs)
            else:
                # MLX gets explicit ref_audio/ref_text on every generate call;
                # it stores no voice-specific clone_prompt in this adapter.
                shared.reference=reference
                shared.reference_text=kwargs["reference_text"]
                shared.clone_prompt=None
            return shared
        for index,voice in enumerate(voices):
            directory=voice_folder(database,voice["path"])
            reference=directory/"reference.wav"
            transcript=(directory/"reference.txt").read_text()
            plan=sample_plan(SOURCE,reference,transcript,.3,300,20261018)
            raw=directory/"raw"
            audio=directory/"benchmark.m4a"
            complete=directory/"complete.json"
            if complete.exists():
                metadata=read_json(complete)
                if metadata["audio_sha256"]!=file_hash(audio):
                    raise CLIError("Benchmark audio en cache modifié.")
                if not (raw/"plan.json").is_file() or read_json(raw/"plan.json")!=plan:
                    raise CLIError("Plan du benchmark terminé modifié.")
                with connect(database) as db:
                    db.execute("UPDATE benchmarks SET status='ready',completed_parts=?,duration_seconds=?,audio_sha256=?,audio_bytes=? WHERE benchmark_id=? AND voice_path=?",
                        (count,metadata["duration_seconds"],metadata["audio_sha256"],audio.stat().st_size,KEY,voice["path"]))
                continue
            print(f"Voix clonée {index+1}/{len(voices)} — {voice['name']}",flush=True)
            with connect(database) as db:
                db.execute("UPDATE benchmarks SET status='running',error=NULL WHERE benchmark_id=? AND voice_path=?",(KEY,voice["path"]))
            started=time.monotonic()
            def progress(done,total):
                with connect(database) as db:
                    db.execute("UPDATE benchmarks SET completed_parts=?,total_parts=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE benchmark_id=? AND voice_path=?",
                               (done,total,KEY,voice["path"]))
            try:
                generate_raw(plan,raw,reference,resume=raw.exists(),voice_factory=factory,batch_size=4,on_progress=progress)
                temporary=directory/"benchmark.partial.m4a"
                run(["ffmpeg","-nostdin","-v","error","-y","-i",str(raw/"natural.wav"),"-c:a","aac","-b:a","192k","-movflags","+faststart",
                     "-metadata","comment=Narration synthétique Qwen3-TTS 1.7B, référence CML-TTS enhanced, température 0.3 ; pas un enregistrement authentique du locuteur.",str(temporary)])
                temporary.replace(audio)
                with wave.open(str(raw/"natural.wav")) as wav:
                    duration=wav.getnframes()/wav.getframerate()
                metadata={"audio_sha256":file_hash(audio),"duration_seconds":duration,"generation_seconds":time.monotonic()-started,
                          "raw_plan_sha256":file_hash(raw/"plan.json"),"source_end_ms":plan["source_end_ms"],"reference_sha256":file_hash(reference),
                          "source_voice_path":voice["path"],"raw_audio_sha256":file_hash(raw/"natural.wav")}
                write_json(complete,metadata)
                with connect(database) as db:
                    db.execute("UPDATE benchmarks SET status='ready',completed_parts=?,duration_seconds=?,audio_sha256=?,audio_bytes=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE benchmark_id=? AND voice_path=?",
                               (count,duration,metadata["audio_sha256"],audio.stat().st_size,KEY,voice["path"]))
                print(f"Prêt : voix {voice['speaker']}, {duration:.1f} s",flush=True)
            except Exception as exc:
                with connect(database) as db:
                    db.execute("UPDATE benchmarks SET status='error',error=? WHERE benchmark_id=? AND voice_path=?",(str(exc),KEY,voice["path"]))
                print(f"Essai interrompu pour {voice['speaker']} : {exc}",file=sys.stderr,flush=True)
                # Preserve completed takes and continue the other voices.
        print("Traitement des voix sélectionnées terminé. Vérifier les statuts SQLite.",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database",type=Path,default=DEFAULT_DB)
    args=parser.parse_args()
    main(args.database.resolve())
