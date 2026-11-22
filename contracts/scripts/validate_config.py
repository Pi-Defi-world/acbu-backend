#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Soroban/Stellar addresses are base32 strings with a length of 56 and a G/C prefix.
ADDRESS_RE = re.compile(r"^[GC][A-Z2-7]{55}$")


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate(path: Path):
    data = load_json(path)
    if isinstance(data, dict):
        raise ValueError(f"{path.name} must be a JSON array")
    if not isinstance(data, list):
        raise ValueError(f"{path.name} must be a JSON array")
    return data


def validate_config(root: Path = ROOT) -> None:
    validators_path = root / "validators.json"
    currencies_path = root / "currencies.json"
    weights_path = root / "weights.json"

    validators = validate(validators_path)
    currencies = validate(currencies_path)
    weights = validate(weights_path)

    if not all(isinstance(v, str) for v in validators):
        raise ValueError("validators.json must contain a list of address strings")
    if not all(
        isinstance(item, dict) and isinstance(item.get("SorobanString"), str)
        for item in currencies
    ):
        raise ValueError("currencies.json must contain objects with a SorobanString field")
    if not all(
        isinstance(item, dict)
        and isinstance(item.get("key"), dict)
        and isinstance(item["key"].get("SorobanString"), str)
        and "val" in item
        for item in weights
    ):
        raise ValueError("weights.json must contain objects with key/val fields")

    for validator in validators:
        if not isinstance(validator, str) or not ADDRESS_RE.fullmatch(validator):
            raise ValueError("validators.json contains an invalid address")

    currency_codes = {item["SorobanString"] for item in currencies}
    weight_keys = {item["key"]["SorobanString"] for item in weights}
    if currency_codes != weight_keys:
        raise ValueError("currency codes in currencies.json and weights.json do not match")


def main() -> int:
    validate_config()
    print("config validation passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
