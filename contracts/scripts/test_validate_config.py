import json
import tempfile
import unittest
from pathlib import Path
import importlib.util

MODULE_PATH = Path(__file__).with_name("validate_config.py")
spec = importlib.util.spec_from_file_location("validate_config", MODULE_PATH)
validate_config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_config)


class ValidateConfigTests(unittest.TestCase):
    def write_files(self, root: Path, validators, currencies, weights) -> None:
        (root / "validators.json").write_text(json.dumps(validators), encoding="utf-8")
        (root / "currencies.json").write_text(json.dumps(currencies), encoding="utf-8")
        (root / "weights.json").write_text(json.dumps(weights), encoding="utf-8")

    def test_accepts_valid_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_files(
                root,
                [
                    "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML",
                    "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDMA",
                    "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDMB",
                    "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDMC",
                    "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDMD",
                ],
                [{"SorobanString": "USD"}],
                [{"key": {"SorobanString": "USD"}, "val": 100}],
            )
            validate_config.validate_config(root)

    def test_rejects_invalid_validator_address(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_files(
                root,
                ["not-an-address"],
                [{"SorobanString": "USD"}],
                [{"key": {"SorobanString": "USD"}, "val": 100}],
            )
            with self.assertRaisesRegex(ValueError, "validators"):
                validate_config.validate_config(root)

    def test_rejects_invalid_weight_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            self.write_files(
                root,
                ["GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML"],
                [{"SorobanString": "USD"}],
                [{"key": "USD", "val": 100}],
            )
            with self.assertRaisesRegex(ValueError, "weights"):
                validate_config.validate_config(root)


if __name__ == "__main__":
    unittest.main()
