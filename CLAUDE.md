# IDF Viewer: indicaciones para Claude

Visor de solo lectura de archivos IDF de EnergyPlus (8.0 a 26.2), publicado en
https://altamarmx.github.io/idf-viewer/. El plan, las decisiones y el avance están en
`PLAN.md`: §6 tiene las fases con sus tareas y notas, y §9 dice dónde vamos y qué sigue.
Léelo antes de empezar cualquier trabajo.

## Cómo trabajar con el usuario

- Responde **en español** y con lenguaje claro, sin jerga de software. Si un término técnico
  hace falta, explícalo en una línea. El usuario es especialista en simulación energética
  con EnergyPlus, no programador.
- La interfaz, el código, los comentarios, los mensajes de commit y el README van **en inglés**.
  `PLAN.md` y este archivo van en español.
- Se avanza **fase por fase** según `PLAN.md`. Antes de empezar una fase, explica qué incluye
  y espera el visto bueno.
- Cada fase termina así: tareas marcadas en `PLAN.md`, una sección "Notas de la fase" con las
  reglas de EnergyPlus confirmadas y las limitaciones, commit, push a `main` y revisión de que
  GitHub Actions pase y el sitio quede publicado. Fuera de eso, haz commit o push solo cuando
  el usuario lo pida.

## Reglas del producto

- Solo lectura: no edita, no simula, no exporta y no lee resultados de simulación. Un IDF a la vez.
- El IDF se lee en el navegador y **nunca se envía a ningún servidor**. No hay servidor propio
  ni analítica.
- EnergyPlus se usa solo en desarrollo, para generar valores de referencia (`tests/oracles/`).
- HVAC queda para después (PLAN.md §5).

## Estructura

- `src/core/`: lectura, esquemas, referencias, geometría, horarios y cargas. Sin React; corre
  en un Web Worker. Los campos se leen **por nombre** con el esquema de la versión del archivo
  (`FieldReader`), nunca por posición.
- `src/worker/`: el worker y su cliente (Comlink). `src/core/session.ts` es la API que usa la interfaz.
- `src/features/`: pestañas y paneles en React. ECharts, three.js y las pestañas pesadas se
  cargan solo cuando se abren.
- `public/schemas/`: esquemas JSON por versión, generados con `tools/fetch_idds.py` y
  `tools/idd2json.py`. Están en el repositorio; `idd/` no.
- `tools/make_oracles.py`: corre EnergyPlus 26.2 (`/Applications/EnergyPlus-*` o `--energyplus`)
  sobre `examples/` y `tests/fixtures/` y guarda las referencias. `--annual` corre un año completo
  para horarios y cargas.
- `examples/`: la galería de la página de inicio.

## Comandos

```sh
npm ci && uv sync                 # instalar
npm run dev                       # visor local
npm run lint                      # Biome (no revisa .md)
npm run typecheck
npm test                          # Vitest: src/**/*.test.ts y tests/**/*.test.ts
uv run pytest                     # pruebas de tools/
PW_CHANNEL=chrome npm run e2e     # Playwright con el Chrome instalado
uv run tools/make_oracles.py [--annual] [archivos...]
```

Antes de hacer commit corre lo mismo que GitHub Actions: lint, typecheck, `npm test`,
`uv run pytest`, build y e2e.

## Cómo se verifica

Todo cálculo que EnergyPlus también hace (vértices, áreas, volúmenes, relación ventana-muro,
calendario, horarios hora por hora, ocupantes y potencias por zona) se compara contra las
referencias de `tests/oracles/`. Si cambias una regla, agrega un caso en `tests/fixtures/` que
la ejercite, regenera su referencia y compara. Las reglas ya confirmadas están en las notas de
cada fase en `PLAN.md`.

## Detalles que ya costaron tiempo

- No corras Vitest con `--root` apuntando fuera del repositorio: se queda colgado.
- Las dependencias de `package.json` llevan versión exacta; mantenlo así.
- En el buscador, el resultado activo cambia con `onMouseMove`, no con `onMouseEnter`
  (con `onMouseEnter` el ratón quieto cambiaba la selección y fallaba la prueba e2e).
- En las pruebas e2e, `openExample` busca el título exacto de la galería: "One zone, uncontrolled" y
  "One zone, uncontrolled (epJSON)" empiezan igual.
- Una gráfica grande de ECharts (p. ej. el mapa de calor con una fila por timestep) se dibuja en
  varios cuadros; si se destruye a la mitad, zrender truena con `layerStack` en el siguiente
  cuadro. `Chart.tsx` limpia y redibuja vacía la gráfica antes de `dispose`. Solo se veía en
  GitHub Actions; se reproduce localmente con `Emulation.setCPUThrottlingRate` en Playwright.
