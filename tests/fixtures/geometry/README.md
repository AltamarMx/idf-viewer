# Geometry fixtures

Variants of `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) that exercise the
geometry rules the examples do not cover. `tools/make_oracles.py` runs them through
EnergyPlus to get the reference vertices, areas and volumes.

- `RotatedRelative.idf`: building North Axis 30°, relative coordinates, zone origin
  (10, 5, 1) rotated 15°, plus a second zone (origin (30, 0, 0.5), rotated -20°) built only
  with simplified surfaces: walls, roof, floor, window, door, overhangs, fins and
  site/building shading.
- `ClockwiseLowerLeft.idf`: world coordinates entered from the lower-left corner in
  clockwise order, with building North Axis 20° and a zone origin that must be ignored.
  It also has a zone (origin (30, 0, 0), rotated 10°) with a simplified wall, door and
  shading, whose rectangular surface coordinate system is left as Relative.
