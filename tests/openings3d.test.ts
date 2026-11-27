/**
 * Open part of operable AirflowNetwork openings in the 3D view
 * (tests/fixtures/schedules/Venting.idf): what part of each window is open,
 * where it is drawn, and when it opens, against EnergyPlus 26.2.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type OpeningShape,
  type OpeningsView,
  openPart,
  partArea,
  stateAt,
} from '../src/core/airflow/openings3d';
import { type GeometryView, openFile, type Session } from '../src/core/session';
import { openCorners, openingQuads, windowFrame } from '../src/features/viewer3d/openings';
import { type AnnualOracle, expand } from './annual';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const FILE = 'tests/fixtures/schedules/Venting.idf';
const VARIABLE = 'AFN Surface Venting Window or Door Opening Factor';

describe('open part of each opening', () => {
  const base: OpeningShape = {
    surfaceId: 1,
    name: 'W',
    component: 'C',
    type: 'simpleopening',
    controlMode: 'Constant',
    ruleKind: 'constant',
    maxFactor: 0.5,
    width: 4,
    height: 1.5,
    availability: -1,
  };

  it('SimpleOpening and HorizontalOpening: width × opening factor, full height', () => {
    expect(openPart(base, 0.5)).toEqual({ kind: 'rect', x0: 0, x1: 2, y0: 0, y1: 1.5 });
    expect(openPart({ ...base, type: 'horizontalopening' }, 0.25)).toEqual({
      kind: 'rect',
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 1.5,
    });
    expect(openPart(base, 0)).toBeNull();
  });

  it('DetailedOpening: width and height factors from the start height, interpolated', () => {
    const shape: OpeningShape = {
      ...base,
      type: 'detailedopening',
      sets: [
        { openingFactor: 0, cd: 0.4, widthFactor: 0, heightFactor: 1, startHeightFactor: 0 },
        { openingFactor: 1, cd: 0.6, widthFactor: 0.5, heightFactor: 0.6, startHeightFactor: 0.2 },
      ],
    };
    const part = openPart(shape, 0.5);
    expect(part).toMatchObject({ kind: 'rect', x0: 0 });
    expect(part?.kind === 'rect' && part.y0).toBeCloseTo(0.15); // 1.5 × 0.1
    expect(part?.kind === 'rect' && part.x1).toBeCloseTo(1); // 4 × 0.25
    expect(part?.kind === 'rect' && part.y1).toBeCloseTo(0.15 + 1.2); // 1.5 × 0.8
    expect(partArea(part)).toBeCloseTo(1.2);
  });

  it('a horizontally pivoted DetailedOpening turns by factor × 90° about its axis', () => {
    const shape: OpeningShape = { ...base, type: 'detailedopening', pivotHeight: 0.75, sets: [] };
    expect(openPart(shape, 0.5)).toEqual({ kind: 'pivot', angle: 45, axis: 0.75 });
    expect(partArea(openPart(shape, 0.5))).toBeUndefined();
  });

  it('draws the open part on the window, in front of the glass', () => {
    // A 4 × 1.5 m window on a south wall (outward normal −y), x 3..7, z 1..2.5.
    const surface = {
      normal: [0, -1, 0],
      positions: Float32Array.from([3, 0, 2.5, 3, 0, 1, 7, 0, 1, 7, 0, 2.5]),
    } as unknown as GeometryView['surfaces'][number];
    const frame = windowFrame(surface);
    expect(frame.width).toBeCloseTo(4);
    expect(frame.height).toBeCloseTo(1.5);
    // Seen from outside (from the south) the width runs east, from the left edge.
    expect(frame.u).toEqual([1, 0, 0]);
    const corners = openCorners(base, frame, 0.5)?.map((c) => c.map((v) => Number(v.toFixed(6))));
    expect(corners).toEqual([
      [3, -0.04, 1],
      [5, -0.04, 1],
      [5, -0.04, 2.5],
      [3, -0.04, 2.5],
    ]);
    // A pivoted sash at 90°: horizontal, sticking out above the axis and in below it.
    const pivot = openCorners(
      { ...base, type: 'detailedopening', pivotHeight: 0.75, sets: [] },
      frame,
      1,
    )?.map((c) => c.map((v) => Number(v.toFixed(6))));
    expect(pivot?.[0]).toEqual([3, 0.71, 1.75]);
    expect(pivot?.[2]).toEqual([7, -0.79, 1.75]);
  });
});

describe('Venting.idf in 3D', () => {
  let session: Session;
  let view: OpeningsView;
  let oracle: AnnualOracle;
  beforeAll(async () => {
    session = await openFile({ name: FILE, buffer: fileBuffer(FILE) }, diskSchemaLoader());
    view = session.openings();
    oracle = JSON.parse(
      readFileSync(resolve(ROOT, 'tests/oracles/Venting.annual.json'), 'utf8'),
    ) as AnnualOracle;
  });
  const shape = (name: string) => view.openings.find((o) => o.name === name) as OpeningShape;

  it('lists the operable openings with their schedules', () => {
    expect(view.timestepsPerHour).toBe(4);
    expect(view.openings.map((o) => [o.name, o.type, o.ruleKind, o.schedule]).sort()).toEqual([
      ['GlassDoor:North', 'detailedopening', 'constant', 'Venting Summer Nights'],
      ['Win:East', 'detailedopening', 'modulated', 'Venting Weekdays'],
      ['Win:South', 'simpleopening', 'constant', 'Venting Weekdays'],
    ]);
    // Two openings share one schedule.
    expect(view.schedules.map((s) => s.name).sort()).toEqual([
      'Venting Summer Nights',
      'Venting Weekdays',
    ]);
    expect(shape('Win:South')).toMatchObject({ width: 4, height: 1.5, maxFactor: 0.5 });
  });

  it.each(['Win:South', 'GlassDoor:North'])(
    '%s (Constant) is open exactly when EnergyPlus opens it',
    (name) => {
      const reference = expand(
        oracle.timestep?.surfaces?.[name.toUpperCase()]?.[VARIABLE] ?? { profiles: [], days: [] },
      );
      expect(reference.length).toBe(35040);
      const differ = reference.flatMap((v, step) =>
        (stateAt(shape(name), view, step) === 'open') !== v > 0 ? [step] : [],
      );
      expect(differ).toEqual([]);
    },
  );

  it('Win:East (Temperature) may open only when available, and EnergyPlus agrees', () => {
    const east = shape('Win:East');
    const reference = expand(
      oracle.timestep?.surfaces?.['WIN:EAST']?.[VARIABLE] ?? { profiles: [], days: [] },
    );
    const opened = reference.flatMap((v, step) => (v > 0 ? [step] : []));
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((step) => stateAt(east, view, step) !== 'may')).toEqual([]);
    expect(stateAt(east, view, null)).toBe('may');
  });

  it('draws each open part on its window', () => {
    const geometry = session.geometryView();
    const { quads, counts } = openingQuads(
      view,
      geometry.surfaces,
      null,
      () => true,
      geometry.surfaces.map(() => [0, 0, 0]),
    );
    expect(counts).toEqual({ open: 2, may: 1, closed: 0 });
    expect(quads).toHaveLength(3);
    // Win:South: half of its width, on the south wall.
    const south = quads.find((q) => geometry.surfaces[q.surface]?.name === 'Win:South');
    const [cx, cy, cz] = geometry.center;
    const world = south?.corners.map(([x, y, z]) =>
      [x + cx, y + cy, z + cz].map((v) => Number(v.toFixed(4))),
    );
    expect(world).toEqual([
      [3, -0.04, 1],
      [5, -0.04, 1],
      [5, -0.04, 2.5],
      [3, -0.04, 2.5],
    ]);
  });
});
