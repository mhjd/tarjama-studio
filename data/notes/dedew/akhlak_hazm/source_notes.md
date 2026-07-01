# Dedew - شرح الأخلاق والسير لابن حزم

Checked episodes: 2, 3, 6, 10.

Result:

- Videos are Arabic lectures by Shaykh Muhammad al-Hasan al-Dedew.
- Each checked YouTube description contains `رابط التفريغ النصي`.
- The linked Archive.org files are `.docx` documents and were downloaded under `ground_truth/transcripts/dedew/akhlak_hazm/`.
- Plain text `.txt` versions were extracted with macOS `textutil`.
- `yt-dlp --list-subs` reported no YouTube subtitle tracks for the checked episodes, so these items should be treated as manually transcribed reference text, not timed subtitle ground truth.

Tooling notes:

- System `yt-dlp` was too old and hit YouTube HTTP 403 during media download.
- A local `.venv` was created with `yt-dlp==2026.6.9`.
- Homebrew `ffmpeg` is currently broken because of a missing `x265` dylib, so media conversion used the local `imageio-ffmpeg` binary installed in `.venv`.
