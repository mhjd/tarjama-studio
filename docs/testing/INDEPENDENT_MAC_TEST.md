# Test indépendant de Tarjama depuis le Mac

Tu es un testeur indépendant. Évalue l'application publique https://tarjama.runagen.com comme une personne qui la découvre, depuis un navigateur sur ce Mac. Le but est de déterminer si elle permet de transformer une vidéo arabe en vidéo sous-titrée en français sans explication extérieure, et de relever les difficultés réelles.

Ne lis pas le code ni les rapports de tests précédents avant ce parcours. Ne corrige pas l'application et ne te connecte pas au VPS. Utilise uniquement l'interface publique, sans appels directs à l'API pour franchir une étape. Tu peux utiliser Playwright ou les outils de navigateur disponibles sur le Mac ; garde le scénario réutilisable. Commence par observer et essayer par toi-même, sans demander au propriétaire comment utiliser l'application.

## Objectifs à accomplir

1. Partir d'un profil navigateur neuf, sans session ni cookies existants. Créer obligatoirement un nouveau compte depuis l'interface publique : l'inscription fait partie du test, ne la remplace pas par un compte déjà préparé. Utilise une identité synthétique réservée aux tests et un mot de passe aléatoire conservé uniquement dans un fichier local privé, jamais dans le rapport. Tester la déconnexion, un échec de connexion avec un mot de passe volontairement incorrect une seule fois, puis une connexion correcte. Observer la clarté des formulaires et des erreurs, sans provoquer de verrouillage par des essais répétés. Ne touche pas aux comptes ou projets existants du propriétaire. Si une intervention humaine d'authentification est indispensable, demande seulement cette intervention, sans demander de mot de passe dans la conversation.
2. Créer ton propre projet, nommé « Test indépendant — date — navigateur », à partir de cette courte vidéo arabe : https://www.youtube.com/watch?v=b1MKJ5gHig0. Observer si tu comprends ce qui se passe, ce qui est en cours et ce que tu peux faire ensuite.
3. Obtenir la transcription, l'écouter et modifier un petit passage dans ton projet de test. Vérifier que ta modification est conservée après avoir quitté puis rouvert la page. Distinguer la découverte du fonctionnement de toute appréciation linguistique : ne prétends pas valider l'arabe si tu ne peux pas réellement le juger.
4. Faire traduire, relire et modifier un passage français. Essayer de naviguer entre les étapes et avec les boutons précédent/suivant du navigateur, notamment pendant un traitement. Vérifier que les actions accessibles correspondent à ce qui est réellement prêt et que tes retouches ne se perdent pas.
5. Télécharger les sous-titres seuls, puis produire et télécharger une vidéo en qualité High. Ouvrir les fichiers téléchargés : vérifier qu'ils sont lisibles, que la vidéo a du son, que les sous-titres apparaissent, restent lisibles et suivent approximativement la parole. Observer le début, le milieu et la fin. Renommer les copies locales de façon explicite pour les retrouver.
6. Tester les services réellement proposés à un utilisateur ordinaire : navigation dans la bibliothèque, création, traitement, sauvegarde, lecture et téléchargements. Observer si les indications suffisent sans connaissance du fonctionnement interne. Pour toute fonction secondaire visible, vérifier au moins que son accès est compréhensible ; ne renseigne pas de clé API personnelle et ne lance pas de génération supplémentaire.
7. Revenir plus tard dans le même projet, essayer une petite retouche et observer les conséquences sur la traduction et l'export. Ne lance pas une nouvelle traduction ou un deuxième rendu complet uniquement pour cette observation. Découvrir également comment retrouver, archiver et restaurer ton projet si ces fonctions existent. Termine par une déconnexion et une reconnexion pour vérifier que le projet est toujours accessible.

## Ordinateur et téléphone

Effectue le parcours complet une fois, puis réutilise le même projet sur les trois formats suivants, sans repayer la génération pour chaque taille :

- MacBook Air 15 pouces : fenêtre de navigateur avec viewport 1710 × 1107 pixels CSS comme cible de comparaison ; indique la taille effectivement utilisée.
- iPhone 15 : viewport 393 × 852, tactile ; WebKit si disponible.
- Pixel 6 : viewport 412 × 915, tactile ; Chromium, et Firefox si disponible pour une vérification complémentaire.

L'émulation sur Mac ne prouve pas le comportement sur un téléphone réel : indique précisément navigateur, viewport, facteur d'échelle et mode d'émulation. Porte particulièrement attention à la place laissée aux textes, au lecteur pendant le défilement, aux commandes de lecture, aux sauts temporels, à la saisie, aux options et à l'accès aux étapes. Sur ordinateur, essaie les raccourcis que l'interface te permet de découvrir. Note les commandes dont tu n'as pas compris l'existence ou le fonctionnement.

## Limites de l'essai

- C'est une application réelle, avec des crédits IA partagés : un seul projet vidéo court et un seul parcours correction/traduction/export High. Au maximum un réessai manuel du traitement concerné si l'interface indique un échec ; aucun clic répété, aucune boucle de relance, aucun test de charge ni vidéo longue.
- En cas d'attente, observe l'évolution et les indications affichées. Après dix minutes sans évolution visible pour une étape, capture l'état et signale le blocage ; n'en déduis pas automatiquement que le traitement serveur est arrêté. Ne laisse aucun script relancer des opérations après ton arrêt.
- Ne modifie pas les protections, ne contourne pas un contrôle d'accès, n'explore pas les projets d'autrui et ne manipule aucun secret serveur. Ne supprime pas les preuves ni le projet de test à la fin.
- Les outils religieux du modèle sont limités au Coran. Ne considère pas l'absence de références de hadith ajoutées automatiquement comme une anomalie. Ce test UI ne permet pas de prouver quels outils le serveur a effectivement appelés.

## Preuves et compte rendu

Crée un dossier local neuf dans `~/Documents/VPS/share/tarjama-test-independant/` pour ce test, avec une date si une livraison précédente existe. Conserve :

- un enregistrement du parcours sur ordinateur et des séquences représentatives de lecture/édition sur iPhone et Pixel ; pas seulement une visite de la page d'accueil ;
- des captures des problèmes, les fichiers MP4 et SRT effectivement téléchargés par l'interface, et le script Playwright si utilisé ;
- un rapport en français avec les objectifs réussis, échoués ou non vérifiés, les temps d'attente mesurés et les endroits où tu as hésité ;
- pour chaque problème : étapes de reproduction, résultat attendu, résultat observé, gravité, navigateur/format et chemin de la preuve ;
- les identifiants ou URL de tes seuls projets de test pour permettre un diagnostic ultérieur.

Commence les enregistrements partagés après la saisie des identifiants. Exclue des preuves partagées les mots de passe, cookies, tokens, fichiers de session et en-têtes d'authentification. Des traces Playwright ou HAR peuvent en contenir : garde-les privées ou expurge-les avant partage.

Termine par ton jugement indépendant : « Un nouvel utilisateur peut-il terminer seul ? », et les trois améliorations les plus utiles. Ne transforme pas un succès technique en preuve de bonne ergonomie, ni un test court en validation exhaustive. Rapporte les difficultés même si tu as réussi à les contourner par l'interface. Ne demande de l'aide qu'en cas de blocage réel, puis rends les chemins exacts des preuves sur le Mac.
