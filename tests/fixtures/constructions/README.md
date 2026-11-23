# Construction fixtures

- `Constructions.idf`: `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) with a three-layer
  wall (brick, air gap and gypsum, the gypsum with its absortances written and the brick
  without them) used by `Zn001:Wall001` and with a `ConstructionProperty:InternalHeatSource`
  after the first layer; a double glazing with argon; the same glazing with an interior shade,
  named only by a `WindowShadingControl`; a construction whose second layer does not exist;
  and an unused `Construction:CfactorUndergroundWall`. EnergyPlus does not run it (the
  shading control has no windows); it has no reference.
- `Constructions-8.9.idf`: `tests/fixtures/1ZoneUncontrolled-8.9.idf` with the same materials
  and a `Construction:InternalSource` (removed in 22.1) used by `Zn001:Wall001`.
