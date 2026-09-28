# Relecture compacte et lecteur expiré — 28 septembre 2026

## Problèmes constatés

La capture du propriétaire montre de grands espaces vides dans les champs de
traduction sur ordinateur. `SubtitleInput` ajustait déjà la hauteur du texte sur
téléphone, mais supprimait ce réglage sur ordinateur : les trois lignes initiales
et le minimum de hauteur CSS restaient alors imposés. Les marges des libellés
augmentaient encore la hauteur des cartes.

Le propriétaire confirme également la présence de l'encart « Récupérer la vidéo »
sur le projet dont le lecteur a disparu. Lorsque `media_expired` est vrai et que
`media` est vide, l'interface retirait complètement le lecteur. L'explication et
la récupération existaient en haut de page, hors de vue pendant la relecture.
Ce constat correspond au comportement de rétention, pas à une preuve de panne du
streaming. Aucun état privé du projet n'a été lu ni modifié par ces tests.

## Changements

- Hauteur des champs adaptée au texte sur tous les formats, calculée par lots pour
  éviter un recalcul de mise en page pour chacun des milliers de champs.
- Cartes plus compactes sur ordinateur ; arabe au-dessus du français ; texte
  long intégralement visible, y compris pendant la saisie.
- Vitesse et navigation haut/bas réunies sur une ligne sur grand écran ; le centre
  des commandes principales reste indépendant de ces actions secondaires.
- Sur mobile, libellés visibles retirés, noms accessibles conservés. Bordure verte
  pour l'arabe, bleutée pour le français ; direction et attribut de langue gardés.
- Timecode mobile placé sur le bord supérieur de la carte, sans empiéter sur la
  largeur du texte. Cible tactile de 44 px, distincte du premier champ.
- À expiration, bandeau à la place du lecteur : fixe en bas sur mobile, attaché
  en haut pendant le défilement sur ordinateur. Récupération YouTube explicite,
  ou accès au champ de réimportation pour un fichier importé. Une récupération en
  cours désactive le bouton ; le lecteur revient lorsque le média est disponible.
- Le défilement vers un sous-titre sur ordinateur réserve la hauteur mesurée du
  lecteur, plutôt qu'une marge fixe qui pouvait masquer son timecode.

La politique de rétention, les textes sauvegardés, les protections des médias et
les mécanismes de téléchargement/réimportation ne changent pas. Aucun appel IA,
changement d'authentification, migration ou déploiement public.

## Vérification reproductible

```sh
make web-preopening-check ARGS="subtitle-density.spec.ts long-transcript.spec.ts editor.spec.ts player-layout.spec.ts player-page-jump.spec.ts"
```

Le banc Docker utilise une base jetable, un réseau interne et les comptes
synthétiques du serveur de fixtures. La récupération distante est simulée dans
le test UI : expiration, demande unique, attente, retour du lecteur et maintien
des textes. Aucun retéléchargement du projet du propriétaire n'est déclenché.

Les formats contrôlés sont 1440 × 932, 393 × 852 et 412 × 915 en Chromium.
Cela ne remplace pas un essai sur Safari/iOS ou Firefox Android réels. Les tests
vérifient les champs courts et longs, le redimensionnement pendant la saisie,
le lecteur dans la fenêtre après défilement, les marges tactiles et le retour de
la récupération. Le test d'une heure synthétique conserve 1 200 segments et
contrôle les recalculs de mise en page ainsi que le streaming Range HTTP 206.

Les captures et le journal de la vérification finale sont conservés dans
`web/review/subtitle-density-20260928/`. Les vues contiennent du texte et un média
synthétiques ; elles ne constituent pas un nouveau parcours IA en production.

Résultat : 36 tests Playwright réussis ; après le dernier ajustement des marges
et de la ligne des commandes secondaires, 16 tests visuels/comportementaux
pertinents rejoués avec succès. Compilation TypeScript/Vite et six suites Go
ciblées avec détecteur de courses réussies. Les empreintes des sources testées
figurent dans `qualification.json`. Les neuf captures finales ont été produites
par les tests ; les vues ordinateur, mobile et récupération ont été examinées.

Les corrections restent candidates sur `web-vps`, à déployer seulement dans la
procédure publique actuelle après instruction du propriétaire, en conservant les
adaptations administrateur. Elles ne valent pas activation du thème Keycloak.
