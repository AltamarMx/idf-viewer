# IDF Viewer

A read-only viewer for EnergyPlus input files (`.idf`), from version 8.0 to the current release.
It runs entirely in your browser: **your file is never uploaded to any server**.

**Open it:** https://altamarmx.github.io/idf-viewer/

> Work in progress. See [PLAN.md](PLAN.md) (in Spanish) for the roadmap.

## What it does

- Opens `.idf` files from EnergyPlus 8.0 to 26.2, using the field names of each version.
- Explorer of classes and objects, with cross-references between objects.
- 3D view of the geometry, colored by boundary condition.
- Schedules, internal loads and occupancy over the year, per zone.
- Windows, natural ventilation, AirflowNetwork and infiltration settings.

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
