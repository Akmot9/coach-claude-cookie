# Coach Claude Cookie

Cookie Clicker (Steam) mod that records every golden-cookie combo in real time. It is built so an AI coach can review your combos second by second.

## What it records
- A combo starts when a buff multiplies production or clicks. It ends 5 s after the last such buff.
- For each combo it records the golden cookies clicked, the buffs gained, the Grimoire spells (success or backfire), the clicks, and a snapshot every second.
- Output: `resources/app/file_outputs/coachclaudecookie.txt` (JSON). It holds the current combo plus the last 50 combos, and the last 5 keep their per-second snapshots.

- Live view: `resources/app/file_outputs/coachclaudelive.txt` (JSON), rewritten every second at all times. It holds the bank, CpS, active buffs, mana, sugar lumps, building counts, the Pantheon slots and worship swaps, and the last 30 events: golden cookies, spells, buffs, building and upgrade purchases, lump harvests, and Pantheon changes.

- Long-term progress, in the same live file: prestige and heavenly chips (`ascension`), dragon level and auras (`dragon`), building levels (`levels`), when the current sugar lump matures and ripens (`lump`), golden cookies clicked and missed (`golden`), the garden (`garden`: plants and how many are mature, empty tiles, seeds unlocked, soil) and the season. Dragon training, aura changes, building level-ups and new seeds are logged as events.

- Combo panel: an overlay at the bottom left of the screen, over the milk. It lists your last 12 actions (golden cookies, buffs, spells, click bursts, building sales such as `Vente : 95 × Tour de sorciers`) and highlights adjacent actions that form a known combo: DOUBLE BONUS, PROLONGATION, MAIN DU DESTIN, INVOCATION BOOSTÉE, DOUBLE SORT (two Hand of Fate within 10 s), GODZAMOK (sales during a click frenzy). It never blocks clicks.

- Fate prediction: Force the Hand of Fate outcomes are deterministic. Numbers marked `RF` are safe for Gambler's Fever Dream (its second spell uses the next number's roll with a 50% backfire floor). (the game seeds its random generator with your run's seed and the number of spells cast). The panel shows the next 6 outcomes, for example `Destin : 13 : Frénésie · 14 : RATÉ (Caillot) · 15 : Frénésie de clics`, and they are also written to the live file. Any spell cast moves the counter forward, so you can spend cheap spells to skip bad outcomes. An extra golden cookie on screen raises the backfire chance, and the prediction updates to reflect it.
- Double cast planner: when the next two outcomes stack (Frenzy, Click frenzy, building special) the panel adds a `Double sort` line: how many Wizard towers to sell so a second Hand of Fate fits the lower max mana (selling clamps your mana to the new max), or the max mana / mana still missing. Click the first golden cookie before the second cast: each one on screen adds 15% backfire. The plan is also in the live file (`doubleCast`).

- Keyboard clicks: each press of **P** or **Space** clicks the big cookie once, through the game's own click function, so the game's click cap, stats and achievements still apply. A held key does not repeat. The keys do nothing while you type text in the game or hold Ctrl/Alt.

- Stock market: once the Bank minigame is unlocked, the live file lists each active good with its price, resting value, % of resting value, stock and maximum stock, trend, and, when the [Suivi des ordres](https://github.com/Akmot9/cookie-suivi-des-ordres) mod is installed, your cost basis per good (average unit cost with overhead, unknown-cost quantity, realized P/L) read from its ledger.

If the mod hits an internal error, it stops recording and writes the error to `file_outputs/coachclaudeerror.txt`. The game keeps running.

The mod only observes: it does not change gameplay and does not block Steam achievements.

## Install (Steam, Linux)
```bash
git clone https://github.com/Akmot9/coach-claude-cookie.git
ln -s "$PWD/coach-claude-cookie/mod" \
  "$HOME/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/mods/local/coach claude cookie"
```
Then in game: Options → Mods → enable **Coach Claude Cookie** → restart.

## Report
```bash
python3 tools/combo_report.py        # last combo, in French
python3 tools/combo_report.py --all  # table of all kept combos
```

## Tests
```bash
node --test test/*.test.js
python3 -m unittest discover -s test -p 'test_*.py'
```
