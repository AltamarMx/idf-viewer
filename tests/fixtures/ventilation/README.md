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
  window and an EMS actuator on an opening. EnergyPlus does not run it; it has no reference.
- `Wind.idf`: `tests/fixtures/windows/Windows.idf` with Cp `Input` and one external node
  per facade, each with a different source of Cp: `WindPressureCoefficientValues` (south,
  west, roof), a symmetric `Table:Lookup` with relative angle (east) and a symmetric
  `Curve:Quadratic` with relative angle and output limits (north). `Site:HeightVariation`
  gives only the exponent, and `Site:WeatherStation` puts the wind sensor at 12 m.
- `Wind-8.2.idf` and `Wind-8.9.idf`: two cracked walls of `1ZoneUncontrolled` with external
  nodes. In 8.2 the node names a `WindPressureCoefficientValues` and the array is also named
  on `AirflowNetwork:SimulationControl`; in 8.9 one node uses a symmetric
  `Table:OneIndependentVariable` with relative angle.
