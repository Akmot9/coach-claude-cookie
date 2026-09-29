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
        self.assertEqual(cr.fmt(7_700_000_000), "7,7 G")
        self.assertEqual(cr.fmt(12_300_000), "12,3 M")

    def test_report_in_french(self):
        out = cr.report_combo(self.item)
        self.assertIn("+7,7 G", out)
        self.assertIn("30 s", out)
        self.assertIn("Frénésie de clics", out)
        self.assertIn("Invoquer des pâtisseries", out)

    def test_advice_stretch_time_and_click_speed(self):
        adv = " ".join(cr.advice(self.item))
        self.assertIn("Dilatation temporelle", adv)  # 19 mana >= 8+0.2*19, not cast
        self.assertIn("5,0 clics/s", adv)            # 65 clicks over 13 s

    def test_table(self):
        self.assertIn("+7,7 G", cr.table(self.state["history"]))

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


if __name__ == "__main__":
    unittest.main()
