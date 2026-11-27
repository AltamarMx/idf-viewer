# IDF Viewer

A read-only viewer for EnergyPlus input files (`.idf`), from version 8.0 to the current release.
It runs entirely in your browser: **your file is never uploaded to any server**.

**Open it:** https://altamarmx.github.io/idf-viewer/

> Work in progress. See [PLAN.md](PLAN.md) (in Spanish) for the roadmap.

## What it does

- Opens `.idf` files from EnergyPlus 8.0 to 26.2, using the field names of each version.
- Opens a file from your disk, from pasted text or from a web address. A link such as
  `https://altamarmx.github.io/idf-viewer/?url=https://github.com/user/repository/blob/main/model.idf`
  opens that file directly; the server must allow other sites to read it (CORS), as GitHub and
  Gist do. Your browser downloads it straight from that server.
- Explorer of classes and objects, with cross-references between objects, and the file as
  written, with syntax colors, in sync with the inspector.
- Problems panel: broken references, duplicate names, field values checked against the IDD of
  the file's version, materials, constructions, schedules and curves that nothing uses, and
  AirflowNetwork input that EnergyPlus rejects or changes (openings on the wrong surface,
  zones with fewer than two network surfaces, inverted temperature limits...).
- Site location on a world map drawn in the browser, design days, run periods and holidays,
  and the outputs the file requests.
- 3D view of the geometry, colored by boundary condition, with layers by zone and floor,
  transparency, a horizontal cut, floors pulled apart and daylighting reference points.
- Constructions: a cross-section of the layers, from outside to inside and to scale, with the
  properties of each material as written in the file, and where each construction is used.
- Schedules, internal loads and occupancy over the year, per zone, at every timestep.
- Windows, natural ventilation, AirflowNetwork and infiltration settings, wind pressure
  coefficients, the site wind profile and a diagram of the flow network between zones
  (AirflowNetwork connections and zone mixing).

It does not edit files, run simulations or read simulation results.

## Add an example to the gallery

Copy an `.idf` file into [`examples/`](examples/) and push. Optionally, give it a title in `examples/examples.json`.

## Development

Requirements: Node.js 22+ and [uv](https://docs.astral.sh/uv/).

```sh
npm install
npm run dev        # local server
npm test           # unit tests
uv run pytest      # Python tool tests
```

Schemas in `public/schemas/` are generated from the EnergyPlus IDD files:

```sh
uv run tools/fetch_idds.py   # collects the IDD of each version into idd/
uv run tools/idd2json.py     # writes public/schemas/
```

## License

MIT for the viewer code. The IDD-derived schemas and the example files come from EnergyPlus
and keep their own license (see `examples/LICENSE-EnergyPlus.txt`).

"IDF Viewer" is not affiliated with or endorsed by the U.S. Department of Energy or the EnergyPlus project.
