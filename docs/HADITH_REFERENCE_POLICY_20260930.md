# Sources religieuses : seul le Coran reste accessible au modèle

Décision utilisateur du 30 septembre 2026. Cette décision remplace l'ajout
automatique de références de hadith décrit dans
[la livraison précédente](INLINE_REFERENCES_RELEASE_20260930.md).

Le risque visé est l'association par Luna à une version proche mais différente
du hadith prononcé, notamment lorsque le conférencier le reformule. Une
correspondance trouvée par un outil ne suffit donc plus à autoriser l'ajout
d'une référence de hadith dans les sous-titres.

Le prompt conserve uniquement la source explicitement donnée par le locuteur,
à son niveau de précision. « Le Prophète a dit » ou « Aïcha rapporte » ne
déclenche aucun ajout bibliographique. « Rapporté par Bukhari » reste traduit,
sans numéro ajouté. Un recueil et un numéro prononcés restent conservés, sans
dupliquer cette indication dans une parenthèse. Aucun numéro ou suffixe absent
ne doit être complété, y compris à partir d'un résultat d'outil.

Décision finale : désactiver `sahih_ar` et `hadith_ar` dans les appels au modèle.
Seul `quran_fr` reste proposé parmi les outils religieux. Les appels aux deux
outils désactivés sont également refusés par le runner et par `Store.Call`,
même si le modèle en invente un. Le corpus et la fonction de consultation
hors ligne `Lookup` restent conservés pour une éventuelle réactivation.

Le prompt ne demande plus de recherche de hadith et interdit un remplacement
par la recherche web. Parallel reste disponible pour les incertitudes générales.
Cette restriction thématique du web est une consigne au modèle, pas un filtrage
sémantique du moteur. La politique des citations coraniques ne change pas.

La source canonique est `prompts/translation.md`, partagée avec le desktop.
Le prompt JSON web est régénéré, version
`translation-parallel-v5-quran-only`. Les traductions et checkpoints
existants ne sont pas réécrits.

Vérification : synchronisation et tests de parité desktop/web ; tests Go des
références, du runner et du domaine métier, dont refus des outils de hadith et
maintien de la consultation coranique. Aucun appel IA
payant ni déploiement pour ce changement. Il s'agit d'une consigne au modèle,
pas d'un contrôle déterministe de ses attributions ; son respect réel reste
à qualifier sur une nouvelle traduction avant d'en garantir le comportement.
