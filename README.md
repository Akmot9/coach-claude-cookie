# Coach Claude Cookie

Cookie Clicker (Steam) mod that records every golden-cookie combo in real time. It is built so an AI coach can review your combos second by second.

## What it records
- A combo starts when a buff multiplies production or clicks. It ends 5 s after the last such buff.
- For each combo it records the golden cookies clicked, the buffs gained, the Grimoire spells (success or backfire), the clicks, and a snapshot every second.
- Output: `resources/app/file_outputs/coachclaudecookie.txt` (JSON). It holds the current combo plus the last 50 combos, and the last 5 keep their per-second snapshots.

- Live view: `resources/app/file_outputs/coachclaudelive.txt` (JSON), rewritten every second at all times. It holds the bank, CpS, active buffs, mana, sugar lumps, building counts, the Pantheon slots and worship swaps, and the last 30 events: golden cookies, spells, buffs, building and upgrade purchases, lump harvests, and Pantheon changes.

- Combo panel: an overlay at the bottom left of the screen, over the milk. It lists your last 12 actions (golden cookies, buffs, spells, click bursts) and highlights adjacent actions that form a known combo: DOUBLE BONUS, PROLONGATION, MAIN DU DESTIN, INVOCATION BOOSTÉE. It never blocks clicks.

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
