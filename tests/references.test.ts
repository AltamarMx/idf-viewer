import { describe, expect, it } from 'vitest';
import { listExamples } from '../build/examples-plugin';
import { IdfModel } from '../src/core/model/model';
import { buildReferences } from '../src/core/model/references';
import { parseIdf } from '../src/core/parser/idf';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();

async function refsOf(text: string) {
  const schema = await loader.schema('26.2');
  const model = new IdfModel(parseIdf(text).objects);
  return { model, refs: buildReferences(model, schema) };
}

describe('buildReferences', () => {
  it('links a surface to its construction and the construction to its material', async () => {
    const { model, refs } = await refsOf(`
      Material:NoMass, R13LAYER, Rough, 2.29, 0.9, 0.75, 0.75;
      Construction, R13WALL, R13LAYER;
      Zone, Zone 1;
      BuildingSurface:Detailed, Wall 1, Wall, r13wall, Zone 1, , Outdoors, , SunExposed, WindExposed, , 3,
        0,0,3, 0,0,0, 4,0,0;`);
    const wall = model.ofClass('BuildingSurface:Detailed')[0]?.id as number;
    const construction = model.ofClass('Construction')[0]?.id as number;
    const material = model.ofClass('Material:NoMass')[0]?.id as number;
    expect(refs.uses.get(wall)?.map((e) => e.to)).toEqual([
      construction,
      model.ofClass('Zone')[0]?.id,
    ]);
    expect(refs.usedBy.get(material)?.map((e) => e.from)).toEqual([construction]);
    expect(refs.broken).toEqual([]);
  });

  it('reports names that are not defined and duplicate names', async () => {
    const { refs } = await refsOf(`
      Construction, WALL, MISSING LAYER;
      Zone, Zone 1;
      Zone, ZONE 1;`);
    expect(refs.broken).toMatchObject([{ fieldName: 'Outside Layer', value: 'MISSING LAYER' }]);
    expect(refs.duplicates).toMatchObject([{ className: 'Zone', name: 'Zone 1' }]);
    expect(refs.duplicates[0]?.objectIds).toHaveLength(2);
  });

  it('accepts class names in component type fields', async () => {
    const { refs } = await refsOf(`
      Branch, Main Branch, , Coil:Heating:Water, Heating Coil, Inlet Node, Outlet Node;
      Coil:Heating:Water, Heating Coil;`);
    expect(refs.broken).toEqual([]);
  });
});

describe('examples', () => {
  it('have no broken references except the hospital refrigeration curves', async () => {
    for (const example of listExamples('examples')) {
      const path = `examples/${example.file}`;
      const session = await openFile({ name: path, buffer: fileBuffer(path) }, loader);
      const refs = buildReferences(session.model, session.schema);
      const broken = refs.broken.map((b) => b.fieldName);
      if (example.file === 'HospitalLowEnergy.idf') {
        expect(new Set(broken)).toEqual(new Set(['Defrost Energy Correction Curve Name']));
      } else {
        expect(broken, example.file).toEqual([]);
      }
      expect(refs.duplicates, example.file).toEqual([]);
    }
  });
});
