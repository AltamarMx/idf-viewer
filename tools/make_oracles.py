"""Reference values computed by EnergyPlus, used only by the tests (PLAN.md §3.6).

For each IDF in ``examples/`` and ``tests/fixtures/geometry/`` this script runs the
local EnergyPlus (design days only) on a copy of the file with extra output
objects, and writes ``tests/oracles/<file stem>.json`` with:

- zones: volume, floor area, ceiling height, multipliers, exterior wall and window areas;
- surfaces: class, zone, gross and net area, azimuth, tilt and vertices
  (vertices as EnergyPlus reports them: upper-left corner first, counterclockwise,
  world coordinates, 2 decimals);
- building: total and conditioned floor area and the window-wall ratio table.

The viewer never reads simulation results: these files only check that the
viewer computes the same geometry as EnergyPlus.

Usage: uv run tools/make_oracles.py [--energyplus /Applications/EnergyPlus-26-2-0] [files...]
Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = Path(__file__).resolve().parent / ".runs"
OUT = ROOT / "tests" / "oracles"

# Unique output objects replaced in the copy, and the ones added instead.
DROP_CLASSES = {"output:sqlite", "output:table:summaryreports", "output:surfaces:list"}
EXTRA_OBJECTS = """
Output:Surfaces:List, DetailsWithVertices;
Output:SQLite, SimpleAndTabular;
Output:Table:SummaryReports, InputVerificationandResultsSummary;
"""


def default_install() -> Path | None:
    candidates = [p for p in Path("/Applications").glob("EnergyPlus*") if (p / "energyplus").exists()]
    return max(candidates, key=lambda p: [int(n) for n in re.findall(r"\d+", p.name)]) if candidates else None


def object_spans(text: str):
    """Yield (class name, start, end) for each object, skipping "!" comments."""
    i, n = 0, len(text)
    start = None
    class_name = None
    token_start = None
    while i < n:
        char = text[i]
        if char == "!":
            newline = text.find("\n", i)
            i = n if newline < 0 else newline
            continue
        if start is None and not char.isspace():
            start = i
            token_start = i
        if char in ",;" and start is not None:
            if class_name is None:
                class_name = text[token_start:i].strip()
            if char == ";":
                yield class_name, start, i + 1
                start = None
                class_name = None
        i += 1


def prepare_input(text: str) -> str:
    """Copy of the IDF without the replaced output objects, plus the extra ones."""
    parts = []
    last = 0
    for class_name, start, end in object_spans(text):
        if class_name.lower() in DROP_CLASSES:
            parts.append(text[last:start])
            last = end
    parts.append(text[last:])
    return "".join(parts) + EXTRA_OBJECTS


def read_eio_surfaces(eio: Path) -> dict[str, dict]:
    surfaces = {}
    for raw in eio.read_text(encoding="latin-1").splitlines():
        line = raw.strip()
        # Frame/Divider lines have no vertices.
        if not line.startswith(("HeatTransfer Surface,", "Shading Surface,")):
            continue
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 27 or not cells[26].isdigit():
            continue
        sides = int(cells[26])
        coords = [float(c) for c in cells[27 : 27 + 3 * sides]]
        surfaces[cells[1]] = {"vertices": [coords[i : i + 3] for i in range(0, len(coords), 3)]}
    return surfaces


def read_sql(sql: Path) -> dict:
    db = sqlite3.connect(sql)
    db.row_factory = sqlite3.Row
    zones = {}
    zone_names = {}
    for row in db.execute("SELECT * FROM Zones"):
        zone_names[row["ZoneIndex"]] = row["ZoneName"]
        zones[row["ZoneName"]] = {
            "volume": row["Volume"],
            "floorArea": row["FloorArea"],
            "ceilingHeight": row["CeilingHeight"],
            "multiplier": row["Multiplier"],
            "listMultiplier": row["ListMultiplier"],
            "partOfTotalArea": bool(row["IsPartOfTotalArea"]),
            "extGrossWallArea": row["ExtGrossWallArea"],
            "extNetWallArea": row["ExtNetWallArea"],
            "extWindowArea": row["ExtWindowArea"],
            "relNorth": row["RelNorth"],
            "origin": [row["OriginX"], row["OriginY"], row["OriginZ"]],
        }
    surfaces = {}
    for row in db.execute("SELECT * FROM Surfaces"):
        surfaces[row["SurfaceName"]] = {
            "class": row["ClassName"],
            "zone": zone_names.get(row["ZoneIndex"]),
            "grossArea": row["GrossArea"],
            "netArea": row["Area"],
            "azimuth": row["Azimuth"],
            "tilt": row["Tilt"],
        }

    def table(report: str, name: str) -> dict:
        result: dict = {}
        query = (
            "SELECT RowName, ColumnName, Value, Units FROM TabularDataWithStrings "
            "WHERE ReportName = ? AND TableName = ?"
        )
        for row in db.execute(query, (report, name)):
            try:
                value: float | str = float(row["Value"])
            except ValueError:
                value = row["Value"].strip()
            result.setdefault(row["RowName"], {})[row["ColumnName"]] = value
        return result

    building = {
        "area": table("AnnualBuildingUtilityPerformanceSummary", "Building Area")
        or table("InputVerificationandResultsSummary", "Building Area"),
        "windowWallRatio": table("InputVerificationandResultsSummary", "Window-Wall Ratio"),
    }
    db.close()
    return {"zones": zones, "surfaces": surfaces, "building": building}


def rounded(value, digits=6):
    if isinstance(value, float):
        return float(f"{value:.{digits}g}")
    if isinstance(value, list):
        return [rounded(v, digits) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v, digits) for k, v in value.items()}
    return value


def run(idf: Path, energyplus: Path) -> Path:
    run_dir = RUNS / idf.stem
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    text = idf.read_bytes().decode("utf-8", errors="replace")
    (run_dir / "in.idf").write_text(prepare_input(text), encoding="utf-8")
    command = [str(energyplus / "energyplus"), "--design-day", "--output-directory", str(run_dir)]
    if re.search(r"^\s*HVACTemplate:", text, re.MULTILINE | re.IGNORECASE):
        command.append("--expandobjects")
    command.append("in.idf")
    result = subprocess.run(command, cwd=run_dir, capture_output=True, text=True)
    if result.returncode != 0 or not (run_dir / "eplusout.sql").exists():
        raise RuntimeError(f"EnergyPlus failed for {idf.name}; see {run_dir / 'eplusout.err'}")
    sql = read_sql(run_dir / "eplusout.sql")
    for name, vertices in read_eio_surfaces(run_dir / "eplusout.eio").items():
        sql["surfaces"].setdefault(name, {}).update(vertices)
    version = re.search(r"EnergyPlus, Version ([\d.]+)", (run_dir / "eplusout.err").read_text(errors="replace"))
    oracle = {
        "source": {"file": idf.name, "energyplus": version.group(1) if version else None},
        **rounded(sql),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{idf.stem}.json"
    target.write_text(json.dumps(oracle, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--energyplus", type=Path, default=None)
    parser.add_argument("files", nargs="*", type=Path)
    args = parser.parse_args(argv)
    energyplus = args.energyplus or default_install()
    if energyplus is None:
        print("EnergyPlus not found; pass --energyplus.", file=sys.stderr)
        return 1
    files = args.files or sorted((ROOT / "examples").glob("*.idf")) + sorted(
        (ROOT / "tests" / "fixtures" / "geometry").glob("*.idf")
    )
    failures = 0
    for idf in files:
        try:
            target = run(idf, energyplus)
            print(f"{idf.name}: {target.relative_to(ROOT)}")
        except RuntimeError as error:
            failures += 1
            print(error, file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
