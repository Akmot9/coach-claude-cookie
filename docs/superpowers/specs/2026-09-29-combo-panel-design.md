# Coach Claude Cookie — panneau de combos en jeu (conception)

Date : 2026-09-29
Statut : validé à l'oral (option 1 : panneau HTML), en relecture écrite

## Objectif

Afficher dans le jeu, comme l'affichage des touches du « training mode » d'un jeu de combat, la liste des actions du joueur. Quand des actions qui se suivent forment un combo connu, elles sont mises **en surbrillance** avec le nom du combo. Le joueur voit tout de suite si son combo est fait dans le bon ordre.

- Emplacement : **en bas à gauche, par-dessus le lait**, sous le gros cookie (dans `#sectionLeft`).
- Réussite : pendant un combo, chaque action apparaît en moins d'une seconde, et les combos réussis sont surlignés avec leur nom. Un sort raté apparaît en rouge.

## Hors sujet (pour cette version)

- Choisir un combo modèle ou une liste d'étapes à cocher (remplacé par la détection automatique).
- Réglages : position, taille, masquer le panneau.
- Traduction anglaise. Les textes du panneau sont en français, regroupés dans une seule table pour pouvoir être traduits plus tard.
- Ventes de bâtiments (combo Godzamok). Le moteur de détection doit pouvoir l'accueillir plus tard.

## Actions affichées

Elles viennent des événements que le mod enregistre déjà (`golden`, `buff`, `spell`) et des relevés de chaque seconde.

| Action | Source | Texte affiché |
|---|---|---|
| Cookie doré ou de la colère | événement `golden` | `🍪 doré → Frénésie` (les bonus obtenus, sinon `+X cookies`) |
| Bonus sans cookie doré | événement `buff` qui n'est pas arrivé pendant un clic sur un cookie doré | `⚡ Frénésie 77 s` |
| Sort | événement `spell` | `✨ Dilatation temporelle ✔` en vert, ou `✘` en rouge |
| Rafale de clics | relevés : les clics entre deux relevés ; les secondes consécutives avec des clics sont regroupées | `👆 ×54 clics` |

Le panneau montre les **12 dernières actions**, la plus récente en bas, avec pour chacune l'heure (hh:mm:ss). Les actions de plus de 5 minutes s'effacent.

## Combos reconnus

On dit que deux actions sont **côte à côte** quand elles se suivent dans la liste, sans compter les rafales de clics entre elles (on peut cliquer entre deux étapes).

| Nom affiché | Règle |
|---|---|
| ★ DOUBLE BONUS | Une action qui donne Frénésie, puis, côte à côte, une action qui donne Frénésie de clics moins de 77 s plus tard |
| ★ PROLONGATION | Une action qui donne Frénésie de clics, puis, côte à côte, Dilatation temporelle réussie moins de 13 s plus tard |
| ★ MAIN DU DESTIN | Forcer la main du Destin réussi, puis, côte à côte, un cookie doré cliqué moins de 30 s plus tard |
| ★ INVOCATION BOOSTÉE | Une action qui donne Frénésie, puis, côte à côte, Invoquer des pâtisseries réussi moins de 77 s plus tard |

- Une action qui « donne » un bonus est un cookie doré dont la liste `buffs` contient ce bonus, ou une action bonus portant ce nom.
- Un sort **raté** entre deux actions casse la règle « côte à côte ».
- Une même action peut appartenir à deux combos, par exemple Double bonus puis Prolongation. Elle reçoit alors les deux surbrillances. Le nom du combo est affiché une fois, sur la dernière action du groupe.
- Les rafales de clics situées entre les actions d'un combo sont surlignées avec le groupe.

## Architecture

Tout est ajouté dans `mod/main.js`, à côté des unités existantes.

1. **ActionLog** (logique pure) :
   - `onEvent(evt)` transforme les événements en actions. Il ignore un événement `buff` marqué `fromGolden: true`. Le recorder pose cette marque quand le bonus est obtenu pendant un clic sur un cookie doré : l'événement `buff` arrive *avant* l'événement `golden`, donc une comparaison de temps ne suffirait pas.
   - `onTick(snapshot)` ajoute ou prolonge la rafale de clics à partir de la différence de `clicks` entre deux relevés.
   - `actions()` renvoie la liste, plafonnée à 50 actions en mémoire.
2. **detectCombos(actions)** (fonction pure) : renvoie `[{name, indices}]` d'après les règles ci-dessus.
3. **renderPanel(actions, combos, now)** (fonction pure) : renvoie le HTML des 12 dernières actions, en échappant tous les textes.
4. **Montage** (seule partie qui touche le navigateur) :
   - Il crée une fois `div#coachComboPanel` dans `#sectionLeft`, en position absolue en bas, sur toute la largeur, avec `z-index: 10` (le canvas du fond est à 5).
   - Le panneau a `pointer-events: none` pour ne jamais bloquer les clics sur le cookie, un fond noir à 55 % d'opacité, et une police de 11 px.
   - Il n'est remis à jour que si le HTML a changé.
   - Il est appelé par le même tick qu'aujourd'hui (1 fois par seconde), et en plus juste après chaque événement, pour que l'affichage soit instantané.
5. `install()` alimente l'ActionLog avec les mêmes événements et relevés que le tracker, par la même fonction `emit`.

## Gestion des erreurs

Le panneau passe par le même `safe()` que le reste. En cas d'erreur, le mod se coupe, écrit le fichier d'erreur et le jeu continue. Si `document` ou `#sectionLeft` est absent, par exemple dans les tests Node, le montage ne fait rien.

## Tests

- Node :
  - ActionLog : conversion des événements ; doublon bonus/cookie doré ignoré ; regroupement des rafales de clics ; plafond de 50 actions.
  - detectCombos : chaque combo reconnu ; limite de temps dépassée ; sort raté entre deux actions ; clics entre deux actions acceptés ; deux combos qui se chevauchent.
  - renderPanel : textes en français, classes CSS de surbrillance et d'échec, échappement HTML, 12 actions au plus.
  - install : un événement met à jour le panneau via un faux `document`.
- En jeu :
  - le panneau est visible sur le lait et ne bloque pas les clics ;
  - un vrai Frénésie + Frénésie de clics est surligné « DOUBLE BONUS ».
