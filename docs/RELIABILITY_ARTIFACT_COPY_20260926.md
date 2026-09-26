# Copie administrée des preuves de qualification

Demande à exécuter **uniquement après finalisation des manifestes**, sans relancer
de traitement ni modifier les protections. Le compte applicatif ne possède pas
de capacité générale d'export du PVC. Cette copie ne demande pas d'en ajouter.

Emplacement `atelier`, namespace `preview-atelier`, volume logique `library` :

| Source dans le volume | Destination dans le workspace |
| --- | --- |
| `/storage/ui-review-reliable_short1/artifacts/` | `/home/codex/projects/tarjama-studio/web/.cache/reliability-20260926/short/` |
| `/storage/ui-review-reliable_hour1/artifacts/` | `/home/codex/projects/tarjama-studio/web/.cache/reliability-20260926/hour/` |

Copier uniquement les fichiers ordinaires achevés JSON, PNG, WebM et MP4 de ces
deux dossiers ; exclure les `.part`, ne suivre aucun lien symbolique et conserver
les originaux. Ne copier aucune autre donnée de projet, base, sauvegarde, clé,
cookie ou registre de secrets. Fichiers privés appartenant à `codex`, sans modifier
les permissions du volume ni écraser une copie déjà présente.

Comparer les tailles et SHA-256 aux manifestes de chaque partie, conserver un
rapport de copie et annoncer la destination. Ne pas publier les fichiers dans
`share` : l'agent doit d'abord inspecter les captures et contrôler les MP4, puis
préparer le lot final avec `vps-share`.

Le dossier court est finalisé : `manifest.json` indique PASS ; MP4 High de
27 361 071 octets, SHA-256
`a188552178f106deaebfcde351b774a4860979e13ef5620bedc8beb40a44205c` ;
`parcours-iphone15.webm`, 7 952 733 octets, SHA-256
`67b7eb3a78ab65130ee3baef9d41ffb718d60e94e36af851edb5ef0cfff08701`.

Le dossier long est finalisé (constaté à 11:04:27 UTC) : `manifest.json` conserve l'arrêt du
premier navigateur à 55 minutes ; `suite-manifest.json` indique PASS de la reprise.
Conserver les deux parties et leurs manifestes, sans réécrire le premier résultat.

| Fichier long | Octets | SHA-256 |
| --- | ---: | --- |
| `parcours-pixel6.webm` | 66466072 | `f8662cc8c0ac84d9fd4e45a1fe39b47520e2dbecfe22d67807ac844fa16c529d` |
| `suite-parcours-pixel6.webm` | 23622918 | `75b40a861c0fd22b651db30b97698ebe83ad01fcf8caf91d5e941d2a552cbc42` |
| `suite-tarjama-7TLnx8DIu4c-pixel6-fr-high.mp4` | 286326481 | `bd9dde4a7cbce00dc079d438c275065912afd8a2c2cb393b4507f0cf04edd19a` |

Les fichiers `suite-review-budget-*.json` et `suite-review-diagnostics-*.json`
sont également des preuves finalisées sans secrets et doivent être conservés.
Consulter [le rapport de qualification](LLM_REAL_QUALIFICATION_20260926.md) pour
les limites des contrôles déjà effectués.
