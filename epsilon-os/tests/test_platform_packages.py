"""platform/lib/packages.json (the proposal price list) must match tools/offers.py and catalogue.json."""
import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _sync():
    spec = importlib.util.spec_from_file_location("sync_packages", REPO / "platform" / "scripts" / "sync_packages.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_packages_json_is_in_sync_with_offers():
    assert (REPO / "platform/lib/packages.json").read_text() == _sync().render(), \
        "stale: run python3 platform/scripts/sync_packages.py"


def test_every_package_is_a_catalogue_offer_with_a_price():
    slugs = {o["slug"] for o in json.loads((REPO / "catalogue.json").read_text())["offers"]}
    packages = json.loads((REPO / "platform/lib/packages.json").read_text())
    assert packages
    for p in packages:
        assert p["slug"] in slugs
        assert p["price_from"] > 0 and p["currency"] == "USD"
