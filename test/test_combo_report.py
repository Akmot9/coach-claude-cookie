import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import combo_report as cr  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "sample_output.json")


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.state = cr.load(FIX)
        self.item = self.state["history"][-1]

    def test_fmt(self):
        self.assertEqual(cr.fmt(950), "950")
        self.assertEqual(cr.fmt(7_700_000_000), "7,7 B")
        self.assertEqual(cr.fmt(12_300_000), "12,3 M")

    def test_report_in_french(self):
        out = cr.report_combo(self.item)
        self.assertIn("+7,7 B", out)
        self.assertIn("30 s", out)
        self.assertIn("Frénésie de clics", out)
        self.assertIn("Invoquer des pâtisseries", out)

    def test_advice_stretch_time_and_click_speed(self):
        adv = " ".join(cr.advice(self.item))
        # 19 mana − Conjure (9,6) = 9,4 < Stretch Time (11,8): no advice to cast it
        self.assertNotIn("Dilatation temporelle", adv)
        self.assertIn("5,0 clics/s", adv)            # 65 clicks over 13 s
        rich = {"summary": dict(self.item["summary"], magicStart=31, magicMax=31, spells=[]), "events": [], "ticks": []}
        self.assertIn("Dilatation temporelle", " ".join(cr.advice(rich)))

    def test_table(self):
        self.assertIn("+7,7 B", cr.table(self.state["history"]))

    def test_missing_and_invalid_file(self):
        self.assertIsInstance(cr.load("/nonexistent/x.txt"), str)
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write('{"version":1,"hist')
        try:
            msg = cr.load(f.name)
            self.assertIsInstance(msg, str)
            self.assertIn("illisible", msg)
        finally:
            os.unlink(f.name)




class RobustLoadTest(unittest.TestCase):
    def test_non_object_json_and_directory(self):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write("null")
        try:
            self.assertIsInstance(cr.load(f.name), str)
        finally:
            os.unlink(f.name)
        self.assertIsInstance(cr.load(tempfile.gettempdir()), str)


class AdviceAfterFate(unittest.TestCase):
    def test_no_stretch_time_advice_when_hand_of_fate_emptied_the_mana(self):
        item = {"summary": {"start": 0, "end": 20, "duration": 20, "earned": 1, "handmade": 1, "clicks": 10,
                            "bestCpsMult": 7, "bestClickMult": 777, "golden": 2,
                            "buffs": [{"name": "Frenzy", "duration": 77, "multCpS": 7, "multClick": 1},
                                      {"name": "Click frenzy", "duration": 13, "multCpS": 1, "multClick": 777}],
                            "spells": [{"spell": "hand of fate", "ok": True}], "magicStart": 31, "magicMax": 31},
                "events": [], "ticks": []}
        self.assertNotIn("Dilatation temporelle", " ".join(cr.advice(item)))


if __name__ == "__main__":
    unittest.main()
