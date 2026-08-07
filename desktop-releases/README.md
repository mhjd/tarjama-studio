# Desktop releases

Ce dossier contient uniquement les exécutables distribuables de Tarjama Studio :

- `windows/` : exécutable portable Windows x64 ;
- `linux/` : AppImage Linux x64 ;
- `SHA256SUMS` : sommes de contrôle des deux artefacts courants.

Les exécutables sont suivis par Git LFS grâce à `.gitattributes`. Ils ne doivent pas être ajoutés comme blobs Git ordinaires ni téléversés manuellement dans le code source. Les données utilisées pour vérifier une release restent séparées dans `test-fixtures/`.

## Préparation

- Travailler depuis la branche `desktop` et inspecter les changements locaux avant de publier.
- Vérifier que Git LFS est installé avec `git lfs version`.
- Conserver hors du commit les fichiers personnels ou de test sans rapport avec la release.
- Sur macOS, le cross-build réutilise les outils déjà présents dans `ui/desktop-bin/win32-x64/` et `ui/desktop-bin/linux-x64/`. Vérifier notamment leurs sommes et leur architecture avant le build. Ce dossier est généré et ignoré par Git.

## Génération

La commande complète est :

```sh
make desktop-release
```

Elle exécute, dans cet ordre :

1. les tests de sécurité Electron ;
2. la release Windows, qui incrémente automatiquement la version patch dans `ui/package.json` et `ui/package-lock.json` ;
3. la release Linux avec cette même version ;
4. la régénération de `SHA256SUMS`.

Pour reprendre une génération partielle, utiliser dans l'ordre nécessaire :

```sh
make desktop-windows-release
make desktop-linux-release
make desktop-release-checksums
```

Les scripts remplacent l'ancien exécutable de chaque plateforme seulement après avoir trouvé le nouvel artefact attendu dans `ui/release/`.

## Vérification et publication GitHub

Avant le commit :

1. vérifier que les deux artefacts portent exactement la même version ;
2. relancer `make desktop-release-checksums` ;
3. vérifier avec `git lfs status` que le `.exe` et l'AppImage sont bien traités par LFS ;
4. exécuter les tests pertinents et `git diff --check` ;
5. ajouter explicitement les sources, les deux artefacts, `SHA256SUMS` et les fichiers de version, sans utiliser aveuglément `git add -A` dans un arbre de travail mixte.

La publication utilisée historiquement par ce projet est un commit sur la branche `desktop`, puis un `git push` via le remote SSH `origin`. Git LFS envoie automatiquement les gros objets avant le push Git. Aucun navigateur ni GitHub CLI n'est nécessaire pour ce mécanisme, mais les identifiants SSH Git de la machine doivent être fonctionnels.
