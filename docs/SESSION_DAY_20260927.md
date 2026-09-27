# Sessions d'une journée — 27 septembre 2026

Décision utilisateur : ne plus être déconnecté trop tôt, viser une journée.
Interprétation retenue : **24 heures absolues depuis la connexion**, sans délai
d'inactivité plus court dans Tarjama, et non 24 heures renouvelées à chaque polling.
Le choix remplace les 12 heures décrites dans ARCHIVES_AND_SESSION_20260926.md.

## Application

Une constante commune fixe la durée du cookie et celle de l'enregistrement
PostgreSQL. Cookie `tarjama_session` : Max-Age 86400, Secure en production,
HttpOnly, SameSite=Lax conservés. Les appels API n'allongent pas l'échéance.
Une session expirée reste refusée ; CSRF, OIDC, PKCE et MFA ne sont pas affaiblis.
Aucune migration ni prolongation rétroactive : les anciennes sessions et leurs
cookies gardent leur échéance. La prochaine connexion crée une session de 24 h.

Vérification avec PostgreSQL isolé : durée du cookie et de la base cohérentes,
requête autorisée avec une heure restante, refus après expiration. Les échéances
sont simulées en base, sans prétendre avoir attendu une journée. Le flux OIDC
complet avec fournisseur simulé (PKCE/state/nonce/audience/replay) reste testé.

## Passerelle : intervention administrateur distincte

Le délai observé par l'utilisateur est le plus court des couches applicative,
passerelle OAuth2 Proxy et SSO Authelia. Le code Tarjama à 12 h n'explique pas à
lui seul une déconnexion au bout de quelques minutes. Aucun diagnostic de durée
réelle du navigateur propriétaire n'a été fait ; ne pas affirmer que le SSO est
la cause prouvée ni que la journée complète est déjà garantie.

Le [skill vps-preview](/home/codex/.agents/skills/vps-preview/SKILL.md) limite
l'agent applicatif : « Ne pas retirer Authelia, rechercher ses secrets, ni modifier
les protections du VPS. » La recette ne donne aucun réglage de durée de la
passerelle ou d'Authelia. Aucune modification de ces services n'est effectuée.

Message à transmettre à l'administrateur :

> Pour atelier / https://atelier.preview.runagen.com, le propriétaire souhaite
> rester connecté 24 heures après une authentification, y compris après une
> période d'inactivité. Tarjama crée désormais une session absolue de 24 h
> (cookie et base alignés). Merci de vérifier et aligner les durées effectives
> côté OAuth2 Proxy et Authelia, notamment expiration, inactivité et renouvellement,
> afin qu'une échéance intermédiaire ne force pas une reconnexion prématurée.
> Conserver MFA, CSRF, PKCE et les attributs sécurisés des cookies. Ne pas étendre
> cette politique aux autres applications sans justification. Tester aussi
> réouverture du navigateur, onglets multiples, activité/inactivité et expiration
> à 24 h ; conserver des jetons courts si leur renouvellement permet cette durée.
> Ne transmettre aucune valeur de cookie ou de secret. Rapporter les durées
> appliquées et les tests, en distinguant simulation et durée réellement observée.
