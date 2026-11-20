# Schedule fixture

`Schedules.idf` is `examples/1ZoneUncontrolled.idf` (EnergyPlus 26.2) with:

- a full-year run period starting on a Wednesday, with the weekend holiday rule;
- special days written in every date format (`January 1`, `Last Monday in May`,
  `9/6`, `1st Monday in September`, `4th Thursday in November`, `15 October`), custom days
  and daylight saving time;
- every schedule type: `Schedule:Compact` (Average and Linear interpolation, all day
  types), `Schedule:Year`, `Schedule:Week:Daily`, `Schedule:Week:Compact`,
  `Schedule:Day:Hourly`, `Schedule:Day:Interval`, `Schedule:Day:List`, `Schedule:Constant`;
- a second zone (multiplier 2), a `ZoneList`, and People, Lights, ElectricEquipment,
  GasEquipment, HotWaterEquipment and SteamEquipment with different calculation methods.

`tools/make_oracles.py --annual` runs it for a whole year to get reference values.
