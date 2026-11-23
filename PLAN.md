# IDF Viewer: plan

> **Estado:** fases 0, 1 y 2a terminadas (2026-11-20). Siguiente: fase 2b (ver §9). Repositorio: https://github.com/AltamarMx/idf-viewer

---

## 0. Decisiones

| Tema | Decisión |
|---|---|
| Qué es | Visor de **solo lectura** de archivos de entrada de EnergyPlus (`.idf` y `.epJSON`). No edita, no simula, no exporta y no lee resultados de simulación. |
| Nombre | **IDF Viewer**. La licencia de EnergyPlus prohíbe usar "EnergyPlus" o "E+" en el nombre de un producto derivado. |
| Dirección | **https://altamarmx.github.io/idf-viewer/** (repositorio público `altamarmx/idf-viewer`) |
| Licencia | **MIT** para el código del visor. Los IDD y los ejemplos de EnergyPlus conservan su propia licencia (tipo BSD). |
| Interfaz | En **inglés**. Este documento sigue en español. |
| Versiones de EnergyPlus | **De 8.0 a 26.2** (la actual) y las que salgan después (§2) |
| Archivos | Un IDF a la vez, sin archivos complementarios (CSV, EPW) |
| Tecnología | TypeScript + Vite, publicado en GitHub Pages con GitHub Actions. Python con uv solo para herramientas de desarrollo. |
| Navegadores | Chrome, Edge, Firefox y Safari de los últimos ~3 años, con WebGL2. Internet Explorer no. |
| Privacidad | El IDF se lee en el navegador y **nunca se envía a ningún servidor** |

## 1. Restricciones y lo que implican

| Restricción | Consecuencia de diseño |
|---|---|
| GitHub Pages solo sirve archivos estáticos | La lectura del archivo, los cálculos y el 3D ocurren en el navegador. La dirección no cambia al navegar dentro del visor, porque no hay enlaces a vistas. |
| Sin servidor | El esquema de cada versión de EnergyPlus se genera de antemano como JSON y se descarga solo cuando hace falta. |
| Varias versiones de EnergyPlus | Ningún campo se lee por posición. Se resuelve por nombre con el esquema de la versión del archivo (§2). |
| Archivos grandes (miles de superficies, decenas de MB) | La lectura corre en un *Web Worker*, un proceso en segundo plano del navegador, para que la interfaz no se congele. El 3D agrupa la geometría y las tablas largas solo dibujan las filas visibles. |
| Privacidad | El IDF se lee del disco con la File API del navegador y nunca pasa por la red. No hay analítica. |

## 2. Versiones de EnergyPlus (8.0 → 26.2)

### Cómo funciona

1. **El lector de IDF es genérico.** La sintaxis no cambia entre versiones: objetos separados por `;`, campos por `,` y comentarios con `!`.
2. **Hay un esquema por versión.** El visor lee el objeto `Version` del archivo y descarga `schemas/<versión>.json`, que se genera a partir del `Energy+.idd` de esa versión. El esquema contiene nombres de campo, unidades, valores por defecto, rangos, opciones, grupos y referencias entre objetos.
3. **Respaldo.**
   - Las versiones de parche (p. ej. 9.0.1) usan el esquema de su versión menor (9.0).
   - Si no hay esquema para la versión del archivo, se usa el de la versión más cercana y se muestra un aviso.
   - Si el archivo no declara versión, se abre en *modo sin esquema*: los campos aparecen como "Field 1…N" y el 3D funciona para las clases de geometría conocidas.
4. **Sin conversión entre versiones.** Los *transition programs* de EnergyPlus quedan fuera de alcance.

### De dónde salen los 27 IDD (verificado)

| Versiones | Origen |
|---|---|
| 8.0–8.8 | Repositorio NREL/EnergyPlus en GitHub, etiqueta `v8.9.0`, carpeta `idd/` (`V8-0-0-Energy+.idd` … `V8-8-0-Energy+.idd`) |
| 8.9 | Mismo repositorio, etiqueta `v9.0.1`, archivo `idd/V8-9-0-Energy+.idd` |
| 9.0–26.2 | Tu instalación: `/Applications/EnergyPlus-26-2-0/PreProcess/IDFVersionUpdater/` |

Un script de Python (`tools/fetch_idds.py`) los reúne y otro (`tools/idd2json.py`) los convierte. Cuando salga una versión nueva de EnergyPlus, basta con instalarla y volver a correr ambos scripts. Algunos IDD antiguos traen caracteres que no son UTF-8, y el script los maneja.

**Licencia.** La de EnergyPlus permite redistribuir los IDD y los ejemplos si se conserva su aviso de copyright. Por eso se copia su `LICENSE.txt` junto a ellos.

### Limitaciones

- **El explorador genérico funciona igual en todas las versiones**, porque todo sale del esquema.
- **Las vistas especializadas (3D, horarios, cargas, ventilación) dependen de clases y campos concretos**, y algunos cambiaron entre versiones. Comparando los IDD 8.0, 9.0 y 26.2 se confirma que:
  - `WindowProperty:ShadingControl` (8.x) pasó a ser `WindowShadingControl` (9.0+);
  - la opción `Interpolate to Timestep` de los horarios pasó de `Yes/No` (8.x) a `Average/Linear/No` (9.0+);
  - el nodo externo del AFN referencia `Wind Pressure Coefficient Values` en 8.x y una curva (`Wind Pressure Coefficient Curve Name`) en 9.0+;
  - `Space` y `SpaceList` solo existen desde la 9.6.

  Cada uno de estos casos se programa y se prueba con archivos de esa versión.
- **Archivos anteriores a 8.0** se abren con el esquema 8.0 o sin esquema, con un aviso. Las vistas especializadas no están garantizadas.

---

## 3. Arquitectura

### 3.1 Recorrido de un archivo

```
 .idf / .epJSON  (disco del usuario, galería o URL)
        │  File API: lectura local, sin red
        ▼
 ┌─ Web Worker (segundo plano) ─────────────────────────────────┐
 │ 1. decodificar texto (UTF-8 o Windows-1252)                   │
 │ 2. leer objetos y campos, guardando el número de línea        │
 │ 3. leer Version → descargar schemas/<versión>.json            │
 │ 4. indexar clases, nombres y referencias entre objetos        │
 │ 5. cálculos a pedido: geometría, horarios del año, cargas,    │
 │    AFN y validaciones                                         │
 └───────────────────────────────────────────────────────────────┘
        │  resultados
        ▼
 Interfaz: explorador · 3D · gráficas · vista de texto · inspector
```

### 3.2 Estructura de carpetas

```
idf-viewer/
├── PLAN.md                  este documento
├── README.md                descripción pública (en inglés)
├── LICENSE                  MIT
├── index.html               página única del visor
├── package.json             dependencias de JavaScript
├── vite.config.ts           compilación; base = /idf-viewer/
├── pyproject.toml           herramientas de Python (uv)
├── .github/workflows/       pruebas y publicación en Pages
├── examples/                ← GALERÍA: pon aquí .idf o .epJSON
│   ├── examples.json        (opcional) título y descripción de cada ejemplo
│   └── LICENSE-EnergyPlus.txt
├── public/schemas/          esquemas generados: 8.0.json … 26.2.json + index.json
├── tools/                   Python: fetch_idds.py, idd2json.py, make_oracles.py
├── idd/                     IDD descargados (no se suben a git; se regeneran con tools/)
├── src/
│   ├── core/                lógica sin interfaz; corre en el worker y tiene pruebas
│   │   ├── parser/          IDF y epJSON → modelo
│   │   ├── schema/          carga de esquemas y resolución de versión
│   │   ├── model/           tipos e índice de referencias
│   │   ├── geometry/        vértices, reglas, áreas, normales, geometría simplificada
│   │   ├── schedules/       evaluador de horarios del año
│   │   ├── loads/           cargas internas y ocupación
│   │   ├── airflow/         AFN, ventilación e infiltración
│   │   └── validation/      revisiones y lista de problemas
│   ├── worker/              entrada del Web Worker
│   ├── features/            una carpeta por vista: explorer, viewer3d, summary,
│   │                        schedules, constructions, ventilation, problems, gallery
│   └── ui/                  componentes comunes (paneles, tablas, leyendas)
└── tests/
    ├── fixtures/            IDF pequeños y de varias versiones
    └── oracles/             valores de referencia calculados con EnergyPlus (§3.6)
```

**Cómo agregar un ejemplo a la galería:** copias el `.idf` a `examples/` y haces push. La compilación genera la lista y la publica. `examples.json` es opcional y sirve para ponerle un título bonito al ejemplo.

### 3.3 Modelo de datos y esquema

Cada objeto se guarda con su clase, sus valores tal como vienen en el archivo y su número de línea. Las clases y los nombres se comparan sin distinguir mayúsculas, igual que hace EnergyPlus.

```ts
interface IdfObject {
  id: number;          // posición en el archivo
  className: string;   // "BuildingSurface:Detailed"
  fields: string[];    // valores tal cual, sin convertir
  line: number;        // línea donde empieza el objeto
}
```

El esquema de cada versión es un JSON compacto generado a partir del IDD:

```jsonc
{
  "version": "26.2",
  "classes": {
    "zone": {
      "name": "Zone", "group": "Thermal Zones and Surfaces",
      "unique": false, "required": false,
      "extensible": null,                         // p. ej. { "size": 3, "start": 10 } para vértices
      "fields": [
        { "name": "Name", "type": "alpha", "required": true, "reference": ["ZoneNames"] },
        { "name": "Direction of Relative North", "type": "real", "units": "deg", "default": 0 }
      ]
    }
  }
}
```

Las notas largas del IDD (`\memo`, `\note`) van en un archivo aparte, `<versión>.docs.json`. Ese archivo solo se descarga cuando se muestra la ayuda de un campo.

Para leer `.epJSON` (A5), los nombres de campo se convierten con la misma regla que usa EnergyPlus para generar su esquema epJSON.

### 3.4 Librerías

| Para qué | Librería | Por qué |
|---|---|---|
| Interfaz | React + TypeScript | Es la más usada: tiene muchos componentes listos y es fácil encontrar ayuda |
| Paneles redimensionables | react-resizable-panels | Distribución en columnas que se puede ajustar |
| Tablas grandes | TanStack Table + TanStack Virtual | Miles de filas sin que la tabla se trabe |
| 3D | three.js | Estándar de WebGL |
| Gráficas | Apache ECharts | Incluye áreas apiladas, mapas de calor y gráficas polares, y sincroniza el zoom entre subpaneles (F8). Solo se descarga al abrir una gráfica. |
| Vista de texto | CodeMirror 6 | Maneja archivos de varios MB |
| Mapa | Leaflet + OpenStreetMap | Ligero |
| Red de flujo (L11) | Cytoscape.js | Acomoda los nodos automáticamente |
| Comunicación con el worker | Comlink | Simplifica el código |
| Instalable (K5) | vite-plugin-pwa | Se agrega en la última fase |
| Calidad | Vitest, Playwright, Biome | Pruebas unitarias, pruebas en navegador real y formato del código |
| Python | uv + pytest, solo biblioteca estándar | Sin dependencias extra |

Las versiones exactas se fijan al crear el proyecto.

### 3.5 Distribución de la interfaz

```
┌───────────────────────────────────────────────────────────────────────┐
│ IDF Viewer │ 5ZoneAirCooled.idf · v26.2 · 1,234 objects │ ⌘K Search │ ◐ │
├──────────────┬─────────────────────────────────────────┬──────────────┤
│ Classes      │ Summary │ 3D │ Table │ Text │ Schedules │ Inspector    │
│ Zones        │ Ventilation │ Problems                   │  fields      │
│ Schedules    │                                         │  units       │
│ Constructions│              vista activa               │  uses →      │
│ …            │                                         │  ← used by   │
└──────────────┴─────────────────────────────────────────┴──────────────┘
```

Al abrir el visor sin archivo se ven la galería y la zona para arrastrar o elegir un archivo.

### 3.6 Pruebas

- **Pruebas unitarias (Vitest)** de cada parte de `src/core/`: lector, esquemas, referencias, geometría, horarios, cargas y AFN.
- **EnergyPlus como referencia, solo en desarrollo.** El script `tools/make_oracles.py` corre tu EnergyPlus 26.2 sobre los ejemplos y guarda en `tests/oracles/` valores pequeños de referencia:
  - áreas, volúmenes y vértices de las superficies;
  - el valor hora por hora de cada horario;
  - el número de ocupantes y la potencia de iluminación y equipos de cada zona.

  Las pruebas comparan los cálculos del visor contra esos valores. El visor nunca lee resultados de simulación; EnergyPlus solo sirve para confirmar que el visor calcula igual que él.
- **Archivos de varias versiones:** se toman de la carpeta `testfiles/` del repositorio de EnergyPlus en etiquetas 8.x, 9.x y 22+. Con ellos se prueba la lectura, los nombres de campo y la geometría.
- **Prueba en navegador (Playwright):** abre el sitio compilado, carga un ejemplo y verifica que se ven el 3D y el inspector.

### 3.7 Publicación

- Con **cada push a `main`**, GitHub Actions corre las pruebas (TypeScript y Python), compila y publica en Pages.
- Con **cada pull request** se corren las pruebas y la compilación, sin publicar.
- Los esquemas y los ejemplos ya están en el repositorio, así que la compilación no necesita descargar nada de EnergyPlus.

---

## 4. Features aprobados

La fase de cada feature está en §6.

### A. Carga y lectura

- **A1 · Cargar archivo local:** arrastrar y soltar, selector de archivos o pegar texto. El navegador lee el archivo del disco y lo procesa ahí mismo, sin enviarlo a ningún servidor.
- **A2 · Lector IDF tolerante:**
  - comentarios `!` y `!-`, objetos en varias líneas, mayúsculas y minúsculas indistintas, campos vacíos y objetos extensibles (vértices);
  - guarda la línea de cada objeto y de cada campo;
  - detecta la codificación (UTF-8 o Windows-1252), porque los IDF con acentos guardados desde IDF Editor suelen venir en Windows-1252.
- **A3 · Detección de versión y esquema:** lee `Version`, descarga el esquema de esa versión y aplica los respaldos de §2.
- **A4 · Procesamiento en segundo plano:** la lectura y el índice se hacen en el Web Worker, con barra de progreso.
- **A5 · Lectura de epJSON:** abre `.epJSON` con el mismo modelo interno.
- **A6 · Abrir desde una URL:** `?url=https://…`, por ejemplo un IDF publicado en GitHub. Solo funciona si ese servidor permite CORS.
- **A7 · Galería de ejemplos:** usa la carpeta `examples/` (§3.2). Los ejemplos iniciales salen de los `ExampleFiles` de EnergyPlus 26.2, más el IDF de prueba que vas a aportar:

  | Archivo | Qué muestra |
  |---|---|
  | `1ZoneUncontrolled.idf` | Caso mínimo |
  | `4ZoneWithShading_Simple_1.idf` | Geometría simplificada |
  | `5ZoneAirCooledWithSpaces.idf` | `Space` (9.6+) |
  | `AirflowNetwork_MultiZone_House.idf` | Casa con AFN |
  | `AirflowNetwork_MultiZone_SmallOffice.idf` | Oficina con AFN |
  | `ASHRAE901_ApartmentHighRise_STD2019_Denver.idf` | Ventilación natural sin AFN, edificio alto |
  | `RefBldgMediumOfficeNew2004_Chicago.idf` | Edificio de referencia mediano |
  | `HospitalLowEnergy.idf` (4.4 MB) | Prueba de rendimiento con un archivo grande |

### B. Explorador e inspector

- **B1 · Árbol de clases:** las clases del archivo, agrupadas por grupo del IDD y con el número de objetos de cada una.
- **B2 · Inspector de objeto:** para cada campo muestra nombre, valor, unidades y valor por defecto (indicando si se está usando), y la descripción del IDD como ayuda.
- **B3 · Tabla por clase:** todos los objetos de una clase como hoja de cálculo (p. ej. todos los `Material`), con columnas que se pueden ordenar y filtrar.
- **B4 · Búsqueda global:** por nombre, clase o valor de campo, con atajo Ctrl/⌘+K.
- **B5 · Referencias cruzadas:** para cada objeto, lo que usa y lo que lo usa, y se puede navegar entre ellos (p. ej. superficie → construcción → materiales). Se basa en `\reference` y `\object-list` del IDD, así que funciona con cualquier clase.
- **B6 · Vista de texto:** el IDF original con colores de sintaxis, sincronizado con el inspector: un clic en un objeto lleva a su línea y viceversa.

### C. Geometría 3D

- **C1 · Superficies detalladas:** `BuildingSurface:Detailed`, `FenestrationSurface:Detailed`, `Wall/RoofCeiling/Floor:Detailed` y `Shading:Site/Building/Zone:Detailed`.
- **C2 · Reglas de geometría:** respeta `GlobalGeometryRules` (vértice inicial, sentido de los vértices, coordenadas relativas o absolutas), el origen y la rotación de cada `Zone` y el `North Axis` de `Building`.
- **C3 · Navegación 3D:** orbitar, acercar y desplazar, con vistas predefinidas (planta, isométrica, fachadas N/S/E/O), indicador de norte y ejes.
- **C4 · Colorear por atributo:** por tipo de superficie, condición de frontera (C12), zona o construcción, con leyenda.
- **C5 · Selección vinculada:** un clic en una superficie la abre en el inspector, y seleccionar una zona o construcción en el explorador la resalta en 3D.
- **C6 · Geometría simplificada:** `Wall:Exterior`, `Window`, `Door`, `Roof`, `Floor:GroundContact`, `Shading:Overhang`, `Shading:Fin`, etc. Los vértices se calculan a partir del azimut, la inclinación y las dimensiones.
- **C7 · Capas y cortes:** mostrar u ocultar por zona, por nivel, sombreados o ventanas; transparencia; corte horizontal para ver el interior; vista explotada por pisos.
- **C8 · Diagnóstico visual de geometría:** normales para detectar superficies invertidas, superficies no planas o degeneradas, ventanas fuera de su muro, pares interzona inconsistentes y zonas no cerradas.
- **C9 · Elementos adicionales:** `Daylighting:ReferencePoint` y `Space` (9.6+).
- **C12 · Visor de condiciones de frontera** *(paleta de OpenStudio/FloorspaceJS)*:
  - colorea cada superficie según su `Outside Boundary Condition`: `Outdoors`, `Ground`, `Surface`, `Zone`, `Adiabatic`, `Foundation`, `OtherSideCoefficients`, `OtherSideConditionsModel`, `GroundSlabPreprocessor*`, `GroundBasementPreprocessor*` y `GroundFCfactorMethod`;
  - usa los mismos colores que OpenStudio: azules para `Outdoors` (uno distinto según la exposición al sol y al viento), verde para `Surface`, rojo para `Adiabatic` y tonos tierra para `Ground`; los valores exactos se toman del código fuente de OpenStudio;
  - la leyenda muestra el número de superficies y el área de cada categoría, y cada categoría se puede ocultar o aislar;
  - al seleccionar una superficie interzona se resalta su pareja, y se marca si la pareja no existe o no apunta de regreso.

### D. Resumen del edificio y de las zonas

- **D1 · Tablero resumen:** versión, ubicación, periodo de simulación, timestep, número de zonas y superficies, área total y acondicionada, y objetos por grupo.
- **D2 · Envolvente por orientación:** área de muros y de ventanas por orientación y relación ventana-muro (WWR), calculadas a partir de la geometría.
- **D3 · Tabla de zonas:** área de piso, volumen y altura (calculados cuando vienen como `autocalculate`), multiplicador, número de superficies y si es acondicionada.
- **D4 · Densidades de diseño por zona:** personas, iluminación y equipos normalizados (W/m², m²/persona). Resuelve `ZoneList` y `SpaceList` y los distintos métodos de cálculo. Su variación en el tiempo está en F9.
- **D5 · Ubicación y clima de diseño:** `Site:Location` en un mapa, tabla de `SizingPeriod:DesignDay`, `RunPeriod` y días festivos.
- **D6 · Salidas solicitadas:** lista de `Output:Variable`, `Output:Meter` y reportes tabulares, con su frecuencia.

### E. Construcciones y materiales

- **E1 · Corte de capas:** diagrama de cada construcción de exterior a interior, con espesores a escala. Cada capa muestra sus propiedades **tal como están en el IDF**, sin calcular valores derivados:
  - `Material`: rugosidad, espesor, conductividad, densidad, calor específico y absortancias;
  - `Material:NoMass` y `Material:AirGap`: resistencia térmica;
  - vidrios y gases: datos ópticos, espesor y tipo de gas;
  - `WindowMaterial:SimpleGlazingSystem`: U, SHGC y VT declarados.
- **E3 · Uso de cada construcción:** qué superficies la usan, su área total y su resaltado en 3D.

### F. Horarios y cargas

- **F1 · Evaluador de horarios:** calcula los valores hora por hora de todo el año para `Schedule:Compact`, `Schedule:Year`, `Week:*`, `Day:*` y `Schedule:Constant`. Toma en cuenta el día de la semana del 1 de enero según `RunPeriod`, los días festivos, el horario de verano y los días de diseño. Los `Schedule:File` aparecen en la lista con su archivo y columna, pero sin gráfica.
- **F2 · Mapa de calor anual:** día del año contra hora del día.
- **F3 · Perfiles:** semana típica y días tipo (laborable, sábado, domingo, festivo, días de diseño).
- **F7 · Rastreo de uso de cada horario:**
  - para cada horario, qué objetos lo usan y en qué campo, es decir, con qué función;
  - sigue las cadenas indirectas hasta la zona y expande `ZoneList` y `SpaceList`;
  - funciona en ambos sentidos: desde una zona se ven todos los horarios que la afectan;
  - desde cada uso se puede saltar al objeto.
- **F8 · Horarios de una zona en subpaneles:**
  - al elegir una zona aparecen sus horarios, agrupados por origen (ocupación, actividad, iluminación, equipos, infiltración, ventilación, apertura de ventanas…);
  - los horarios se agregan uno por uno, cada uno en su propio subpanel apilado, con el eje de tiempo sincronizado;
  - los subpaneles se pueden reordenar y quitar, y cada uno se ve como línea, mapa de calor o día tipo.
- **F9 · Cargas internas por zona en el tiempo:** multiplica el nivel de diseño de cada carga por su horario y suma las que tienen la misma unidad.
  - **Potencia (W y W/m²):** áreas apiladas por tipo de carga, con el total de la zona arriba. Los tipos son personas (personas × nivel de actividad), iluminación y equipos eléctricos, de gas, de agua caliente, de vapor y otros.
  - **Ocupación (personas):** va en su propio panel, porque es otra unidad.
  - Resuelve los métodos de cálculo (absoluto, por área, por persona), `ZoneList`, `Space` y `SpaceList`.
  - Opción para descontar la fracción perdida de los equipos (`Fraction Lost`).
  - Solo incluye cargas internas: la infiltración, la ganancia solar y la envolvente dependen de la simulación.
- **F10 · Verificación de la ocupación:** número de personas en el tiempo, por zona y para todo el edificio o la casa (suma de las zonas con su multiplicador), en gráfica de línea y en mapa de calor. Muestra:
  - el pico de personas por zona y del edificio, con la fecha y la hora en que ocurre;
  - qué objetos `People` aportan a cada zona;
  - alertas de zonas sin ocupación, de varios `People` en una misma zona, de `People` asignados a una `ZoneList` que se replican en cada zona, de horarios con valores fuera de 0–1 y de niveles de actividad atípicos.

### H. Validación

> Es una revisión previa rápida y no reemplaza la validación de EnergyPlus.

- **H1 · Referencias rotas y nombres duplicados.**
- **H2 · Panel de problemas:** errores y advertencias con severidad y filtros. Un clic lleva al objeto o a la línea.
- **H3 · Validación contra el IDD:** campos obligatorios vacíos, valores fuera de rango, opciones inválidas, tipos numéricos, objetos únicos repetidos y objetos obligatorios faltantes.
- **H4 · Objetos sin uso:** materiales, construcciones, horarios o curvas que nadie referencia.
- **H5 · Problemas de geometría:** los hallazgos de C8 se agregan al panel de problemas.

### K. Experiencia de uso

- **K1 · Tema claro y oscuro.**
- **K3 · Interfaz en inglés.**
- **K5 · Instalable y sin conexión** *(al final)*:
  - se instala desde el navegador: en Chrome o Edge con el ícono de instalar, en Safari de macOS con Archivo → Agregar al Dock, y en iPhone o iPad con Compartir → Agregar a inicio;
  - queda con su propia ventana e ícono, funciona sin internet y se actualiza sola;
  - en Chrome y Edge de escritorio puede abrir `.idf` con doble clic.
- **K6 · Archivos recientes** *(prioridad más baja de todas)*: se guardan en el propio navegador, nunca en un servidor.

### L. Ventanas, ventilación natural e infiltración

> El visor muestra la **configuración**: qué ventanas pueden abrir, cuánto, con qué reglas y con qué coeficientes. Todo eso está en el IDF y **no requiere simulación**. Lo que sí requiere simulación, y por eso no se muestra, es cuánto se abre cada ventana hora por hora y cuánto aire pasa. La excepción es el modo `Constant`, donde la apertura es el factor máximo por el horario de disponibilidad y sí se puede graficar.

- **L1 · Inventario de ventanas y puertas:** detalladas y simplificadas, con muro anfitrión, zona, orientación, área, alturas de antepecho y dintel, construcción, marco, control de sombreado y multiplicador. Incluye U y SHGC cuando se declaran con `SimpleGlazingSystem` e indica si la ventana es operable en el AFN.
- **L2 · Ventanas en 3D por operabilidad:** fijas, operables (`DetailedOpening`, `SimpleOpening`, `HorizontalOpening`) o solo con fugas (`Crack`, `EffectiveLeakageArea`). También se pueden colorear por factor de apertura máximo o por Cd.
- **L3 · Resumen del AFN:** modo de control, cómo se obtienen los Cp (`Input` o `SurfaceAverageCalculation`), tipo de edificio, terreno, condiciones de referencia de las grietas, y qué zonas están en el AFN y cuáles no.
- **L4 · Ficha de apertura por ventana:** recorre la cadena superficie AFN → componente → nodo externo.
  - **Superficie:** factor de apertura, modo de control, setpoint, factor mínimo, límites de ΔT y Δh, horario de disponibilidad, control por ocupantes y rectángulo equivalente.
  - **Componente:** Cd y flujo con la ventana cerrada. En `DetailedOpening`, además, cada juego de factor de apertura con su Cd y sus factores de ancho, alto y altura de inicio.
  - **Nodo externo:** altura y Cp.
  - Con `ZoneLevel` muestra los valores **efectivos** heredados de la zona y de dónde viene cada uno.
- **L5 · Diagrama de apertura:** dibuja el área abierta en cada factor de apertura de un `DetailedOpening`, con una gráfica de Cd y del área efectiva contra el factor de apertura.
- **L6 · Reglas de apertura:** gráfica de cómo se modula la apertura entre los límites de ΔT o Δh, y explicación en texto de cada modo (`Temperature`, `Enthalpy`, `Constant`, `NoVent`, `ASHRAE55Adaptive`, `CEN15251Adaptive`).
- **L7 · Infiltración por zona:** las tres variantes de `ZoneInfiltration`, con valores normalizados (ACH, m³/s·m²), horario y coeficientes A/B/C/D. Identifica si los coeficientes corresponden al modelo constante (1, 0, 0, 0), DOE-2 (0, 0, 0.224, 0) o BLAST (0.606, 0.03636, 0.1177, 0). En las zonas del AFN muestra sus grietas y áreas de fuga.
- **L8 · Ventilación natural sin AFN:**
  - `ZoneVentilation:DesignFlowRate` y `ZoneVentilation:WindandStackOpenArea`, incluyendo Cd y el área de apertura comparada con el área de ventanas;
  - además, `ZoneMixing`, `ZoneCrossMixing`, `ZoneAirBalance:OutdoorAir` y `ZoneThermalChimney`.
- **L9 · Coeficientes de presión de viento (Cp):** gráfica polar de Cp contra dirección del viento para cada nodo externo. También muestra `Site:HeightVariation`, `Site:WeatherStation` y el terreno.
- **L11 · Red de flujo entre zonas:** diagrama de las conexiones posibles entre zonas (aperturas interiores y exteriores, `ZoneMixing`), con el tipo de componente y el Cd de cada una.
- **L12 · Validaciones de ventilación** (al panel de problemas):
  - zonas del AFN que además tienen `ZoneInfiltration`, `ZoneVentilation` o `ZoneMixing`;
  - `DetailedOpening` con factores de apertura que no van de 0 a 1 en orden;
  - Cd fuera de rango;
  - referencias AFN rotas;
  - ventanas sin nodo externo cuando los Cp son `Input`;
  - ventanas no rectangulares;
  - aperturas controladas por EMS.

## 5. Descartados y a futuro

**A futuro:**
- K6, archivos recientes, ya aprobado y con la prioridad más baja.
- B9, grafo de dependencias.
- C10, trayectoria solar y sombras.
- L10, Cp calculados con `SurfaceAverageCalculation`.
- D7, termostatos.
- G1–G4, todo lo de HVAC: `HVACTemplate`, equipos por zona, diagrama de lazos y nodos.

Los objetos HVAC se pueden ver desde ahora en el explorador genérico.

**Descartados:**

| Feature | Motivo |
|---|---|
| A8 · Archivos complementarios, F6 · `Schedule:File` | Solo se abre el IDF |
| A9 · Varios archivos abiertos, I1–I3 · Comparación de archivos | Un IDF a la vez |
| B7 · Conversión SI ↔ IP | Siempre en SI |
| B8 · Historial de navegación | — |
| C11 · Exportar geometría o capturas, K2 · Exportar tablas, K7 · Exportar parte del IDF | Es solo un visor |
| C13 · Planta 2D | Lo de FloorspaceJS se refería a la paleta de colores (C12) |
| E2 · U y R calculados | Solo propiedades definidas en el IDF |
| E4 · Comparativo de materiales | La tabla por clase (B3) lo cubre |
| F4 · Superponer horarios | Lo cubren los subpaneles (F8) |
| F5 · Estadísticas de horarios | — |
| J1–J3 · Resultados de simulación | Solo se explora el IDF |
| K4 · Enlaces a una vista | — |
| K8 · Edición | Es solo un visor |

**Fuera de alcance:**
- correr EnergyPlus desde el visor;
- convertir entre versiones;
- expandir `HVACTemplate` (ExpandObjects);
- macros EP-Macro (`##include`, `.imf`), que solo se detectan y generan un aviso;
- Internet Explorer y navegadores sin WebGL.

---

## 6. Plan por fases

Cada fase termina con una publicación en https://altamarmx.github.io/idf-viewer/, así que puedes probar el avance desde el navegador.

### Fase 0 · Cimientos

- [x] 0.1 Inicializar git, `.gitignore`, `LICENSE` (MIT) y `README.md`. Crear el repositorio público `altamarmx/idf-viewer` y activar Pages con fuente "GitHub Actions".
- [x] 0.2 Proyecto Vite + React + TypeScript con Biome y Vitest; `base: '/idf-viewer/'`.
- [x] 0.3 Flujo de GitHub Actions: pruebas → compilación → publicación en Pages.
- [x] 0.4 Herramientas de Python con uv: `fetch_idds.py` (27 IDD, §2), `idd2json.py` (esquemas y documentación por versión) y sus pruebas con pytest. Generar `public/schemas/`.
- [x] 0.5 Lector IDF (A2) con pruebas: comentarios, extensibles, codificaciones y números de línea.
- [x] 0.6 Carga de esquemas y resolución de versión (A3): exacta, versión menor, más cercana o sin esquema.
- [x] 0.7 Web Worker con barra de progreso (A4).
- [x] 0.8 Estructura de la interfaz (§3.5): carga de archivos (A1), tema claro y oscuro (K1) y textos en inglés (K3).
- [x] 0.9 Carpeta `examples/` con los 8 ejemplos, la licencia de EnergyPlus y el plugin que genera la lista. **Aquí agregas tu IDF de prueba.**

**Notas de la fase 0:**
- Cada esquema pesa ~1.5 MB (~130 KB comprimido al descargarlo). Los objetos extensibles guardan solo el primer grupo de campos y una plantilla de nombre ("Vertex {n} X-coordinate").
- Algunos IDD antiguos traen errores que `idd2json.py` corrige: `\begin-extensible` repetido (8.0 `Output:Table:SummaryReports`), puesto en el campo equivocado (8.0 `ZoneTerminalUnitList`) o tarde (`Site:SpectrumData`), y campos sin nombre (8.0 `Schedule:Day:List`).
- Archivos de prueba de otras versiones: `1ZoneUncontrolled` de las etiquetas v8.2.0, v8.9.0 y v9.0.1 de EnergyPlus (no existe etiqueta v8.0.0 en GitHub).
- Se adelantó una prueba básica en navegador (`npm run e2e`) con Playwright; la tarea 1.9 la amplía.

**Listo cuando:**
- el sitio publicado abre cualquiera de los ejemplos y un IDF arrastrado, y muestra la versión detectada, las clases y el número de objetos;
- `HospitalLowEnergy.idf` (4.4 MB) carga sin congelar la interfaz;
- se abren IDF de las versiones 8.x, 9.x y 26.2 con sus nombres de campo correctos.

### Fase 1 · Primera versión publicada

- [x] 1.1 Índice de referencias, "usa / usado por" (B5), y referencias rotas y nombres duplicados (H1).
- [x] 1.2 Árbol de clases (B1), inspector (B2), tabla por clase (B3) y búsqueda (B4).
- [x] 1.3 Geometría en `core/`: reglas globales, origen y rotación de zonas, norte, normales, áreas y triangulación (C2).
- [x] 1.4 `make_oracles.py`: corre EnergyPlus 26.2 sobre los ejemplos y guarda áreas, volúmenes y vértices de referencia.
- [x] 1.5 Vista 3D: superficies detalladas (C1), navegación (C3), colores (C4), selección vinculada (C5) y condiciones de frontera con la paleta de OpenStudio (C12).
- [x] 1.5b Geometría simplificada (C6), adelantada desde la fase 2b porque `4ZoneWithShading_Simple_1` la usa.
- [x] 1.6 Tablero resumen (D1) y envolvente por orientación (D2).
- [x] 1.7 Panel de problemas (H2) con los hallazgos de H1.
- [x] 1.8 Galería en la pantalla de inicio (A7).
- [x] 1.9 Prueba en navegador con Playwright.

**Listo cuando:**
- los 8 ejemplos y tu IDF se ven en 3D con sus condiciones de frontera;
- las áreas y los volúmenes coinciden con EnergyPlus (tolerancia de 0.5 %);
- las referencias se pueden navegar en ambos sentidos.

**Notas de la fase 1:**
- Las referencias de EnergyPlus (`tests/oracles/`) cubren los 8 ejemplos y dos archivos de prueba en `tests/fixtures/geometry/`: norte del edificio girado, coordenadas relativas, zonas con origen y rotación, vértices en sentido horario desde la esquina inferior izquierda, y geometría simplificada con ventanas, puertas, aleros y aletas. Coinciden los vértices (±1.5 cm, mismo orden), las áreas, el azimut, la inclinación, el volumen y el área de piso de cada zona, y la tabla ventana-muro por orientación.
- Reglas de EnergyPlus confirmadas con esas referencias:
  - con coordenadas "World" se ignoran el norte del edificio y el origen de las zonas;
  - la geometría simplificada usa su propio sistema ("Rectangular Surface Coordinate System"), pero su azimut solo gira si el sistema principal es relativo;
  - `Shading:Site` nunca gira y `Shading:Building` gira con el edificio;
  - dos puntos son el mismo si están a menos de 1.27 cm (para saber si una zona está cerrada);
  - si el volumen no se puede calcular, EnergyPlus usa 10 m³;
  - el área de ventana de la tabla ventana-muro incluye el marco (`WindowProperty:FrameAndDivider`).
- Los colores de condición de frontera y de tipo de superficie se tomaron de `src/utilities/geometry/ThreeJS.cpp` de OpenStudio. "Zone" y "Space" no existen en OpenStudio y usan verdes claros.
- Única referencia rota real en los ejemplos: 4 `Refrigeration:Case` de `HospitalLowEnergy.idf` apuntan a una curva de deshielo que no existe.
- Para la tabla por clase basta TanStack Virtual (orden y filtro son propios); no se usa TanStack Table.

### Fase 2a · Horarios, cargas y ocupación

- [x] 2a.1 Evaluador de horarios (F1): todas las variantes, `Interpolate` en sus dos sintaxis (8.x y 9.0+), días festivos, horario de verano y días de diseño.
- [x] 2a.2 Referencias de EnergyPlus para horarios: valor hora por hora de cada horario, ocupantes y potencias por zona.
- [x] 2a.3 Mapa de calor (F2) y perfiles (F3).
- [x] 2a.4 Rastreo de uso (F7) y subpaneles sincronizados por zona (F8).
- [x] 2a.5 Tabla de zonas (D3) y densidades de diseño (D4).
- [x] 2a.6 Cargas internas en el tiempo (F9) y verificación de la ocupación (F10).

**Listo cuando:**
- los horarios evaluados coinciden hora por hora con EnergyPlus en todos los ejemplos;
- la ocupación y las potencias por zona coinciden con los valores de EnergyPlus.

**Notas de la fase 2a:**
- Referencias anuales (`make_oracles.py --annual`): EnergyPlus corre un año completo con un clima de la instalación (los valores comparados no dependen del clima). La copia usa un solo `RunPeriod` del 1 de enero al 31 de diciembre que conserva el día de la semana de cada fecha del archivo original. Se guardan el calendario (tipo de día y horario de verano de cada día), cada horario hora por hora, los días de diseño y, por zona, ocupantes y potencias.
- Archivo de prueba `tests/fixtures/schedules/Schedules.idf`: todas las variantes de horario, las tres interpolaciones, festivos en todos los formatos de fecha, regla de fin de semana, horario de verano, `ZoneList` y los 7 tipos de carga con distintos métodos.
- Coinciden hora por hora, todo el año, en los 8 ejemplos y en ese archivo: el calendario, cada horario, los días de diseño, y por zona los ocupantes, el calor de personas (ocupantes × actividad), la iluminación y los equipos eléctricos, de gas, agua caliente, vapor y otros. También coincide la altura de techo de cada zona.
- Reglas de EnergyPlus confirmadas:
  - con interpolación `Linear` se toma el valor de la rampa al final de cada timestep, no el promedio;
  - con `Average` (o `Yes` en 8.0–8.8) se promedian los minutos del timestep;
  - un festivo en sábado o domingo pasa al lunes si `Apply Weekend Holiday Rule` es `Yes`;
  - con horario de verano, la hora h usa el valor de la hora h + 1;
  - las superficies sin `Space Name` pertenecen al único espacio de su zona;
  - `Other Equipment` reporta el calor descontando `Fraction Lost`, y los demás equipos reportan el consumo.
- Lo que el visor no puede reproducir y por eso avisa en pantalla: horarios que cambia EMS durante la simulación (actuadores sobre `Schedule:*`), iluminación atenuada por `Daylighting:Controls`, y días de inicio, festivos u horario de verano que vienen del archivo de clima.
- Pestañas nuevas: **Schedules** (por horario y por zona) y **Loads** (tabla de zonas, cargas en el tiempo y verificación de ocupación).

### Fase 2b · Ventanas, ventilación natural e infiltración

- [x] 2b.1 Geometría simplificada (C6): hecha en la fase 1.
- [x] 2b.2 Inventario de ventanas (L1) y ventanas en 3D por operabilidad (L2).
- [x] 2b.3 Resumen del AFN (L3), ficha de apertura (L4) y diagrama de apertura (L5).
- [x] 2b.4 Reglas de apertura (L6).
- [x] 2b.5 Infiltración (L7) y ventilación sin AFN (L8).
- [x] 2b.6 Validaciones de ventilación (L12), probadas con IDF que tienen errores a propósito.

**Listo cuando:**
- los ejemplos con AFN muestran fichas completas con los valores efectivos, incluyendo `ZoneLevel`;
- las validaciones detectan los errores sembrados en los archivos de prueba;
- funciona con la sintaxis AFN de 8.x y de 9.0+.

**Avance de la fase 2b (se completa al cerrar la fase):**
- 2b.2: pestaña nueva **Windows** con el inventario de ventanas y puertas: tipo, zona, superficie anfitriona, orientación, ancho × alto, antepecho y dintel (medidos desde el punto más bajo del muro), área sin marco, área de marco, multiplicadores, área total, construcción, U/SHGC/VT de `WindowMaterial:SimpleGlazingSystem`, marco, control de sombreado y su papel en el AFN (componente, factor de apertura, Cd y modo de control). Se filtra por tipo, zona, orientación y papel en el AFN; el botón "3D" lleva a la ventana en la vista 3D.
- En 3D hay tres modos nuevos de color cuando el archivo tiene AFN: papel en el AFN (abertura detallada, simple u horizontal; grieta o área de fuga; extractor; flujo especificado; ventana fija), factor de apertura máximo y Cd.
- Reglas usadas (de la documentación de EnergyPlus, pendientes de confirmar con referencias):
  - el Cd de un `DetailedOpening` se interpola linealmente entre sus juegos de factor de apertura; el visor lo muestra en el factor de apertura de la superficie;
  - con `ZoneLevel` (valor por omisión en la superficie) manda el modo de `AirflowNetwork:MultiZone:Zone`, cuyo valor por omisión es `NoVent`;
  - en superficies interzona solo se declara un lado del par en `AirflowNetwork:MultiZone:Surface` y el otro lado comparte el componente;
  - antes de 9.0 cada ventana nombra su `WindowProperty:ShadingControl`; desde 9.0 `WindowShadingControl` lista las ventanas.
- Comprobado contra EnergyPlus: el área total de ventanas por orientación coincide con la tabla ventana-muro en los 8 ejemplos.
- Archivos de prueba nuevos: `tests/fixtures/windows/Windows.idf` (26.2) y `Windows-8.9.idf`.
- 2b.3: la pestaña se llama ahora **Ventilation** y tiene dos secciones. "Windows and doors" es el inventario. "Airflow network" tiene:
  - el resumen del AFN: control, origen de los Cp, zonas con su modo de ventilación, superficies, componentes, nodos externos y condiciones de referencia de grietas;
  - la ficha de cada superficie, con superficie AFN, control de ventilación, componente y nodo externo con su tabla de Cp. Cada valor indica si viene de la superficie o de la zona, si es el valor por omisión del IDD y si el modo de control lo usa;
  - en un `DetailedOpening`, la tabla de juegos de factor de apertura, el dibujo del área abierta en cada juego y en el factor máximo, y la gráfica de Cd y de Cd × área abierta contra el factor de apertura.
- Reglas usadas en 2b.3 (de la documentación de EnergyPlus, pendientes de confirmar):
  - con `ZoneLevel` se toman de `AirflowNetwork:MultiZone:Zone` el modo, el horario de setpoint, el factor mínimo, los límites de ΔT y Δh, el horario de disponibilidad y el control por ocupantes; el factor de apertura sigue siendo el de la superficie;
  - en un par interzona, la zona que manda es la del lado declarado en el AFN;
  - qué valores usa cada modo: `Temperature` usa setpoint, factor mínimo y ΔT; `Enthalpy` usa setpoint, factor mínimo y Δh; `Constant` y los adaptativos solo la disponibilidad; `NoVent` ninguno;
  - un horario de disponibilidad en blanco significa siempre disponible;
  - área abierta de un `DetailedOpening` no pivotado = ancho × alto × factor de ancho × factor de alto (interpolados); de `SimpleOpening` y `HorizontalOpening` = factor de apertura × área;
  - una abertura no rectangular usa un rectángulo equivalente de la misma área: `PolygonHeight` (alto del polígono), `BaseSurfaceAspectRatio` o `UserDefinedAspectRatio`;
  - el tipo de edificio, el eje largo y la relación de anchos solo se usan cuando EnergyPlus calcula los Cp (`SurfaceAverageCalculation`).
- 2b.4: la ficha de cada abertura operable dice, en orden, qué condiciones deben cumplirse para que abra según su modo de control. También dice cuántas horas del año está disponible (su horario evaluado con el evaluador de la fase 2a) y, con `Temperature` o `Enthalpy`, grafica el factor de apertura contra ΔT o Δh entre los dos límites. La gráfica de juegos de factor de apertura (L5) ahora explica cada línea, llama "área efectiva" a Cd × área abierta y dice qué porcentaje del área efectiva queda a media apertura.
- Reglas usadas en 2b.4 (de la documentación de EnergyPlus, pendientes de confirmar):
  - `Temperature`: abre si hay disponibilidad, si la zona está más caliente que el exterior y si está por arriba del setpoint; con ΔT ≤ límite inferior abre al factor máximo, con ΔT ≥ límite superior al factor máximo × factor mínimo, y entre ambos cambia en línea recta. `Enthalpy` es igual con Δh y la entalpía. Los modos "Adjacent" comparan con la zona vecina;
  - `Constant`: abre al factor máximo siempre que haya disponibilidad;
  - `ASHRAE55Adaptive` y `CEN15251Adaptive`: abren al factor máximo cuando la temperatura operativa supera la temperatura de confort adaptativo y la zona está más caliente que el exterior;
  - `NoVent`: siempre cerrada;
  - si el límite superior no es mayor que el inferior, EnergyPlus marca error de entrada.
- 2b.5: tercera sección de la pestaña Ventilation, **Infiltration and ventilation**:
  - tabla de zonas con volumen, área exterior, área de ventanas, infiltración de diseño (m³/s y ACH), ventilación (ACH), área de aberturas por viento y tiro térmico, y su relación con el AFN (grietas y áreas de fuga);
  - infiltración por objeto: método, caudal de diseño, ACH, caudal por m² de piso y de área exterior, horario y modelo de coeficientes (constante, DOE-2, BLAST o propio). `EffectiveLeakageArea` y `FlowCoefficient` se muestran con su fórmula, porque dependen del clima;
  - `ZoneVentilation:DesignFlowRate` con sus límites (solo los que no están en su valor por omisión), `ZoneVentilation:WindandStackOpenArea` con su área comparada con las ventanas de la zona, `ZoneMixing`, `ZoneCrossMixing`, `ZoneAirBalance:OutdoorAir` y `ZoneThermalChimney`.
- La asignación de objetos a zonas (`Zone`, `ZoneList`, `Space`, `SpaceList`) se movió a un módulo común (`src/core/model/targets.ts`) que usan cargas e infiltración; las cargas siguen coincidiendo con EnergyPlus.
- Reglas usadas en 2b.5 (de la documentación de EnergyPlus, pendientes de confirmar):
  - `Flow/ExteriorArea` usa el área bruta de muros, techos y pisos con frontera `Outdoors`; `Flow/ExteriorWallArea`, solo los muros;
  - `AirChanges/Hour` = ACH × volumen / 3600; un `Space` usa la parte del volumen de su zona proporcional a su área de piso;
  - un objeto asignado a una `ZoneList` aplica su caudal completo a cada zona;
  - coeficientes de referencia: constante (1, 0, 0, 0), DOE-2 (0, 0, 0.224, 0), BLAST (0.606, 0.03636, 0.1177, 0);
  - `WindandStackOpenArea` con `autocalculate`: Cw = 0.55 − 0.25 × ángulo / 180°, Cd = 0.40 + 0.0045·|ΔT|.
- Archivos de prueba nuevos: `tests/fixtures/ventilation/Flows.idf` (26.2) y `Flows-8.9.idf`. `make_oracles.py` guarda ahora las tablas "Airflow Stats Nominal" del `.eio` (caudal de diseño, ACH y coeficientes por objeto y zona), y la prueba que las compara está lista.
- 2b.6: el panel de problemas tiene la categoría **Ventilation**:
  - errores: zona con superficies AFN sin `AirflowNetwork:MultiZone:Zone`; superficie exterior sin nodo externo cuando los Cp son `Input`; `DetailedOpening` cuyos factores de apertura no empiezan en 0, no terminan en 1 o no van en aumento; Cd fuera de (0, 1]; factores de ancho, alto o altura de inicio fuera de [0, 1]; límite superior de ΔT o Δh no mayor que el inferior;
  - advertencias: `ZoneInfiltration`, `ZoneVentilation`, `ZoneMixing` o `ZoneCrossMixing` en una zona del AFN; altura de inicio + factor de alto mayor que 1;
  - notas: superficies AFN que no tienen efecto porque el AFN está apagado, aberturas no rectangulares (rectángulo equivalente) y aberturas cuyo factor fija un programa EMS;
  - las referencias AFN rotas (superficie, componente o nodo que no existen) ya las marcaba la revisión general de referencias (H1).
- Archivo de prueba con errores a propósito: `tests/fixtures/ventilation/AfnErrors.idf`. Ningún ejemplo ni archivo de prueba correcto produce problemas de ventilación.
- Corrección: los números distintos de cero menores que 0.01 se muestran con dos cifras significativas (antes, un Cd de 0.001 aparecía como 0).
- **Pendiente:** `make_oracles.py` ya pide la tabla "Exterior Fenestration" de EnergyPlus y la prueba que la compara está lista, pero falta correrlo con EnergyPlus 26.2, que no está instalado en esta computadora.

### Fase 2c · Construcciones, validación y complementos

- [ ] 2c.1 Corte de capas (E1) y uso de cada construcción (E3).
- [ ] 2c.2 Capas y cortes 3D (C7), diagnóstico visual de geometría (C8) y elementos adicionales (C9).
- [ ] 2c.3 Validación contra el IDD (H3), objetos sin uso (H4) y problemas de geometría (H5).
- [ ] 2c.4 Vista de texto sincronizada (B6).
- [ ] 2c.5 Lectura de epJSON (A5) y apertura desde una URL (A6).
- [ ] 2c.6 Ubicación y días de diseño (D5) y salidas solicitadas (D6).

**Listo cuando:** todos los features de esta fase funcionan con los ejemplos y con archivos de las versiones 8.x y 9.x.

### Fase 3 · Extras de ventilación

- [x] 3.1 Gráfica polar de Cp (L9), con la sintaxis de 8.x y de 9.0+.
- [ ] 3.2 Red de flujo entre zonas (L11).

**Avance de la fase 3 (se completa al cerrar la fase):**
- 3.1: sección nueva **Wind** en Ventilation.
  - Tabla de nodos externos con altura, viento local entre viento del clima, de dónde salen los Cp, tipo de ángulo, simetría y superficies que usan cada nodo. Al hacer clic en un nodo se ve su gráfica polar; "Compare all nodes" los encima.
  - Gráfica polar: Cp contra dirección del viento, con los valores de entrada como puntos, el círculo Cp = 0 punteado y, en ángulo absoluto, una línea hacia donde mira cada fachada. La misma gráfica aparece en la ficha de cada abertura.
  - Aviso cuando una superficie mira lejos (más de 45°) de la dirección donde su nodo tiene el Cp más alto. En la casa de ejemplo, el techo este usa el nodo de la fachada sur.
  - Perfil de viento del sitio: exponente y capa límite del terreno o de `Site:HeightVariation`, datos de `Site:WeatherStation`, y gráfica del viento local contra la altura con los nodos marcados.
  - Con `SurfaceAverageCalculation` (como en tu archivo) dice que EnergyPlus calcula los Cp y que el visor todavía no reproduce ese cálculo (L10, a futuro).
- Sintaxis cubiertas: 8.0–8.7 (el nodo nombra un `WindPressureCoefficientValues`; el arreglo de direcciones también está en `AirflowNetwork:SimulationControl`), 8.8+ (valores, curva o tabla, con simetría y ángulo relativo), `Table:OneIndependentVariable` (hasta 9.1) y `Table:Lookup` (9.2+). Curvas dibujadas: `Curve:Linear`, `Quadratic`, `Cubic`, `Quartic` y `Exponent`; otras se nombran pero no se dibujan. Tablas que leen un archivo externo no se dibujan.
- `make_oracles.py` ahora también guarda las tablas "Environment:Site Atmospheric Variation" y "Environment:Weather Station" del `.eio`; la prueba "site wind profile matches EnergyPlus" las compara cuando existan.
- Reglas usadas en 3.1 (de la documentación de EnergyPlus, pendientes de confirmar):
  - Viento local: V(z) = V<sub>clima</sub> · (δ<sub>est</sub>/z<sub>est</sub>)^α<sub>est</sub> · (z/δ)^α; cero en z ≤ 0. Estación por omisión: 10 m, α 0.14, δ 270 m.
  - Terreno: Country 0.14/270 m, Suburbs 0.22/370 m, City 0.33/460 m, Ocean 0.10/210 m, Urban 0.22/370 m.
  - `Site:HeightVariation` reemplaza solo los campos que escribe; un campo en blanco antes del último escrito toma el valor por omisión del IDD (0.22 y 370 m). **Se confirma con el `.eio` de `Wind.idf`.**
  - `WindPressureCoefficientValues`: interpolación lineal entre direcciones y, después de la última, de regreso a la primera en 360°.
  - Simétrico: de 180° a 360° se usa el valor de 360° − ángulo. Relativo: el ángulo se mide desde la normal de la fachada.
  - Ángulo absoluto: dirección de donde viene el viento, en sentido horario desde el norte, igual que en el archivo de clima.

### Fase 4 · Instalable

- [ ] 4.1 PWA con vite-plugin-pwa: manifiesto, íconos, funcionamiento sin conexión y apertura de `.idf` con doble clic (K5). Hay que decidir si al instalar se descargan todos los esquemas o solo los de las versiones que se vayan abriendo.

### A futuro

En este orden: archivos recientes (K6), y luego, según interés, B9, C10, L10, D7 y HVAC (G1–G4).

## 7. Riesgos y cómo se cubren

| Riesgo | Cómo se cubre |
|---|---|
| Casos raros de los horarios (interpolación, años bisiestos, festivos, horario de verano) | Comparación hora por hora contra EnergyPlus (2a.2) |
| Geometría con reglas poco comunes (coordenadas relativas, rotaciones, vértice inicial distinto) | Comparación de vértices y áreas contra EnergyPlus (1.4) |
| Cambios de nombre de clases y campos entre versiones | Archivos de prueba de 8.x, 9.x y 22+; casos conocidos en §2 |
| Las referencias de EnergyPlus solo existen para 26.2 | Para versiones antiguas se prueban la lectura, los nombres de campo y la consistencia de la geometría, no los valores calculados |
| Rendimiento con archivos grandes | `HospitalLowEnergy.idf` como prueba fija, worker, geometría agrupada y tablas que solo dibujan lo visible |
| Colores exactos de OpenStudio | Se toman de su código fuente; si alguno no se encuentra, se usa un color cercano y se documenta |

## 8. Ideas nuevas

> Si se te ocurre algo más, agrégalo aquí y lo integro a una fase.

- …

## 9. Dónde vamos (2026-11-22)

**Terminado y publicado:** fases 0, 1 y 2a, en https://altamarmx.github.io/idf-viewer/. El visor tiene las pestañas Summary, 3D, Table, Ventilation, Schedules, Loads y Problems.

**Fase 3 adelantada:** la 3.1 (Cp y perfil de viento) está hecha; sigue la 3.2 (red de flujo entre zonas). Se empezó antes de cerrar la 2b porque no necesita EnergyPlus; el cierre de la 2b y la comparación del perfil de viento se hacen juntos en la computadora con EnergyPlus 26.2.

**En curso:** fase 2b (ventanas, ventilación natural e infiltración). Las tareas 2b.2 a 2b.6 están hechas y publicadas. Falta el **cierre de la fase, que se hará en la computadora que tiene EnergyPlus 26.2** (en esta no está instalado):

1. `uv run tools/make_oracles.py` (sin `--annual`) para regenerar las referencias de los 8 ejemplos y de `tests/fixtures/geometry`, `windows` y `ventilation`. Ahora guardan además la tabla "Exterior Fenestration" y, del `.eio`, las tablas "Airflow Stats Nominal" y las del perfil de viento.
2. `npm test`: las pruebas que hoy se saltan ("matches the EnergyPlus fenestration table", "design flows match EnergyPlus" y "site wind profile matches EnergyPlus") pasarán a comparar. Si algo no coincide, corregir la regla y anotarla.
3. Confirmar o corregir las reglas marcadas como "pendientes de confirmar" en el avance de las fases 2b y 3, y pasarlas a sus notas de fase.
4. Revisar que el README siga al día (ya menciona ventanas, AFN e infiltración), commit, push y revisar que GitHub Actions pase y el sitio quede publicado.

**Tu IDF de prueba (`examples/1ra_Airflow.idf`) es privado:** está en `.git/info/exclude` y no se sube al repositorio, que es público. Por la misma razón no se generan sus referencias de EnergyPlus (`tests/oracles/1ra_Airflow*.json`), porque tendrían datos de tu edificio. Si `make_oracles.py` corre sobre todo `examples/` en una computadora donde esté el archivo, borra esas referencias antes del commit.

### Cómo seguir en otra computadora

1. Instala git, Node.js 22 o más nuevo (GitHub usa la 24) y [uv](https://docs.astral.sh/uv/).
2. Descarga el proyecto:
   ```sh
   git clone https://github.com/AltamarMx/idf-viewer.git
   cd idf-viewer
   npm ci      # librerías del visor
   uv sync     # Python para las herramientas de desarrollo
   ```
3. Revisa que todo pasa, igual que en GitHub:
   ```sh
   npm run lint && npm run typecheck && npm test && uv run pytest
   PW_CHANNEL=chrome npm run e2e   # pruebas en navegador con tu Chrome
   ```
   Sin Chrome instalado: `npx playwright install chromium` y luego `npm run e2e`.
4. `npm run dev` abre el visor en tu computadora.

No hace falta descargar nada de EnergyPlus para trabajar: los esquemas (`public/schemas/`) y las referencias (`tests/oracles/`) ya están en el repositorio. **EnergyPlus 26.2** solo se necesita para regenerar referencias (`tools/make_oracles.py`) o esquemas (`tools/fetch_idds.py` y `tools/idd2json.py`). Los scripts lo buscan en `/Applications/EnergyPlus-*`; en otra ubicación se indica con `--energyplus`.

La conversación con Claude y sus notas se quedan en la computadora anterior. Lo necesario para continuar está en este archivo y en `CLAUDE.md`, que Claude Code lee al abrir la carpeta. Para retomar, abre Claude Code en la carpeta del proyecto y pide seguir con la fase 2b.
