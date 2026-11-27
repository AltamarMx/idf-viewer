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

`HalfHour.idf` has five 5 × 5 × 3 m zones (built from `examples/1ZoneUncontrolled.idf`) with
one person each, an `OnOff` occupancy schedule that empties the zones at 07:30 and fills them
again at 17:30 on weekdays, an activity schedule, `Schedule:Day:Interval` and
`Schedule:Day:List` (30-minute items) that change off the hour, and 6 timesteps per hour.

`Venting.idf` is `tests/fixtures/windows/Windows.idf` with daylight saving time and venting
availability schedules that change off the hour: `Win:South` (Constant 0.5) opens on
weekdays 07:30–17:45 and on weekends 10:15–14:00 with a value of 0.5, `GlassDoor:North`
(Constant 0.25) on summer nights until 06:00 and from 21:30, and `Win:East` (Temperature 0.8)
with the weekday schedule. Its annual reference also keeps the AirflowNetwork opening
factor of each opening at every timestep (`timestep.surfaces`).

`tools/make_oracles.py --annual` runs them for a whole year to get reference values. For the
files in this folder it also keeps every zone timestep (`timestep` in the JSON).
