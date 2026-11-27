# Ventilation fixtures

- `Flows.idf`: `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) with infiltration by air
  changes (BLAST coefficients), by floor area (constant), by exterior wall area (DOE-2) and
  by effective leakage area, a natural ventilation object with temperature limits, and a
  wind and stack open area.
- `Flows-8.9.idf`: the same objects added to `tests/fixtures/1ZoneUncontrolled-8.9.idf`,
  whose field names differ ("Flow per Zone Floor Area", "Zone or ZoneList Name").
- `AfnErrors.idf`: `tests/fixtures/windows/Windows.idf` with AirflowNetwork mistakes made
  on purpose, for the ventilation checks of the problems panel: Cp `Input` with exterior
  surfaces without external node, no `AirflowNetwork:MultiZone:Zone`, a detailed opening
  whose opening factors do not go from 0 to 1 and with Cd 1.3, inverted ΔT limits, zone
  infiltration in a network zone, a surface that does not exist, a triangular operable
  window, an EMS actuator on an opening and a `HorizontalOpening` on the exterior skylight.
  EnergyPlus does not run it; it has no reference.
- `Wind.idf`: `tests/fixtures/windows/Windows.idf` with Cp `Input` and one external node
  per facade, each with a different source of Cp: `WindPressureCoefficientValues` (south,
  west, roof), a symmetric `Table:Lookup` with relative angle (east) and a symmetric
  `Curve:Quadratic` with relative angle and output limits (north). `Site:HeightVariation`
  gives only the exponent, and `Site:WeatherStation` puts the wind sensor at 12 m.
- `Wind-8.2.idf` and `Wind-8.9.idf`: two cracked walls of `1ZoneUncontrolled` with external
  nodes. In 8.2 the node names a `WindPressureCoefficientValues` and the array is also named
  on `AirflowNetwork:SimulationControl`; in 8.9 one node uses a symmetric
  `Table:OneIndependentVariable` with relative angle.
- `Network.idf`: `examples/5ZoneAirCooledWithSpaces.idf` (plenum and 5 zones, North Axis 30°)
  with an AirflowNetwork for the flow network diagram: `MultizoneWithoutDistribution` with
  `SurfaceAverageCalculation`, cracks on the exterior walls and on the interzone walls SB12
  and SB32 (SB32 listed from Zone 3's side), a detailed opening on the front window (opening
  factor 0.5), a 1 × 1 m hatch (a pair of interzone doors) from Zone 1 to the plenum with a
  `HorizontalOpening`, a crack on a plenum wall, a zone exhaust fan on BACK-2, a network
  zone without surfaces (Zone 5), a `ZoneMixing` from Zone 4 to Zone 5 and a
  `ZoneCrossMixing` between Zone 3 and Zone 5. Two mistakes are on purpose and the viewer
  reports both: the exhaust fan has no `Fan:ZoneExhaust` and Zone 5 has no surfaces in the
  network, so EnergyPlus does not run it and it has no reference. Without them, EnergyPlus
  26.2 runs it.
