"""Reference values computed by EnergyPlus, used only by the tests (PLAN.md §3.6).

For each IDF in ``examples/`` and ``tests/fixtures/geometry/`` this script runs the
local EnergyPlus (design days only) on a copy of the file with extra output
objects, and writes ``tests/oracles/<file stem>.json`` with:

- zones: volume, floor area, ceiling height, multipliers, exterior wall and window areas;
- surfaces: class, zone, gross and net area, azimuth, tilt and vertices
  (vertices as EnergyPlus reports them: upper-left corner first, counterclockwise,
  world coordinates, 2 decimals);
- building: total and conditioned floor area and the window-wall ratio table.

With ``--annual`` it runs a whole year (with a weather file from the install; the
values used do not depend on the weather) and writes ``<stem>.annual.json``:

- calendar: the day type EnergyPlus used for each day and the daylight saving days;
- schedules: hourly value of every schedule;
- zones: hourly occupants and internal gains of every zone;
- design days: hourly schedule values on each design day.

Hourly series are stored as the distinct daily profiles plus one index per day.

The viewer never reads simulation results: these files only check that the
viewer computes the same geometry as EnergyPlus.

Usage: uv run tools/make_oracles.py [--annual] [--energyplus /Applications/EnergyPlus-26-2-0] [files...]
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
from concurrent.futures import ThreadPoolExecutor, as_completed
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


ANNUAL_DROP = DROP_CLASSES | {
    "output:variable",
    "output:meter",
    "output:meter:meterfileonly",
    "output:meter:cumulative",
    "output:table:monthly",
    "output:table:timebins",
    "output:table:annual",
    "runperiod",
}
ANNUAL_VARIABLES = [
    "Schedule Value",
    "Zone People Occupant Count",
    "Zone People Total Heating Rate",
    "Zone Lights Electricity Rate",
    "Zone Electric Equipment Electricity Rate",
    "Zone Gas Equipment NaturalGas Rate",
    "Zone Hot Water Equipment District Heating Water Rate",
    "Zone Steam Equipment District Heating Steam Rate",
    "Zone Other Equipment Total Heating Rate",
]


def object_fields(text: str, start: int, end: int) -> list[str]:
    body = re.sub(r"!.*", "", text[start:end])
    return [f.strip() for f in body.rstrip().rstrip(";").split(",")]


def prepare_annual_input(text: str) -> str:
    """Copy of the IDF with one full-year RunPeriod (keeping the first one's
    options, such as the day of week of January 1) and hourly outputs."""
    parts = []
    last = 0
    first_run_period = None
    for class_name, start, end in object_spans(text):
        if class_name.lower() not in ANNUAL_DROP:
            continue
        if class_name.lower() == "runperiod" and first_run_period is None:
            first_run_period = object_fields(text, start, end)
        parts.append(text[last:start])
        last = end
    parts.append(text[last:])
    # fields[0] is the class name; then (9.0+) Name, Begin Month, Begin Day, Begin Year,
    # End Month, End Day, End Year, Day of Week for Start Day, ...
    fields = (first_run_period or ["RunPeriod", "Annual"]) + [""] * 16
    fields = fields[:16]
    fields[0], fields[1] = "RunPeriod", fields[1] or "Annual"
    # Keep the weekday of every date: move the start day back to January 1.
    weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    if not fields[4] and fields[8].lower() in weekdays and fields[2] and fields[3]:
        lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        offset = sum(lengths[: int(fields[2]) - 1]) + int(fields[3]) - 1
        fields[8] = weekdays[(weekdays.index(fields[8].lower()) - offset) % 7].capitalize()
    fields[2:4] = ["1", "1"]
    fields[5:7] = ["12", "31"]
    if fields[4]:
        fields[7] = fields[4]
    while fields and not fields[-1]:
        fields.pop()
    run_period = ",\n  ".join(fields) + ";"
    outputs = "\n".join(f"Output:Variable, *, {v}, Hourly;" for v in ANNUAL_VARIABLES)
    return "".join(parts) + "\n" + run_period + "\nOutput:SQLite, Simple;\n" + outputs + "\n"


def compress(values: list[float]) -> dict:
    """Hourly series → distinct daily profiles + index per day."""
    profiles: list[list[float]] = []
    index: dict[tuple, int] = {}
    days = []
    for d in range(0, len(values), 24):
        day = tuple(rounded(v) for v in values[d : d + 24])
        if day not in index:
            index[day] = len(profiles)
            profiles.append(list(day))
        days.append(index[day])
    return {"profiles": profiles, "days": days}


def read_annual_sql(sql: Path) -> dict:
    db = sqlite3.connect(sql)
    db.row_factory = sqlite3.Row
    environments = {row["EnvironmentPeriodIndex"]: (row["EnvironmentName"], row["EnvironmentType"])
                    for row in db.execute("SELECT * FROM EnvironmentPeriods")}
    run_env = [k for k, (_, kind) in environments.items() if kind == 3]
    times = {}
    calendar = []
    for row in db.execute("SELECT * FROM Time WHERE IntervalType = 1 ORDER BY TimeIndex"):
        times[row["TimeIndex"]] = row
        if row["EnvironmentPeriodIndex"] in run_env and row["Hour"] == 1:
            calendar.append({"month": row["Month"], "day": row["Day"], "dayType": row["DayType"], "dst": row["Dst"]})
    series: dict[tuple, list[float]] = {}
    design: dict[str, dict[str, list[float]]] = {}
    query = (
        "SELECT d.Name, d.KeyValue, r.TimeIndex, r.Value FROM ReportData r "
        "JOIN ReportDataDictionary d ON d.ReportDataDictionaryIndex = r.ReportDataDictionaryIndex "
        "WHERE d.ReportingFrequency = 'Hourly' ORDER BY r.TimeIndex"
    )
    for row in db.execute(query):
        time = times.get(row["TimeIndex"])
        if time is None or time["WarmupFlag"]:
            continue
        env = time["EnvironmentPeriodIndex"]
        if env in run_env:
            series.setdefault((row["Name"], row["KeyValue"]), []).append(row["Value"])
        elif row["Name"] == "Schedule Value":
            name = environments[env][0]
            design.setdefault(name, {}).setdefault(row["KeyValue"], []).append(row["Value"])
    db.close()
    schedules = {}
    zones: dict[str, dict] = {}
    for (name, key), values in series.items():
        if name == "Schedule Value":
            schedules[key] = compress(values)
        else:
            zones.setdefault(key, {})[name] = compress(values)
    design_days = {
        dd: {k: [rounded(v) for v in vals[:24]] for k, vals in values.items()} for dd, values in design.items()
    }
    return {
        "calendar": {
            "dayTypes": [c["dayType"] for c in calendar],
            "dates": [f'{c["month"]}/{c["day"]}' for c in calendar],
            "dstDays": [i for i, c in enumerate(calendar) if c["dst"]],
        },
        "schedules": schedules,
        "zones": zones,
        "designDays": design_days,
    }


def default_weather(energyplus: Path) -> Path:
    files = sorted((energyplus / "WeatherData").glob("*Chicago*.epw")) or sorted(
        (energyplus / "WeatherData").glob("*.epw")
    )
    if not files:
        raise RuntimeError("No weather file found in the EnergyPlus install")
    return files[0]


def run_annual(idf: Path, energyplus: Path) -> Path:
    run_dir = RUNS / f"{idf.stem}.annual"
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    text = idf.read_bytes().decode("utf-8", errors="replace")
    (run_dir / "in.idf").write_text(prepare_annual_input(text), encoding="utf-8")
    command = [
        str(energyplus / "energyplus"),
        "--annual",
        "--weather",
        str(default_weather(energyplus)),
        "--output-directory",
        str(run_dir),
    ]
    if re.search(r"^\s*HVACTemplate:", text, re.MULTILINE | re.IGNORECASE):
        command.append("--expandobjects")
    command.append("in.idf")
    result = subprocess.run(command, cwd=run_dir, capture_output=True, text=True)
    if result.returncode != 0 or not (run_dir / "eplusout.sql").exists():
        raise RuntimeError(f"EnergyPlus failed for {idf.name}; see {run_dir / 'eplusout.err'}")
    data = read_annual_sql(run_dir / "eplusout.sql")
    oracle = {"source": {"file": idf.name, "energyplus": "26.2", "weather": default_weather(energyplus).name}, **data}
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{idf.stem}.annual.json"
    target.write_text(json.dumps(oracle, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--energyplus", type=Path, default=None)
    parser.add_argument("--annual", action="store_true", help="whole-year schedules and loads")
    parser.add_argument("files", nargs="*", type=Path)
    args = parser.parse_args(argv)
    energyplus = args.energyplus or default_install()
    if energyplus is None:
        print("EnergyPlus not found; pass --energyplus.", file=sys.stderr)
        return 1
    fixtures = "schedules" if args.annual else "geometry"
    files = args.files or sorted((ROOT / "examples").glob("*.idf")) + sorted(
        (ROOT / "tests" / "fixtures" / fixtures).glob("*.idf")
    )
    worker = run_annual if args.annual else run
    failures = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(worker, idf, energyplus): idf for idf in files}
        for future in as_completed(futures):
            idf = futures[future]
            try:
                print(f"{idf.name}: {future.result().relative_to(ROOT)}", flush=True)
            except RuntimeError as error:
                failures += 1
                print(error, file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
