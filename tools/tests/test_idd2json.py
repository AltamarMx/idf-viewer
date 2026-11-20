"""Tests for tools/idd2json.py using small IDD snippets that mimic real cases."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import idd2json  # noqa: E402

HEADER = "!IDD_Version 26.2.0\n!IDD_BUILD abc123\n"

SURFACE = r"""
\group Thermal Zones and Surfaces

BuildingSurface:Detailed,
  \memo Allows for detailed entry of building heat transfer surfaces.
  \extensible:3 -- duplicate last set of x,y,z coordinates
  \format vertices
  \min-fields 20
  A1 , \field Name
       \required-field
       \type alpha
       \reference SurfaceNames
       \reference AllHeatTranSurfNames
  A2 , \field Outside Boundary Condition
       \type choice
       \key Outdoors
       \key Surface
  N1,  \field View Factor to Ground
       \minimum 0.0
       \maximum 1.0
       \default autocalculate
       \autocalculatable
  N2,  \field Number of Vertices
       \note shown with 3 vertex coordinates
       \minimum> 2
  N3,  \field Vertex 1 X-coordinate
       \begin-extensible
       \units m
  N4,  \field Vertex 1 Y-coordinate
       \units m
  N5,  \field Vertex 1 Z-coordinate
       \units m
  N6,  \field Vertex 2 X-coordinate
       \units m
  N7,  \field Vertex 2 Y-coordinate
       \units m
  N8;  \field Vertex 2 Z-coordinate
       \units m
"""


def convert(body: str) -> dict:
    schema, _docs = idd2json.convert(HEADER + body)
    return schema


def test_version_and_build():
    schema = convert(SURFACE)
    assert schema["version"] == "26.2"
    assert schema["build"] == "abc123"
    assert schema["groups"] == ["Thermal Zones and Surfaces"]


def test_class_is_keyed_lowercase_and_keeps_its_name():
    cls = convert(SURFACE)["classes"]["buildingsurface:detailed"]
    assert cls["name"] == "BuildingSurface:Detailed"
    assert cls["group"] == "Thermal Zones and Surfaces"
    assert cls["minFields"] == 20
    assert cls["format"] == "vertices"


def test_field_properties():
    fields = convert(SURFACE)["classes"]["buildingsurface:detailed"]["fields"]
    name, bc, vf, nv = fields[:4]
    assert name == {
        "name": "Name",
        "required": True,
        "type": "alpha",
        "reference": ["SurfaceNames", "AllHeatTranSurfNames"],
    }
    assert bc["type"] == "choice" and bc["keys"] == ["Outdoors", "Surface"]
    assert vf["min"] == 0 and vf["max"] == 1 and vf["default"] == "autocalculate"
    assert vf["autocalculatable"] is True
    assert nv["min"] == 2 and nv["minExclusive"] is True
    assert nv["type"] == "real"


def test_extensible_keeps_first_group_with_name_template():
    cls = convert(SURFACE)["classes"]["buildingsurface:detailed"]
    assert cls["extensible"] == {"size": 3, "start": 4}
    assert len(cls["fields"]) == 7
    assert cls["fields"][4]["tpl"] == "Vertex {n} X-coordinate"
    assert cls["fields"][6]["units"] == "m"


def test_docs_are_separate():
    _schema, docs = idd2json.convert(HEADER + SURFACE)
    entry = docs["classes"]["buildingsurface:detailed"]
    assert entry["memo"].startswith("Allows for detailed entry")
    assert entry["notes"] == {"3": "shown with 3 vertex coordinates"}


def test_numeric_defaults_become_numbers():
    body = r"""
\group Simulation Parameters
Timestep,
  \unique-object
  N1 ; \field Number of Timesteps per Hour
       \type integer
       \default 6
"""
    cls = convert(body)["classes"]["timestep"]
    assert cls["unique"] is True
    assert cls["fields"][0]["default"] == 6


def test_case_insensitive_annotations_and_classes_without_fields():
    body = r"""
Lead Input;
\Group Schedules
Schedule:Constant,
  A1 , \Field Name
       \Required-field
  N1 ; \field Hourly Value
       \Default 0
"""
    schema = convert(body)
    assert "lead input" in schema["classes"]
    cls = schema["classes"]["schedule:constant"]
    assert cls["group"] == "Schedules"
    assert cls["fields"][0] == {"name": "Name", "required": True, "type": "alpha"}


def test_unnamed_fields_on_one_line_get_incremented_names():
    # Schedule:Day:List in 8.0 lists "N3,N4,N5," without \field names.
    body = r"""
\group Schedules
Schedule:Day:List,
  A1 , \field Name
  N1 , \field Value 1
  N2,N3, N4; \note fields as indicated
"""
    names = [f["name"] for f in convert(body)["classes"]["schedule:day:list"]["fields"]]
    assert names == ["Name", "Value 1", "Value 2", "Value 3", "Value 4"]


def test_repeated_begin_extensible_uses_the_first():
    # Output:Table:SummaryReports in 8.0 repeats the marker on later fields.
    body = r"""
\group Output Reporting
Output:Table:SummaryReports,
  \extensible:1
  A1, \field Report 1 Name
      \begin-extensible
  A2, \field Report 2 Name
      \begin-extensible
  A3; \field Report 3 Name
"""
    cls = convert(body)["classes"]["output:table:summaryreports"]
    assert cls["extensible"] == {"size": 1, "start": 0}
    assert cls["fields"] == [{"name": "Report 1 Name", "type": "alpha", "tpl": "Report {n} Name"}]


def test_misplaced_begin_extensible_moves_to_repeating_group():
    # ZoneTerminalUnitList in 8.0 marks the list name instead of the first unit.
    body = r"""
\group HVAC
ZoneTerminalUnitList,
  \extensible:1
  A1 , \field Zone Terminal Unit List Name
       \begin-extensible
  A2 , \field Zone Terminal Unit Name 1
  A3 , \field Zone Terminal Unit Name 2
  A4 ; \field Zone Terminal Unit Name 3
"""
    cls = convert(body)["classes"]["zoneterminalunitlist"]
    assert cls["extensible"]["start"] == 1
    assert cls["fields"][1]["tpl"] == "Zone Terminal Unit Name {n}"


def test_late_begin_extensible_moves_back_to_first_repetition():
    # Site:SpectrumData puts the marker on the third Wavelength/Spectrum pair.
    body = r"""
\group Location and Climate
Site:SpectrumData,
  \extensible:2
  A1, \field Name
  N1, \field Wavelength
  N2, \field Spectrum
  N3, \field Wavelength
  N4, \field Spectrum
  N5, \field Wavelength
      \begin-extensible
  N6; \field Spectrum
"""
    cls = convert(body)["classes"]["site:spectrumdata"]
    assert cls["extensible"] == {"size": 2, "start": 1}
    assert [f["name"] for f in cls["fields"]] == ["Name", "Wavelength", "Spectrum"]


def test_name_template_with_offset():
    assert idd2json._name_template("Field 1", "Field 2") == ("Field {n}", 1)
    assert idd2json._name_template("Value 0", "Value 1") == ("Value {n}", 0)
    assert idd2json._name_template("Wavelength", "Wavelength") is None


def test_decode_falls_back_to_windows_1252():
    text = idd2json.decode_idd("!IDD_Version 8.0.0.008\n! Grados °C\n".encode("cp1252"))
    assert "°C" in text


def test_missing_version_header_fails():
    with pytest.raises(ValueError):
        idd2json.convert("Version,\n A1; \\field Version Identifier\n")
