# Geometry fixtures

Variants of `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) that exercise the
geometry rules the examples do not cover. `tools/make_oracles.py` runs them through
EnergyPlus to get the reference vertices, areas and volumes.

- `RotatedRelative.idf`: building North Axis 30°, relative coordinates, zone origin
  (10, 5, 1) rotated 15°, plus a second zone (origin (30, 0, 0.5), rotated -20°) built only
  with simplified surfaces: walls, roof, floor, window, door, overhangs, fins and
  site/building shading, and two daylighting reference points in that zone (one with Z blank).
- `ClockwiseLowerLeft.idf`: world coordinates entered from the lower-left corner in
  clockwise order, with building North Axis 20° and a zone origin that must be ignored.
  It also has a zone (origin (30, 0, 0), rotated 10°) with a simplified wall, door and
  shading, whose rectangular surface coordinate system is left as Relative.
- `Defects.idf`: one geometry mistake per zone (built from `examples/1ZoneUncontrolled.idf`
  with 3 × 3 × 3 m boxes), to check that the viewer reports the same geometry warnings as
  EnergyPlus: roof and floor upside down, walls out of plane by 5 and 30 cm, a 0.3 mm sliver,
  a repeated vertex and a vertex in a straight line, a window past the end of its wall and
  one 10 cm off its wall (EnergyPlus does not report this one), interzone pairs that face
  the same way, differ in area or lean 2°, a zone without roof (with and without its volume
  written), a roof leaning 85°, a 3 × 3 cm window, and a zone whose missing wall comes from
  a "Zone" boundary in the zone next to it (EnergyPlus makes that side, so it closes).
