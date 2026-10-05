# ASR : récupération des horodatages hors audio — 5 octobre 2026

## Incident confirmé

Le job transcribe signalé le 4 octobre à 20:12:42 UTC a atteint 99 %, après
persistance de sept morceaux. Le téléchargement avait réussi. La fusion a refusé
`asr_timestamp_outside_chunk` : le dernier morceau commence à 3480 s et dure
546,056 s, mais son dernier segment termine à 554,5216 s. Ses trois mots alignés
commencent tous après 553,9816 s, au-delà de l’audio réellement transmis.
Il ne s’agit pas d’un refus de permissions VPS ni d’un timeout réseau.

Le projet et ses jobs ont été supprimés par une transaction validée le
5 octobre à 09:32:22,727428 UTC. L’auteur de la suppression n’est pas établi.
Aucun projet utilisateur n’a été restauré, modifié ou relancé.

L’investigation a récupéré les sept réponses dans les traces physiques puis le
WAL conservé. Les données, textes et WAL restent dans un dossier administrateur
privé, hors Git ; les tests committés utilisent exclusivement des phrases synthétiques.
Aucune restauration PostgreSQL, extension, modification de schéma, configuration
réseau ou permission n’a été nécessaire. Aucun nouvel appel fournisseur.

## Correction limitée

`prepareASRChunk` s’applique avant la persistance d’un nouveau morceau et pendant
la fusion des morceaux déjà persistés. Le contrôle existant de dépassement de plus
d’une seconde reste en place pour toute réponse non récupérable.

Un segment dépassant la limite n’est récupéré que si les mots alignés sont valides,
ordonnés et rendent exactement son texte, après normalisation des espaces :

- Les mots commençant dans l’audio sont conservés ; leur fin est bornée à la fin
  du morceau si elle la chevauche.
- Seuls les mots commençant après la fin de l’audio sont omis, avec un diagnostic
  numérique sans texte ni secret.
- Sans alignement complet, avec un texte différent ou des timestamps invalides,
  la réponse reste refusée. Une transcription entièrement vide reste refusée.

Les réponses brutes restent intactes. Aucun ajustement arbitraire d’échelle des
horodatages, suppression globale de garde, changement de modèle ou nouvel appel
IA automatique. Cette récupération s’appuie sur les horodatages du fournisseur ;
elle ne prouve pas l’exactitude acoustique de chaque mot, ni ne corrige les autres
hallucinations éventuelles de Whisper dans les intervalles valides.

## Qualification

Branche isolée `admin/asr-boundary-20261005`, basée sur le commit exact du worker
actif `b7d1bb3979eb23ffab9575337e77c6b7f9d33ac0` ; la branche `web-vps` et son
répertoire de travail sont préservés.

- Suite Go avec détecteur de courses, PostgreSQL 17 temporaire, FFmpeg et rendu
  des sous-titres : 243 résultats de tests/sous-tests PASS. Le rejeu privé est
  volontairement absent de cette suite publique ; il est exécuté séparément.
- Régressions ASR : fin hors audio, mots dans l’audio conservés, alignement
  incomplet refusé, transcription vide refusée, chevauchement normal inchangé,
  mot traversant la limite, réponse brute inchangée, durée invalide refusée.
- Reprise worker/DB de morceaux déjà enregistrés : passage succeeded à 100 % et
  étape cleanup mise en file, sans fournisseur ni outil média instancié.
- Rejeu des sept réponses originales : ancien code FAIL avec l’erreur attendue ;
  correction PASS, 1234 segments, dernière fin 4004182 ms pour 4026056 ms de média.
  Aucun appel IA ; aucun texte de client inclus dans les fixtures du dépôt.
- Compilation du backend corrigé réussie.

Les tests s’exécutent sur une base temporaire et un réseau Docker interne, sans
credentials de production. La première tentative avec l’image de compilation
seule a échoué faute de FFmpeg/bibliothèques de sous-titres ; la suite ci-dessus
utilise l’image d’outillage précédemment archivée, réimportée sans installation
système. Les tests navigateur ne sont pas rejoués : aucun code frontend modifié.

## Livraison administrée

Construire une image dérivée du worker exact actuellement actif, en remplaçant
uniquement `/usr/local/bin/tarjama`. Conserver corpus, bibliothèques, utilisateur,
entrypoint, environnement, volumes, secrets référencés et protections.
La recette de livraison doit provenir de `current.json` administré, en ne changeant
que `services.worker.image` ; ne pas utiliser une ancienne recette candidate.
Conserver l’ancienne image et la révision pour le retour arrière.

Le broker ordinaire insère la révision globale dans tous les templates de pods :
`deploy --file` peut redémarrer les six services même si seule l’image worker change.
Pour cette maintenance, l’administrateur applique seulement le Deployment worker
produit par le compilateur validé avec le playbook Ansible existant. Il conserve
l’historique/la recette administrés, les propriétaires et permissions, et vérifie
que les cinq autres pods sont inchangés. Aucun droit nouveau n’est donné aux agents.

Ne pas relancer un projet supprimé pour valider cette livraison. Un futur parcours
métier réel reste distinct du rejeu des réponses fournisseur de cet incident.
