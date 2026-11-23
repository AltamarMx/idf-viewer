# Validation fixtures

- `Validation.idf`: `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) with input mistakes made
  on purpose for the checks against the IDD: a second `Timestep` and a second
  `SimulationControl` (unique classes), the latter with decimals in an integer field; a
  `Material` with a roughness that is not an option, a thickness that is not a number, a blank
  conductivity, a specific heat below the minimum and a solar absorptance above the maximum; a
  `Material:AirGap` with one field too many; and a `People` with "autosize" in a field that
  accepts neither autosize nor autocalculate (and "autocalculate" where it is accepted). It
  also has an unused material, construction, schedule and curve, and two schedules named only
  by an EMS actuator and by an `Output:Variable`, which count as used. EnergyPlus does not run
  it; it has no reference.
