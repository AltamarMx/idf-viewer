# Window fixtures

- `Windows.idf`: `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) with one opening of
  each kind: a detailed window with frame and shade (south), a simplified window (east), a
  glass door (north), a door and three windows with a multiplier (west) and a skylight.
  Glazing uses `WindowMaterial:SimpleGlazingSystem`. A `WindowShadingControl` lists two
  windows. The AirflowNetwork has a crack, effective leakage areas (the door and the
  skylight), a simple opening, a detailed opening with three opening factor sets, and
  surfaces with `ZoneLevel` and `Constant` control. EnergyPlus allows no operable opening on
  an exterior skylight (a `HorizontalOpening` must be between two zones and a
  `SimpleOpening` cannot be within 10° of horizontal), so the skylight only leaks; the
  horizontal opening is in `tests/fixtures/ventilation/Network.idf`. The west windows are a
  simplified `Window` that names a frame, which EnergyPlus ignores.
- `Windows-8.9.idf`: `tests/fixtures/1ZoneUncontrolled-8.9.idf` with a detailed and a
  simplified window that name their `WindowProperty:ShadingControl`, as before 9.0.
