# Navigation et validations — 24 septembre 2026

## Décisions et anomalies corrigées

L’URL désigne la page consultée ; `project.stage`, renvoyé par le serveur,
fixe les opérations et les pages autorisées. Un clic dans le menu ne valide
jamais de texte et ne crée jamais de job. Cette règle remplace la première
implémentation qui forçait systématiquement l’URL vers l’étape courante,
même pour consulter une étape précédente.

| État du serveur | Pages accessibles | Texte proposé | Validation nécessaire |
| --- | --- | --- | --- |
| upload / preparing / transcribing / cleaning | 1 | Aucun champ de sous-titre brut | Attendre la correction automatique |
| arabic | 1, 2 | Arabe corrigé, modifiable en 2 | Valider l’arabe pour ouvrir 3 |
| translating, y compris attente / échec / annulation | 1, 2, 3 | Arabe validé en lecture seule en 2 ; aucun champ en 3 | Attendre ou reprendre le traitement |
| review | 1, 2, 3 | Arabe en 2 ; arabe et français en 3 | Valider la relecture pour ouvrir 4 |
| ready | 1, 2, 3, 4 | Corrections possibles ; export en 4 seulement | Retouches : validations à refaire |

- « Valider et traduire » attend toutes les sauvegardes, ouvre l’étape 3 et
  remonte en haut. Même comportement pour « Valider et exporter ».
- Les commandes du menu sont de vrais boutons, accessibles au clavier. La page
  consultée est indiquée par `aria-current="step"`; les étapes futures sont
  désactivées et les URL correspondantes contrôlées à l’ouverture.
- Pendant la traduction, l’étape 3 reste consultable (progression, réessai,
  annulation/reprise), sans textes partiels ni ancienne traduction modifiable.
  L’arabe de l’étape 2 est le texte serveur validé, pas un brouillon.
- Lorsque la traduction se termine, le français apparaît sur l’étape 3. Si
  l’utilisateur relit l’arabe en 2, sa page ne change pas automatiquement.
- Revenir en 1 montre un résumé de préparation terminée, sans nouvelle entrée
  vidéo. Un bouton permet de reprendre la relecture de l’arabe.
- Modifier l’arabe révoque l’accès à 3 et 4, conserve les anciens textes français
  et exige la confirmation de leur remplacement avant une nouvelle traduction.
  Modifier le français après validation révoque 4 seulement.
- Une ancienne tâche de préparation ne doit pas annoncer un blocage au milieu
  de la relecture. Les tâches de traduction n’apparaissent que pendant cette
  étape ; les tâches d’export affichées concernent la version actuelle.
- Les boutons de navigation attendent les sauvegardes. En cas d’échec, ils
  conservent l’éditeur et son brouillon. Le retour navigateur suit la même règle.
- Changer de page met le lecteur en pause et remonte la page. Le suivi reste
  activé par défaut dans la page de relecture ; il ne ramène pas au bas de la
  page suivante. Les commandes de vitesse et les raccourcis restent disponibles.

## Qualification réutilisable

`make web-test` exécute les contrôles Go, le build TypeScript/Vite et Playwright
sur l’environnement Compose isolé. Aucun appel payant à un fournisseur n’est
nécessaire pour ces régressions de parcours.

Tests spécifiques : `web/frontend/tests/workflow-navigation.spec.ts`.
La réponse de traduction y est retenue volontairement : la fixture fournisseur
habituelle termine trop vite pour observer les états intermédiaires.

- Parcours sur viewports MacBook Air 15 (1710 × 1107), Pixel 6 (412 × 915),
  iPhone 15 (393 × 852) : sauvegarde avant validation, remontée en haut,
  attente sans champs, retour/rechargement de l’arabe en lecture seule,
  fin de traduction sans navigation forcée, relecture puis export, invalidation
  par modification française puis arabe et protection des anciennes URL.
- Attente fournisseur, échec, annulation et reprise : aucune ouverture
  prématurée des champs ou de l’export.
- Navigation après saisie : sauvegarde réussie, puis refus de quitter une
  page dont le brouillon n’a pas pu être enregistré.
- Matrice des adresses prématurées sur tous les états serveur ; aucun job
  déclenché par navigation.
- Tests API renforcés : ni traduction avant validation, ni modification arabe
  ou française pendant traitement, ni export avant relecture validée.

La suite existante couvre également les conflits entre onglets, la saisie IME,
les réponses de sauvegarde lentes, l’import, le MP4 produit par FFmpeg et la
correction après export. Les captures sont générées sous
`web/frontend/test-results/workflow-*.png` ; une copie de revue est conservée sous
`web/review/workflow-navigation-20260924/`.

Ces essais utilisent Chromium aux dimensions indiquées, avec services IA simulés
et médias synthétiques. Ils ne constituent pas un essai sur Safari/iPhone physique,
un nouvel appel aux fournisseurs réels ou un nouveau téléchargement YouTube.

Résultat du 24 septembre : **39 tests Playwright réussis**, build TypeScript/Vite,
`go test -race ./...`, `go vet ./...`, parité des prompts et sauvegarde/restauration
PostgreSQL de la base synthétique réussis via `make web-test`. Une première
exécution manuelle avait réutilisé une base de test déjà modifiée ; la qualification
finale repart d’un environnement isolé neuf. Aucun changement du code métier ou
du schéma backend n’est nécessaire pour cette correction d’interface.
