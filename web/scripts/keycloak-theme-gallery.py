#!/usr/bin/env python3
"""Create an offline gallery from the non-secret Playwright theme screenshots."""
import argparse
import html
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
sections = []
scenes = [('01-login', 'Connexion'), ('02-register', 'Inscription'),
          ('03-register-error', 'Erreur d’inscription'), ('04-logout', 'Déconnexion'),
          ('05-login-error', 'Erreur de connexion'), ('06-mfa', 'Double authentification'),
          ('07-english', 'Version anglaise')]
for suffix, title in scenes:
    cards = []
    for device, label in [('macbook-air-15', 'Ordinateur · 1440 × 932'),
                          ('iphone-15', 'iPhone 15 · 393 × 852'), ('pixel-6', 'Pixel 6 · 412 × 915')]:
        name = f'{device}-{suffix}.png'
        if (args.directory/name).is_file():
            cards.append(f'<figure><a href="{name}"><img loading="lazy" src="{name}" '
                         f'alt="{html.escape(title)} — {label}"></a><figcaption>{label}</figcaption></figure>')
    if cards:
        sections.append(f'<section><h2>{title}</h2><div class="grid">{"".join(cards)}</div></section>')
if not sections:
    parser.error('No theme screenshots found')
(args.directory/'index.html').write_text('''<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tarjama — aperçu du thème de connexion</title>
<style>
:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;color:#e5ece9;background:#111719}
body{margin:auto;padding:32px 20px;max-width:1400px}h1{line-height:1.2}h2{color:#c4e6ac}
a{color:#c4e6ac}p{max-width:900px;color:#b3c2bd}.grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;align-items:start}
figure{margin:0;background:#192624;border:1px solid #3a4947;border-radius:12px;padding:12px}
img{width:100%;height:auto;display:block}figcaption{padding-top:10px}section{margin:48px 0}
@media(max-width:700px){.grid{grid-template-columns:1fr}}:focus-visible{outline:3px solid #b0df90}
</style><h1>ترجمة · Tarjama</h1><p>Aperçu du thème Keycloak candidat. Captures de vrais
parcours de test isolés, avec des comptes fictifs. Aucun changement sur le site public.</p>
<p>Cliquer sur une image pour l’agrandir. Les formats iPhone et Pixel sont simulés sous Chromium ;
ces captures ne constituent pas un test sur Safari ou un appareil physique.</p>
''' + '\n'.join(sections) + '</html>\n', encoding='utf-8')
