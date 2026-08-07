# AppImage Linux

Cette release x86_64 est destinée en priorité à une VM Linux récente. Elle embarque Electron, FFmpeg avec `libass`, `yt-dlp`, les polices de sous-titres et les prompts par défaut.

1. Copie l'AppImage dans la VM.
2. Rends-la exécutable dans les propriétés du fichier ou avec `chmod +x`.
3. Lance-la sans droits administrateur.

L'AppImage n'isole pas l'application à elle seule : c'est la VM qui fournit cette isolation. Conserve un snapshot propre de la VM et ne partage avec elle que les dossiers média nécessaires.
