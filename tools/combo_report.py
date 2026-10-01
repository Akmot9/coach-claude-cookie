#!/usr/bin/env python3
"""Bilan en français des combos enregistrés par le mod Coach Claude Cookie."""
import argparse
import json
import os

DEFAULT_FILE = os.path.expanduser(
    "~/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/file_outputs/coachclaudecookie.txt"
)
BUFF_FR = {
    "Frenzy": "Frénésie",
    "Click frenzy": "Frénésie de clics",
    "Dragonflight": "Vol draconique",
    "Elder frenzy": "Frénésie des anciens",
    "Clot": "Caillot",
    "Dragon Harvest": "Récolte draconique",
    "Cursed finger": "Doigt maudit",
}
SPELL_FR = {
    "conjure baked goods": "Invoquer des pâtisseries",
    "hand of fate": "Forcer la main du Destin",
    "stretch time": "Dilatation temporelle",
    "spontaneous edifice": "Édifice spontané",
    "haggler's charm": "Charme du marchandeur",
    "summon crafty pixies": "Invoquer des lutins habiles",
    "gambler's fever dream": "Rêve fébrile du parieur",
    "resurrect abomination": "Résurrection abominable",
    "diminish ineptitude": "Réduire l'inaptitude",
}
UNITS = [(1e18, "Qi"), (1e15, "Qa"), (1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "k")]  # short scale, as shown by Cookie Monster


def fmt(n):
    for size, unit in UNITS:
        if abs(n) >= size:
            return f"{n / size:.1f} {unit}".replace(".", ",")
    return f"{n:.0f}"


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            st = json.load(f)
        if not isinstance(st, dict) or not isinstance(st.get("history"), list):
            raise ValueError("unexpected format")
        return st
    except FileNotFoundError:
        return f"Fichier introuvable : {path}. Le mod est-il activé et le jeu lancé ?"
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return f"Fichier illisible (peut-être en cours d'écriture) : {path}. Réessaie dans une seconde."
    except OSError as e:
        return f"Impossible de lire {path} : {e.strerror}."


def buff_name(name):
    return BUFF_FR.get(name, name)


def advice(item):
    s, ticks = item["summary"], item.get("ticks") or []
    out = []
    names = {b["name"] for b in s["buffs"]}
    cast = {sp["spell"] for sp in s["spells"]}
    mmax = s.get("magicMax")
    if "Click frenzy" in names and "stretch time" not in cast and mmax:
        if s["magicStart"] >= 8 + 0.2 * mmax:
            out.append("Tu avais le mana pour Dilatation temporelle : lance-la dès la Frénésie de clics pour la prolonger.")
    cf = [k for k in ticks if any(b["name"] == "Click frenzy" for b in k["buffs"])]
    if len(cf) >= 2 and cf[-1]["t"] > cf[0]["t"]:
        rate = (cf[-1]["clicks"] - cf[0]["clicks"]) / (cf[-1]["t"] - cf[0]["t"])
        out.append(f"Vitesse de clic pendant la Frénésie de clics : {rate:.1f} clics/s".replace(".", ",")
                   + (" — vise 8 clics/s ou plus." if rate < 8 else " — excellent."))
    return out


def report_combo(item):
    s = item["summary"]
    lines = [
        f"Combo : +{fmt(s['earned'])} en {s['duration']:.0f} s "
        f"(dont {fmt(s['handmade'])} à la main, {s['clicks']} clics)",
        f"Multiplicateurs max : production ×{s['bestCpsMult']:g}, clic ×{s['bestClickMult']:g}",
        f"Cookies dorés cliqués : {s['golden']}",
    ]
    t0 = s["start"]
    lines.append("Déroulé :")
    for e in item["events"]:
        dt = f"{e['t'] - t0:+.0f} s".replace(".", ",")
        if e["type"] == "golden":
            got = ", ".join(buff_name(b) for b in e["buffs"]) or f"+{fmt(e['earned'])}"
            lines.append(f"  {dt}  cookie {'de la colère' if e['wrath'] else 'doré'} → {got}")
        elif e["type"] == "buff":
            lines.append(f"  {dt}  bonus {buff_name(e['name'])} ({e['duration']:.0f} s)")
        elif e["type"] == "spell":
            lines.append(f"  {dt}  sort {SPELL_FR.get(e['spell'], e['spell'])} : {'réussi' if e['ok'] else 'RATÉ'}")
    tips = advice(item)
    if tips:
        lines.append("Conseils :")
        lines += [f"  - {t}" for t in tips]
    return "\n".join(lines)


def table(history):
    rows = ["#   durée   gagné      clics  dorés  sorts"]
    for i, item in enumerate(history, 1):
        s = item["summary"]
        rows.append(f"{i:<3} {s['duration']:>4.0f} s  +{fmt(s['earned']):<9} {s['clicks']:>5}  {s['golden']:>5}  {len(s['spells']):>5}")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", default=DEFAULT_FILE)
    ap.add_argument("--all", action="store_true", help="tableau de tous les combos gardés")
    a = ap.parse_args()
    st = load(a.file)
    if isinstance(st, str):
        print(st)
        return
    if st.get("current"):
        cur = st["current"]
        print(f"Combo en cours depuis {cur['ticks'][-1]['t'] - cur['start']:.0f} s…\n")
    if not st["history"]:
        print("Aucun combo terminé pour l'instant.")
    elif a.all:
        print(table(st["history"]))
    else:
        print(report_combo(st["history"][-1]))


if __name__ == "__main__":
    main()
