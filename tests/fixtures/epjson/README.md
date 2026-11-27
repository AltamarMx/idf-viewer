# epJSON fixtures

Copies of IDF fixtures and examples converted to epJSON with EnergyPlus 26.2:

```sh
/Applications/EnergyPlus-26-2-0/ConvertInputFormat -o tests/fixtures/epjson tests/fixtures/windows/Windows.idf
```

| File | Converted from |
|---|---|
| `Windows.epJSON` | `tests/fixtures/windows/Windows.idf` |
| `Schedules.epJSON` | `tests/fixtures/schedules/Schedules.idf` |
| `Venting.epJSON` | `tests/fixtures/schedules/Venting.idf` |
| `Defects.epJSON` | `tests/fixtures/geometry/Defects.idf` |
| `AirflowNetwork_MultiZone_SmallOffice.epJSON` | `examples/AirflowNetwork_MultiZone_SmallOffice.idf` |

`examples/1ZoneUncontrolled.epJSON` (in the gallery) was converted the same way.

`tests/epjson.test.ts` opens each one next to its IDF and expects the same objects and the
same results. EnergyPlus sorts classes, objects and fields by name, and the converter writes
`Autosize` for some `AUTOCALCULATE` values; the test allows for both.
