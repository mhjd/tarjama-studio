#!/usr/bin/env python3
import json
import re
from pathlib import Path


ROOT = Path("data")


AR_DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
TATWEEL = "\u0640"


def normalize_ar(text: str) -> str:
    text = AR_DIACRITICS.sub("", text)
    text = text.replace(TATWEEL, "")
    text = re.sub(r"[إأآا]", "ا", text)
    text = text.replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    text = text.replace("ة", "ه")
    text = re.sub(r"[^\w\s\u0600-\u06ff]", " ", text)
    text = re.sub(r"\d+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def levenshtein(a, b) -> int:
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (ca != cb),
                )
            )
        previous = current
    return previous[-1]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def concat(parts: list[Path]) -> str:
    return "\n".join(read(p) for p in parts if p.exists()).strip()


def metrics(ref: str, hyp: str) -> dict:
    ref_n = normalize_ar(ref)
    hyp_n = normalize_ar(hyp)
    ref_words = ref_n.split()
    hyp_words = hyp_n.split()
    return {
        "ref_chars": len(ref_n),
        "hyp_chars": len(hyp_n),
        "ref_words": len(ref_words),
        "hyp_words": len(hyp_words),
        "wer": levenshtein(ref_words, hyp_words) / max(1, len(ref_words)),
        "length_ratio_chars": len(hyp_n) / max(1, len(ref_n)),
        "length_ratio_words": len(hyp_words) / max(1, len(ref_words)),
    }


def output_text(model: str, ep: str) -> str | None:
    if model == "whisper_large_v3_mlx":
        path = ROOT / "model_outputs" / model / f"dedew_akhlak_hazm_{ep}.txt"
        return read(path) if path.exists() else None
    if model in {"openrouter_gpt_4o_mini_transcribe", "openrouter_gpt_4o_transcribe"}:
        direct = ROOT / "model_outputs" / model / f"dedew_akhlak_hazm_{ep}.txt"
        if direct.exists():
            return read(direct)
        parts = sorted((ROOT / "model_outputs" / model).glob(f"{ep}_part*.txt"))
        if parts:
            return concat(parts)
    return None


def main() -> None:
    episodes = ["ep02", "ep03", "ep06", "ep10"]
    models = [
        "whisper_large_v3_mlx",
        "openrouter_gpt_4o_mini_transcribe",
        "openrouter_gpt_4o_transcribe",
    ]
    out = {}
    for ep in episodes:
        ref = read(ROOT / "ground_truth" / "transcripts" / "dedew" / "akhlak_hazm" / f"{ep}.txt")
        out[ep] = {}
        for model in models:
            hyp = output_text(model, ep)
            if hyp is None:
                continue
            out[ep][model] = metrics(ref, hyp)

    output_path = ROOT / "model_outputs" / "asr_eval_summary.json"
    output_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("episode\tmodel\tWER\tref_words\thyp_words\tlen_ratio")
    for ep, rows in out.items():
        for model, m in rows.items():
            print(
                f"{ep}\t{model}\t{m['wer']:.3f}\t"
                f"{m['ref_words']}\t{m['hyp_words']}\t{m['length_ratio_words']:.2f}"
            )


if __name__ == "__main__":
    main()
