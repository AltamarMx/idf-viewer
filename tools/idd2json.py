"""Convert EnergyPlus IDD files into the compact JSON schemas used by the viewer.

For each ``idd/<version>.idd`` it writes:

- ``public/schemas/<version>.json``: classes, fields, units, defaults, ranges,
  choices, groups and reference lists.
- ``public/schemas/<version>.docs.json``: the long ``\\memo`` and ``\\note`` texts,
  downloaded by the viewer only when field help is shown.
- ``public/schemas/index.json``: the list of available versions.

Extensible objects (vertices, compact schedules...) only keep their first group
of fields plus a name template, so the schema does not grow with the hundreds of
repeated fields the IDD lists.

Usage: uv run tools/idd2json.py [--idd-dir idd] [--out-dir public/schemas]
Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Annotations that are kept as text, attached to a field or to the class.
_LIST_FIELD_ANNOTATIONS = {
    "reference": "reference",
    "object-list": "objectList",
    "external-list": "externalList",
    "key": "keys",
}
_NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$")
_FIELD_ID = re.compile(r"^([AN])(\d+)$", re.IGNORECASE)
_TRAILING_NUMBER = re.compile(r"^(.*?)(\d+)(\D*)$")


@dataclass
class Field:
    id: str
    props: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    has_name: bool = False


@dataclass
class IddClass:
    name: str
    group: str | None
    props: dict = field(default_factory=dict)
    memo: list[str] = field(default_factory=list)
    fields: list[Field] = field(default_factory=list)
    extensible_size: int | None = None
    begin_extensible: int | None = None


def decode_idd(data: bytes) -> str:
    """Old IDD files are not always UTF-8; fall back to Windows-1252, then Latin-1."""
    for encoding in ("utf-8", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def parse_version(text: str) -> tuple[str, str | None]:
    """Return ("26.2", build) from the ``!IDD_Version`` header."""
    match = re.search(r"^!IDD_Version\s+(\d+)\.(\d+)", text, re.MULTILINE)
    if not match:
        raise ValueError("IDD has no !IDD_Version header")
    build = re.search(r"^!IDD_BUILD\s+(\S+)", text, re.MULTILINE)
    return f"{int(match.group(1))}.{int(match.group(2))}", build.group(1) if build else None


def _to_number(value: str) -> float | int | None:
    value = value.strip()
    if not _NUMBER.match(value):
        return None
    number = float(value.replace("d", "e").replace("D", "e"))
    return int(number) if number.is_integer() and "." not in value and "e" not in value.lower() else number


def _split_line(line: str) -> tuple[str, str | None]:
    """Split a line into its data part and its ``\\annotation`` part."""
    slash = line.find("\\")
    data, annotation = (line, None) if slash < 0 else (line[:slash], line[slash + 1 :])
    bang = data.find("!")
    if bang >= 0:
        data = data[:bang]
    return data, annotation


def parse_idd(text: str) -> tuple[list[str], list[IddClass]]:
    """Parse an IDD into groups (in order) and classes (in order)."""
    groups: list[str] = []
    classes: list[IddClass] = []
    group: str | None = None
    current: IddClass | None = None
    in_object = False

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("!"):
            continue
        data, annotation = _split_line(line)

        # Data part: class name, then field ids separated by "," and ended by ";".
        token = ""
        for char in data:
            if char not in ",;":
                token += char
                continue
            token = token.strip()
            if not in_object:
                if token:
                    current = IddClass(name=token, group=group)
                    classes.append(current)
                    in_object = char == ","
            elif token and current is not None:
                if not _FIELD_ID.match(token):
                    raise ValueError(f"Unexpected token {token!r} in class {current.name}")
                current.fields.append(Field(id=token.upper()))
                if char == ";":
                    in_object = False
            token = ""
        if token.strip() and not in_object:
            # A class name on a line of its own without separator never happens in
            # valid IDDs; ignore it to stay tolerant.
            pass

        if annotation is None:
            continue
        _apply_annotation(annotation.strip(), current, groups, classes)
        if annotation.lower().startswith("group"):
            group = annotation.split(None, 1)[1].strip() if " " in annotation.strip() else None
            if group and group not in groups:
                groups.append(group)

    return groups, classes


def _apply_annotation(annotation: str, current: IddClass | None, groups, classes) -> None:
    parts = annotation.split(None, 1)
    if not parts:
        return
    keyword = parts[0].lower()
    value = parts[1].strip() if len(parts) > 1 else ""
    if keyword == "group" or current is None:
        return

    # Annotations before the first field belong to the class.
    if not current.fields:
        if keyword == "memo":
            current.memo.append(value)
        elif keyword == "unique-object":
            current.props["unique"] = True
        elif keyword == "required-object":
            current.props["required"] = True
        elif keyword == "min-fields":
            number = _to_number(value.split()[0]) if value else None
            if number:
                current.props["minFields"] = int(number)
        elif keyword.startswith("extensible"):
            match = re.match(r"extensible:(\d+)", keyword)
            if match:
                current.extensible_size = int(match.group(1))
        elif keyword == "format":
            current.props["format"] = value
        elif keyword == "obsolete":
            current.props["obsolete"] = value or True
        elif keyword == "reference-class-name":
            current.props.setdefault("refClass", []).append(value)
        return

    target = current.fields[-1]
    props = target.props
    if keyword == "field":
        props["name"] = value
        target.has_name = True
    elif keyword in ("note", "memo"):
        target.notes.append(value)
    elif keyword == "required-field":
        props["required"] = True
    elif keyword == "begin-extensible":
        # Some old IDDs repeat the marker on later groups; the first one counts.
        if current.begin_extensible is None:
            current.begin_extensible = len(current.fields) - 1
    elif keyword == "type":
        props["type"] = value.lower()
    elif keyword == "units":
        props["units"] = value
    elif keyword == "unitsbasedonfield":
        props["unitsBasedOnField"] = value
    elif keyword == "default":
        props["default"] = value
    elif keyword in ("minimum", "minimum>", "maximum", "maximum<"):
        _apply_limit(props, keyword, value)
    elif keyword in _LIST_FIELD_ANNOTATIONS:
        props.setdefault(_LIST_FIELD_ANNOTATIONS[keyword], []).append(value)
    elif keyword == "autosizable":
        props["autosizable"] = True
    elif keyword == "autocalculatable":
        props["autocalculatable"] = True
    elif keyword == "deprecated":
        props["deprecated"] = True
    elif keyword == "retaincase":
        props["retainCase"] = True
    elif keyword == "reference-class-name":
        props.setdefault("referenceClassName", []).append(value)


def _apply_limit(props: dict, keyword: str, value: str) -> None:
    # Forms: "\minimum 0", "\minimum> 0", "\minimum >0", "\maximum< 1".
    exclusive = keyword.endswith((">", "<"))
    if value[:1] in "<>":
        exclusive = True
        value = value[1:]
    number = _to_number(value.split()[0]) if value.split() else None
    if number is None:
        return
    base = "min" if keyword.startswith("minimum") else "max"
    props[base] = number
    if exclusive:
        props[f"{base}Exclusive"] = True


def _fill_unnamed(fields: list[Field], size: int | None) -> None:
    """Name the fields that have no \\field (e.g. "N3,N4,N5," in Schedule:Day:List
    8.x). In an extensible object they copy the field one group back, otherwise
    the previous name with its number incremented; as a last resort, their id."""
    for i, fld in enumerate(fields):
        if fld.has_name:
            continue
        source = None
        if size and i - size >= 0:
            source = fields[i - size].props["name"]
        elif i > 0:
            source = fields[i - 1].props["name"]
        match = _TRAILING_NUMBER.match(source) if source else None
        if match:
            fld.props["name"] = f"{match.group(1)}{int(match.group(2)) + 1}{match.group(3)}"
        elif source and size:
            fld.props["name"] = source
        else:
            fld.props["name"] = fld.id


def _name_template(first: str, second: str | None) -> tuple[str, int] | None:
    """Turn "Vertex 1 X-coordinate" (and "Vertex 2 X-coordinate") into
    ("Vertex {n} X-coordinate", 1)."""
    first_runs = list(re.finditer(r"\d+", first))
    if not first_runs:
        return None
    if second is not None:
        second_runs = list(re.finditer(r"\d+", second))
        if len(second_runs) != len(first_runs):
            return None
        for a, b in zip(first_runs, second_runs, strict=True):
            if a.group() != b.group():
                return first[: a.start()] + "{n}" + first[a.end() :], int(a.group())
        return None
    run = first_runs[-1]
    return first[: run.start()] + "{n}" + first[run.end() :], int(run.group())


def _effective_type(fld: Field) -> str:
    return fld.props.get("type") or ("alpha" if fld.id.startswith("A") else "real")


def _guess_extensible_start(fields: list[Field], size: int, begin: int | None) -> int:
    """Find the first field of the extensible group. Some old IDDs omit
    \\begin-extensible or put it on the wrong field, so the marker is checked
    against the repeating pattern of names (ignoring numbers) and types."""

    def shape(fld: Field) -> tuple[str, str]:
        return re.sub(r"\d+", "#", fld.props["name"]), _effective_type(fld)

    def same(a: int, b: int) -> bool:
        if a < 0 or b < 0 or a + size > len(fields) or b + size > len(fields):
            return False
        return all(shape(fields[a + k]) == shape(fields[b + k]) for k in range(size))

    start = begin if begin is not None else max(len(fields) - size, 0)
    # A marker on a field that does not repeat (e.g. the list name in 8.0
    # ZoneTerminalUnitList) moves forward to the first group that repeats.
    if not same(start, start + size) and not same(start, start - size):
        candidate = start + size
        while candidate + 2 * size <= len(fields) and not same(candidate, candidate + size):
            candidate += size
        if same(candidate, candidate + size):
            start = candidate
    # Groups listed before the marker with the same pattern belong to it too.
    while same(start - size, start):
        start -= size
    return start


def _field_json(fld: Field) -> dict:
    props = dict(fld.props)
    if "type" not in props:
        props["type"] = "alpha" if fld.id.startswith("A") else "real"
    if "default" in props and props["type"] in ("real", "integer"):
        number = _to_number(props["default"])
        if number is not None:
            props["default"] = number
    ordered = {"name": props.pop("name")}
    ordered.update(props)
    return ordered


def class_to_json(cls: IddClass) -> tuple[dict, dict]:
    """Return (schema entry, docs entry) for one class."""
    _fill_unnamed(cls.fields, cls.extensible_size)
    entry: dict = {"name": cls.name}
    if cls.group:
        entry["group"] = cls.group
    entry.update(cls.props)

    fields = cls.fields
    keep = len(fields)
    if cls.extensible_size:
        size = cls.extensible_size
        start = _guess_extensible_start(fields, size, cls.begin_extensible)
        keep = min(start + size, len(fields))
        entry["extensible"] = {"size": size, "start": start}
    entry["fields"] = [_field_json(f) for f in fields[:keep]]

    if cls.extensible_size:
        size, start = entry["extensible"]["size"], entry["extensible"]["start"]
        for k in range(start, keep):
            second_index = k + size
            second = fields[second_index].props["name"] if second_index < len(fields) else None
            template = _name_template(entry["fields"][k]["name"], second)
            if template:
                entry["fields"][k]["tpl"] = template[0]
                if template[1] != 1:
                    entry["fields"][k]["n0"] = template[1]

    docs: dict = {}
    if cls.memo:
        docs["memo"] = "\n".join(cls.memo)
    notes = {str(i): "\n".join(f.notes) for i, f in enumerate(fields[:keep]) if f.notes}
    if notes:
        docs["notes"] = notes
    return entry, docs


def convert(text: str) -> tuple[dict, dict]:
    version, build = parse_version(text)
    groups, classes = parse_idd(text)
    schema_classes: dict = {}
    docs_classes: dict = {}
    for cls in classes:
        key = cls.name.lower()
        entry, docs = class_to_json(cls)
        schema_classes[key] = entry
        if docs:
            docs_classes[key] = docs
    schema = {"version": version, "build": build, "groups": groups, "classes": schema_classes}
    return schema, {"version": version, "classes": docs_classes}


def _version_key(version: str) -> tuple[int, int]:
    major, minor = version.split(".")
    return int(major), int(minor)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--idd-dir", type=Path, default=ROOT / "idd")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "public" / "schemas")
    args = parser.parse_args(argv)

    idd_files = sorted(args.idd_dir.glob("*.idd"))
    if not idd_files:
        print(f"No .idd files in {args.idd_dir}. Run tools/fetch_idds.py first.", file=sys.stderr)
        return 1
    args.out_dir.mkdir(parents=True, exist_ok=True)

    versions = []
    for path in idd_files:
        schema, docs = convert(decode_idd(path.read_bytes()))
        version = schema["version"]
        compact = {"separators": (",", ":"), "ensure_ascii": False}
        (args.out_dir / f"{version}.json").write_text(json.dumps(schema, **compact), encoding="utf-8")
        (args.out_dir / f"{version}.docs.json").write_text(json.dumps(docs, **compact), encoding="utf-8")
        versions.append(version)
        print(f"{path.name}: {version}, {len(schema['classes'])} classes")

    license_file = args.idd_dir / "LICENSE-EnergyPlus.txt"
    if license_file.exists():
        shutil.copyfile(license_file, args.out_dir / "LICENSE-EnergyPlus.txt")

    versions.sort(key=_version_key)
    index = {"versions": versions}
    (args.out_dir / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(versions)} schemas to {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
