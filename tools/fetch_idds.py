"""Collect the Energy+.idd of every supported EnergyPlus version into ``idd/``.

Sources (see PLAN.md §2):

- 8.0 to 8.8: NREL/EnergyPlus on GitHub, tag v8.9.0, folder ``idd/``.
- 8.9: same repository, tag v9.0.1, ``idd/V8-9-0-Energy+.idd``.
- 9.0 onwards: the local EnergyPlus install,
  ``<install>/PreProcess/IDFVersionUpdater/V<major>-<minor>-0-Energy+.idd``.

Each file is saved as ``idd/<major>.<minor>.idd``. Files already present are
kept unless ``--force`` is given. When a new EnergyPlus version comes out,
install it and run this script again with ``--energyplus`` pointing to it.

Usage: uv run tools/fetch_idds.py [--energyplus /Applications/EnergyPlus-26-2-0] [--force]
Only the Python standard library is used. Set GITHUB_TOKEN to avoid API rate limits.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The NREL/EnergyPlus repository id; it survives renames of the GitHub organization.
GITHUB_REPO_API = "https://api.github.com/repositories/14620185"
GITHUB_IDDS = {f"8.{minor}": ("v8.9.0", f"idd/V8-{minor}-0-Energy+.idd") for minor in range(9)}
GITHUB_IDDS["8.9"] = ("v9.0.1", "idd/V8-9-0-Energy+.idd")

_LOCAL_IDD = re.compile(r"^V(\d+)-(\d+)-\d+-Energy\+\.idd$")


def default_install() -> Path | None:
    """Newest EnergyPlus found in the usual install locations."""
    candidates: list[Path] = []
    for base in (Path("/Applications"), Path("/usr/local"), Path("C:/")):
        if base.exists():
            candidates += [p for p in base.glob("EnergyPlus*") if p.is_dir()]

    def key(path: Path) -> tuple[int, ...]:
        return tuple(int(n) for n in re.findall(r"\d+", path.name)) or (0,)

    return max(candidates, key=key) if candidates else None


def download(tag: str, path: str) -> bytes:
    url = f"{GITHUB_REPO_API}/contents/{path}?ref={tag}"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github.raw"})
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def check_header(data: bytes, version: str, source: str) -> None:
    head = data[:200].decode("latin-1")
    match = re.search(r"!IDD_Version\s+(\d+)\.(\d+)", head)
    if not match or f"{int(match.group(1))}.{int(match.group(2))}" != version:
        raise ValueError(f"{source} does not look like the IDD of version {version}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--energyplus", type=Path, default=None, help="EnergyPlus install folder")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "idd")
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    args = parser.parse_args(argv)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    def wanted(version: str) -> Path | None:
        target = args.out_dir / f"{version}.idd"
        return None if target.exists() and not args.force else target

    for version, (tag, path) in GITHUB_IDDS.items():
        target = wanted(version)
        if target is None:
            continue
        data = download(tag, path)
        check_header(data, version, f"{tag}:{path}")
        target.write_bytes(data)
        print(f"{version}: downloaded {tag}:{path}")

    install = args.energyplus or default_install()
    updater = install / "PreProcess" / "IDFVersionUpdater" if install else None
    if updater is None or not updater.is_dir():
        print("EnergyPlus install not found; pass --energyplus to copy versions 9.0+.", file=sys.stderr)
        return 1
    for source in sorted(updater.iterdir()):
        match = _LOCAL_IDD.match(source.name)
        if not match or int(match.group(1)) < 9:
            continue
        version = f"{int(match.group(1))}.{int(match.group(2))}"
        target = wanted(version)
        if target is None:
            continue
        check_header(source.read_bytes(), version, str(source))
        shutil.copyfile(source, target)
        print(f"{version}: copied {source}")

    license_file = install / "LICENSE.txt"
    if license_file.exists():
        shutil.copyfile(license_file, args.out_dir / "LICENSE-EnergyPlus.txt")

    count = len(list(args.out_dir.glob("*.idd")))
    print(f"{count} IDD files in {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
