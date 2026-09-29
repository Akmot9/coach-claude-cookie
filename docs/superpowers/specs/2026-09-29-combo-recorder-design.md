# Coach Claude Cookie — enregistreur de combos (conception)

Date : 2026-09-29
Statut : validé à l'oral, en relecture écrite

## Objectif

Enregistrer en temps réel chaque combo de cookies dorés joué dans Cookie Clicker (version Steam) pour qu'un coach (Claude) puisse en faire un bilan précis : déroulé seconde par seconde, ce qui a rapporté, ce qui aurait pu rapporter plus.

- Utilisateur visé : le joueur (Akmot9) et Claude, qui lit les données.
- Réussite : après un combo, un bilan fiable est disponible (durée, cookies gagnés, bonus, cookies dorés, sorts, clics) sans que le joueur fasse quoi que ce soit.
- Plus tard, peut-être : une publication sur le Steam Workshop sous le nom « coach_claude_cookie ». Le code est écrit pour que ce soit possible (code et identifiants en anglais, mod autonome), mais **aucune interface en jeu ni traduction n'est prévue maintenant**.

## Hors sujet (pour cette version)

- Affichage dans le jeu (panneau, notifications).
- Historique conservé dans la sauvegarde du jeu.
- Publication sur le Steam Workshop.
- Toute modification du gameplay. Le mod observe seulement.

## Contraintes vérifiées dans le jeu

- Un mod Steam est un dossier dans `resources/app/mods/local/` avec `info.txt` et `main.js`, enregistré via `Game.registerMod(id, {init, save, load})`.
- Les crochets disponibles sont `logic`, `draw`, `reset`, `reincarnate`, `ticker`, `cps`, `cookiesPerClick`, `click`, `create`, `check`.
- Écriture de fichier : `window.api.send('toMain', {id: 'log to file', list: [[nom, contenu]]})`. Le jeu écrit alors `resources/app/file_outputs/<nom>.txt`, en remplaçant tout le contenu. Le nom ne peut contenir que des lettres, des chiffres et des espaces.
- `info.txt` doit contenir `"AllowSteamAchievs": 1`, sinon le mod bloque les succès Steam.

## Architecture

```
coach-claude-cookie/
  mod/
    info.txt          ID "coach claude cookie"
    main.js           enregistreur (Recorder + ComboTracker + Writer)
  tools/
    combo_report.py   bilan en français à partir du fichier de sortie
  test/
    combo_tracker.test.js
    test_combo_report.py
    fixtures/sample_output.json
  docs/superpowers/specs/…
  README.md
```

Installation locale : un lien symbolique `mods/local/coach claude cookie` pointe vers `mod/` dans le dépôt.

### `mod/main.js` : trois unités

1. **ComboTracker** : logique pure, sans aucune référence à `Game`, pour pouvoir le tester avec Node.
   - Entrées :
     - `onTick(snapshot)` : un relevé par seconde, contenant `t`, `cookies`, `cookiesEarned`, `handmade`, `clicks`, `cps`, `buffs[]` et `magic`.
     - `onEvent(evt)` : des événements `golden`, `buff`, `spell`.
   - Un combo **commence** quand au moins un bonus actif a `multCpS > 1` ou `multClick > 1`. Il **se termine** quand aucun bonus de ce type n'est actif depuis 5 s.
   - Pendant un combo, il garde les relevés et les événements.
   - À la fin, il produit un **résumé** :
     - début, fin, durée ;
     - cookies gagnés (`cookiesEarned` final − initial) et part faite à la main ;
     - clics ;
     - meilleur multiplicateur de production et de clic cumulés ;
     - liste des bonus avec leurs durées ;
     - cookies dorés cliqués et sorts lancés (réussis ou ratés).
   - Il garde les **50 derniers combos** ; les plus anciens sont supprimés.
   - Sortie : `state()` renvoie `{version, updated, current, history}`.

2. **Recorder** : branché sur le jeu.
   - Il enveloppe `Game.gainBuff` et envoie un événement `buff` (nom, durée, `multCpS`, `multClick`).
   - Il enveloppe `Game.shimmerTypes.golden.popFunc` et envoie un événement `golden` : colère ou non, variation de cookies, bonus obtenus pendant l'appel.
   - Il enveloppe le `win` et le `fail` de chaque sort du Grimoire et envoie un événement `spell` (clé du sort, réussi ou raté).
   - Le Grimoire est chargé plus tard par le jeu : le Recorder réessaie chaque seconde jusqu'à ce que `Game.Objects['Wizard tower'].minigame` existe.
   - Le crochet `logic` fait un relevé toutes les `Game.fps` images, soit une fois par seconde.
   - Chaque enveloppe appelle toujours la fonction d'origine et renvoie sa valeur, sans changer son comportement.

3. **Writer** : chaque seconde, si l'état a changé, il envoie `JSON.stringify(state)` via « log to file » sous le nom `coachclaudecookie`. Le fichier écrit est `file_outputs/coachclaudecookie.txt`.

### Gestion des erreurs

- Chaque fonction enveloppée et chaque tick sont dans un `try/catch`. Une erreur du mod est notée dans la console, puis le mod se désactive. Le jeu continue normalement, et la fonction d'origine du jeu est toujours appelée.
- Si `window.api` n'existe pas (version navigateur), le Writer ne fait rien.

### `tools/combo_report.py`

- Il lit `file_outputs/coachclaudecookie.txt` (chemin modifiable en argument) et affiche en français :
  - le combo en cours, s'il y en a un ;
  - le dernier combo terminé : déroulé chronologique, gains, conseils simples basés sur des règles (par exemple : Frénésie de clics sans Dilatation temporelle alors que le mana le permettait).
- `--all` affiche un tableau de tous les combos gardés.
- `cc_watch.py`, qui est hors du dépôt, lira le même fichier et signalera « Combo terminé : +X en Y s ».

## Tests

- `node --test test/` : le ComboTracker reçoit des séquences fictives. On vérifie :
  - début et fin du combo, y compris le délai de 5 s ;
  - le résumé ;
  - la limite de 50 combos ;
  - deux combos qui se suivent de près.
- `python3 -m unittest` : le script de bilan est testé sur `fixtures/sample_output.json`.
- Test manuel en jeu : le mod apparaît dans le menu Mods, le fichier est mis à jour chaque seconde, un vrai combo produit un résumé cohérent avec les statistiques du jeu, et les succès Steam restent débloquables.

## Publication

- Dépôt public `Akmot9/coach-claude-cookie` sur GitHub, avec un README (installation, fonctionnement, format du fichier de sortie).
