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
