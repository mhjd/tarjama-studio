# Ajustements desktop et corrections après export — 23 septembre 2026

## Livré

- Français sous l’arabe, sur ordinateur comme sur téléphone.
- Commandes desktop centrées dans le lecteur : recul/avance 64 px, lecture/pause
  76 px ; le placement reste centré indépendamment de la miniature.
- Étape suivante en haut **et** après le dernier segment. Les deux emplacements
  utilisent le même rendu, les mêmes confirmations et la même fonction de flush.
- Lien YouTube sous le titre, copie au clic avec confirmation ou message de refus
  du presse-papiers ; action distincte pour ouvrir la source. Aucun lien inventé
  pour les fichiers importés sans URL.
- Indication à l’export expliquant qu’on peut encore corriger les textes puis
  valider et produire un nouveau rendu. La logique serveur existante est conservée.

[Haut de page desktop](desktop-top.png) · [Bas de page desktop](desktop-bottom.png)
· [Lien source sur téléphone](mobile-source.png).

## Vérifié

`make web-test` réussit : 13 tests Playwright, tests Go avec race detector et vet,
TypeScript/Vite, parité des prompts, sauvegarde/restauration PostgreSQL.

Le parcours d’export télécharge un vrai MP4 synthétique, corrige le français après
export, vérifie que l’ancien lien n’est plus proposé comme résultat courant, que
le fichier précédent reste accessible et qu’un nouvel export a un autre lien.
Il modifie ensuite l’arabe, retrouve l’étape de correction, confirme que le français
est conservé et que les confirmations de remplacement en haut/bas sont synchronisées.
Le test IME utilise le bouton inférieur ; le parcours initial utilise le supérieur.

Les tests mesurent le placement vertical des champs et le centrage/taille du
bouton de lecture desktop. La copie est vérifiée avec le vrai presse-papiers du
navigateur ; un refus est simulé séparément. Captures examinées et clips enregistrés
sur les trois viewports habituels (393×852, 412×915, 1440×932).

Ces preuves sont des fixtures Chromium : pas de nouvel appel YouTube/Groq/Gemini,
pas de qualification Safari physique. La vérification postdéploiement repose sur
la readiness des services administrés, pas sur une nouvelle connexion MFA.

## Déploiement

Recette `web/deploy/preview/active-desktop-20260923.yml`, dérivée de la recette
mobile précédente ; seul le digest du service web change. Build frontend sur le
runtime qualifié b69c700, avec `make web-ui-release-build`, import local,
validate/plan réussis. Aucun nouveau moteur de traduction activé, aucune migration.

Image : `preview.local/atelier/web@sha256:a7b4b0f53492821aabb925b6858b380dcd85fccadefd234f48298e9414ee026f`.
Révision : `29d0694231ce9b9a`.

Après application, web/worker/DB/egress sont prêts 1/1 ; review reste arrêté.
