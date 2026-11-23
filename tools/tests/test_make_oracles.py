"""Tests for the parts of tools/make_oracles.py that do not need EnergyPlus."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import make_oracles  # noqa: E402


def test_object_spans_skip_comments():
    text = "Version, 26.2; ! comment; with, separators\nZone,\n  Z1;  !- Name\n"
    spans = [(name, text[start:end]) for name, start, end in make_oracles.object_spans(text)]
    assert spans == [("Version", "Version, 26.2;"), ("Zone", "Zone,\n  Z1;")]


def test_prepare_input_replaces_unique_output_objects():
    text = "Version,26.2;\nOutput:SQLite, Simple;\nOutput:Table:SummaryReports, AllSummary;\nZone, Z1;\n"
    prepared = make_oracles.prepare_input(text)
    assert "Output:SQLite, Simple;" not in prepared
    assert "AllSummary" not in prepared
    assert "Zone, Z1;" in prepared
    assert "Output:SQLite, SimpleAndTabular;" in prepared
    assert "Output:Surfaces:List, DetailsWithVertices;" in prepared


def test_read_eio_surfaces(tmp_path):
    eio = tmp_path / "eplusout.eio"
    cells = ["HeatTransfer Surface", "WALL 1"] + ["x"] * 24 + ["3", "0", "0", "1", "0", "0", "0", "2", "0", "0"]
    eio.write_text(
        "Frame/Divider Surface,F1,Frame,W1\n" + ",".join(cells) + "\n", encoding="latin-1"
    )
    assert make_oracles.read_eio_surfaces(eio) == {
        "WALL 1": {"vertices": [[0.0, 0.0, 1.0], [0.0, 0.0, 0.0], [2.0, 0.0, 0.0]]}
    }


def test_rounded_keeps_six_significant_digits():
    assert make_oracles.rounded({"a": [1.23456789, 1061.8834]}) == {"a": [1.23457, 1061.88]}


def test_prepare_annual_input_keeps_start_day_and_makes_a_full_year():
    text = (
        "Version,26.2;\n"
        "RunPeriod, Jan, 1, 14, , 1, 14, , Tuesday, Yes, Yes, No, Yes, Yes;\n"
        "RunPeriod, Jul, 7, 7, , 7, 7, , Tuesday;\n"
        "Output:Variable, *, Zone Mean Air Temperature, Timestep;\n"
        "Zone, Z1;\n"
    )
    prepared = make_oracles.prepare_annual_input(text)
    assert "Jul" not in prepared
    assert "Zone Mean Air Temperature" not in prepared
    # January 14 was a Tuesday, so January 1 is a Wednesday.
    assert "RunPeriod,\n  Jan,\n  1,\n  1,\n  ,\n  12,\n  31,\n  ,\n  Wednesday,\n  Yes," in prepared
    assert "Output:Variable, *, Schedule Value, Hourly;" in prepared


def test_compress_keeps_distinct_days():
    values = [0.0] * 24 + [1.0] * 24 + [0.0] * 24
    assert make_oracles.compress(values) == {"profiles": [[0.0] * 24, [1.0] * 24], "days": [0, 1, 0]}


def test_read_eio_airflow(tmp_path):
    eio = tmp_path / "eplusout.eio"
    eio.write_text(
        "! <ZoneInfiltration Airflow Stats Nominal>, Name, Schedule Name, Zone Name, Design Volume Flow Rate {m3/s}, ACH - Air Changes per Hour\n"
        "ZoneInfiltration Airflow Stats Nominal, INF 1, SCH, ZONE 1, 0.032, 0.48\n"
        "HeatTransfer Surface, WALL 1\n",
        encoding="latin-1",
    )
    assert make_oracles.read_eio_airflow(eio) == {
        "ZoneInfiltration Airflow Stats Nominal": [
            {
                "Name": "INF 1",
                "Schedule Name": "SCH",
                "Zone Name": "ZONE 1",
                "Design Volume Flow Rate {m3/s}": 0.032,
                "ACH - Air Changes per Hour": 0.48,
            }
        ]
    }


def test_read_eio_site(tmp_path):
    eio = tmp_path / "eplusout.eio"
    eio.write_text(
        "! <Environment:Site Atmospheric Variation>,Wind Speed Profile Exponent {},"
        "Wind Speed Profile Boundary Layer Thickness {m},Air Temperature Gradient Coefficient {K/m}\n"
        "Environment:Site Atmospheric Variation,0.250,370.000,6.500000E-003\n"
        "! <Environment:Weather Station>,Wind Sensor Height Above Ground {m},Wind Speed Profile Exponent {}\n"
        "Environment:Weather Station,12.000,0.140\n"
        "! <ZoneInfiltration Airflow Stats Nominal>, Name\n"
        "ZoneInfiltration Airflow Stats Nominal, INF 1\n",
        encoding="latin-1",
    )
    assert make_oracles.read_eio_site(eio) == {
        "Environment:Site Atmospheric Variation": [
            {
                "Wind Speed Profile Exponent {}": 0.25,
                "Wind Speed Profile Boundary Layer Thickness {m}": 370.0,
                "Air Temperature Gradient Coefficient {K/m}": 0.0065,
            }
        ],
        "Environment:Weather Station": [
            {"Wind Sensor Height Above Ground {m}": 12.0, "Wind Speed Profile Exponent {}": 0.14}
        ],
    }
