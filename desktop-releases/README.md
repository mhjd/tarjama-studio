# Desktop releases

Ce dossier contient uniquement les exécutables distribuables de Tarjama Studio :

- `windows/` : exécutable portable Windows ;
- `linux/` : AppImage Linux x64.

Les données utilisées pour vérifier une release sont rangées séparément dans `test-fixtures/`.

Commandes de publication :

```sh
make desktop-windows-release
make desktop-linux-release
```
