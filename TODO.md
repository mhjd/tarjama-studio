# TODO

> **Périmètre historique desktop/local.** Cette liste n'est pas la feuille de route de la migration web/VPS. Les choix d'interface avancée, de sauvegarde manuelle, d'historique et de priorité locale ci-dessous ne doivent pas être réintroduits dans le nouveau produit. Lire [docs/WEB_VPS_HANDOFF.md](docs/WEB_VPS_HANDOFF.md) pour les décisions finales et l'ordre de réalisation.

## Couche intuitive de l'application

### Clavier et modales

- [x] **1. Uniformiser la fermeture contextuelle.** `Echap` ferme d'abord la modale ou le menu au premier plan. `Q` ferme aussi l'aide. La fermeture ne doit jamais déclencher une action située derrière.
- [x] **2. Centraliser les raccourcis.** Un seul gestionnaire décide quelle action est prioritaire. Neutraliser les raccourcis simples dans les champs de texte, listes et champs horaires, tout en conservant `Ctrl/Cmd+S` et `Ctrl/Cmd+Z`.
- [x] **3. Gérer correctement le focus.** A l'ouverture d'une modale, placer le focus dedans, l'y retenir avec `Tab`, puis le rendre au bouton d'origine à la fermeture.
- [x] **4. Rendre l'aide contextuelle.** `?` ouvre l'aide depuis toute la page d'edition; `?`, `Q` et `Echap` la ferment. Regrouper les raccourcis par lecture, intervalle, navigation et edition, sans afficher de raccourci non implemente.
- [x] **5. Afficher les raccourcis dans les infobulles.** Chaque commande concernee indique son raccourci, par exemple `Aller au segment courant - S`.

### Lecture audio

- [x] **6. Employer un vocabulaire sans ambiguite.** `Intervalle` designe uniquement la plage temporaire Debut/Fin et `segment` uniquement une ligne de sous-titre. Renommer `Retour intervalle` en `Debut de l'intervalle` et `Effacer` en `Quitter l'intervalle`.
- [x] **7. Expliciter l'etat de lecture.** Indiquer discretement `Lecture libre`, `Intervalle` ou `Boucle`, avec les bornes actives a proximite des commandes.
- [x] **8. Identifier le segment audio actif.** Mettre en evidence la ligne correspondant au temps courant, distinctement du focus d'edition, sans imposer de defilement automatique.
- [x] **9. Ajouter la navigation precedent/suivant.** Placer deux commandes compactes autour de `Segment`; elles selectionnent le segment adjacent et positionnent l'audio. Raccourcis proposes : `Alt+Haut` et `Alt+Bas`.
- [x] **10. Permettre la reprise par projet.** Memoriser localement le dernier temps audio et le dernier segment consulte, puis proposer `Reprendre a HH:MM` ou `Recommencer` a la reouverture.

### Edition

- [x] **11. Clarifier la sauvegarde.** Distinguer `Modifications non sauvegardees`, `Sauvegarde...` et `Sauvegarde`. Desactiver le bouton lorsque rien n'a change. `Ctrl/Cmd+S` doit produire exactement la meme sauvegarde que le bouton.
- [x] **12. Permettre l'annulation immediate.** `Ctrl/Cmd+Z` annule la derniere suppression, fusion, scission ou insertion. Apres une operation structurelle, proposer brievement `Annuler`.
- [x] **13. Ajouter la recherche dans le document.** `Ctrl/Cmd+F` recherche dans l'arabe et le francais, affiche le nombre de resultats et permet de parcourir les occurrences.
- [x] **14. Afficher les erreurs sur la ligne concernee.** Signaler localement les timestamps invalides, fins anterieures au debut et chevauchements. Un clic sur l'erreur doit faire defiler jusqu'au segment concerne.
- [x] **15. Expliciter les actions de segment.** Chaque bouton icone possede une infobulle. Une action impossible est desactivee avec sa raison, par exemple une scission hors des bornes du segment.

### Imports et operations longues

- [x] **16. Previsualiser avant remplacement.** Avant l'import d'une transcription ou traduction, afficher le fichier, le nombre de segments, l'alignement et les erreurs, puis demander explicitement de confirmer le remplacement.
- [x] **17. Expliquer les boutons desactives.** Fournir la raison dans une infobulle, par exemple `Ajoute d'abord une video`, pour la transcription, la traduction, l'export et la sauvegarde.
- [x] **18. Rendre les erreurs exploitables.** Afficher un message court, un bouton `Copier les details` et, si possible, une action pertinente comme `Reessayer`, `Ouvrir les options` ou `Choisir un autre fichier`.
- [x] **19. Uniformiser la progression et l'annulation.** Telechargement, transcription et export affichent l'etape, le pourcentage, le temps ecoule et un bouton carre d'arret. Une annulation ne supprime que les fichiers temporaires.

### Navigation generale

- [x] **20. Mettre l'action suivante en evidence.** Selon l'etat du projet, faire ressortir une seule action principale : ajouter une video, transcrire/importer, preparer la traduction ou exporter.
- [x] **21. Rendre le retour previsible.** Conserver `Projets` au meme emplacement et garantir qu'un retour ne perde jamais silencieusement les modifications courantes recuperees automatiquement.
- [x] **22. Verifier l'accessibilite et la coherence visuelle.** Garantir des zones cliquables suffisantes, un focus clavier visible, un ordre coherent des controles et un nom accessible avec infobulle pour chaque icone seule.
 : plateforme de traduction multimedia

Ces fonctionnalites doivent rester distinctes du MVP. Faire evoluer le modele metier avant d'ajouter l'interface correspondante afin d'eviter les exceptions autour du couple actuel transcription arabe et traduction francaise.

### 1. Pistes multilingues

- [ ] Remplacer la traduction unique par des pistes linguistiques capables de representer plusieurs langues source et cible.
- [ ] Identifier les langues avec des codes standards comme `ar`, `fr` et `en`, avec des metadonnees supplementaires pour les dialectes lorsque necessaire.
- [ ] Permettre a un meme media de posseder plusieurs transcriptions et plusieurs traductions sans qu'elles s'ecrasent.
- [ ] Rattacher chaque traduction a sa piste source et a sa langue cible.
- [ ] Conserver l'alignement par identifiants de segments et timestamps, sans supposer qu'une traduction francaise est toujours presente.
- [ ] Afficher un statut par piste : a transcrire, a corriger, a traduire ou validee.
- [ ] Permettre de choisir les pistes linguistiques utilisees lors de l'export.

### 2. Extraits non destructifs

- [ ] Creer des sous-videos a partir de bornes Debut/Fin sans modifier ni dupliquer inutilement le media original.
- [ ] Rattacher chaque extrait a son media source et conserver ses timestamps d'origine.
- [ ] Permettre de transcrire, corriger, traduire et exporter uniquement un extrait.
- [ ] Gerer plusieurs extraits au sein d'un meme projet.
- [ ] Conserver systematiquement le media original intact.

### 3. Gestion avancee des projets

- [ ] Organiser les projets avec des categories et des etiquettes.
- [ ] Permettre a un projet de contenir plusieurs medias, extraits et pistes linguistiques.
- [ ] Afficher l'avancement du travail par media, extrait et langue.
- [ ] Proposer des filtres par categorie, statut, langue source et langue cible.
- [ ] Faire evoluer le rangement vers la structure logique suivante : espace de travail, categorie, projet, medias, extraits, pistes, historique et exports.

### 4. Traitement audio cible

- [ ] Ajouter quelques operations robustes adaptees a la transcription : normalisation du volume, reduction du bruit et attenuation de la reverberation.
- [ ] Utiliser FFmpeg ou un moteur specialise existant plutot que reimplementer les traitements audio.
- [ ] Proposer des prereglages simples avec previsualisation avant application.
- [ ] Produire un media derive et ne jamais ecraser l'original.

### Limites de perimetre

- [ ] Ne pas transformer Tarjama Studio en logiciel de montage generaliste : pas de transitions, effets visuels ou timeline multipiste sans besoin utilisateur concret.
- [ ] Ne pas prioriser la collaboration simultanee ou une architecture cloud avant validation du besoin.
- [ ] Respecter l'ordre recommande : pistes multilingues, extraits non destructifs, gestion avancee des projets, puis traitement audio.
