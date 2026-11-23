/**
 * Constructions and their layers (E1) and where each construction is used (E3).
 * Layers are shown with their properties as written in the IDF (or the IDD
 * default when blank); no derived value such as U or R is computed.
 *
 * Layers are read from the fields named "Outside Layer" and "Layer N", which
 * Construction, Construction:InternalSource (up to 9.x) and
 * Construction:WindowEquivalentLayer share. The internal heat source of 22.1+
 * (ConstructionProperty:InternalHeatSource) points to its construction.
 */
import { GEOMETRY_CLASSES, type GeometryResult, type SurfaceKind } from '../geometry/build';
import { type DescribedField, describeField } from '../model/describe';
import type { IdfModel } from '../model/model';
import { objectName } from '../model/model';
import { FieldReader } from '../model/reader';
import type { ReferenceIndex } from '../model/references';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';

export type LayerCategory =
  | 'opaque'
  | 'nomass'
  | 'airgap'
  | 'glazing'
  | 'gas'
  | 'simpleglazing'
  | 'shading'
  | 'other'
  | 'missing';

export interface ConstructionLayer {
  /** Name as written in the construction. */
  name: string;
  id?: number;
  className?: string;
  category: LayerCategory;
  /** Thickness in m, when the material has one. */
  thickness?: number;
  /** Fields of the material, except its name. */
  fields: DescribedField[];
}

export interface InternalSource {
  id: number;
  className: string;
  name?: string;
  /** "Source Present After Layer Number" (layers counted from outside). */
  afterLayer?: number;
  fields: DescribedField[];
}

export interface ConstructionUser {
  id: number;
  className: string;
  name?: string;
  fieldName: string;
}

export interface ConstructionRow {
  id: number;
  name: string;
  className: string;
  /** Layers from outside to inside; empty for constructions without layers. */
  layers: ConstructionLayer[];
  /** Fields that are not layers (C-factor, F-factor, air boundary, internal source…). */
  fields: DescribedField[];
  internalSource?: InternalSource;
  /** Has a glazing, gas or simple glazing layer. */
  glazed: boolean;
  /** Sum of the layers that have a thickness, in m. */
  thickness: number;
  usage: {
    surfaces: number;
    /** Area × surface multiplier, without zone multipliers, m². */
    area: number;
    zones: number;
    byKind: { kind: SurfaceKind; count: number; area: number }[];
    list: { id: number; name: string; kind: SurfaceKind; zone?: string; area: number }[];
  };
  /** Objects other than surfaces that name this construction. */
  usedBy: ConstructionUser[];
}

const CONSTRUCTION_CLASSES = [
  'construction',
  'construction:internalsource',
  'construction:cfactorundergroundwall',
  'construction:ffactorgroundfloor',
  'construction:airboundary',
  'construction:windowdatafile',
  'construction:windowequivalentlayer',
  'construction:complexfenestrationstate',
];

const CATEGORY: Record<string, LayerCategory> = {
  material: 'opaque',
  'material:roofvegetation': 'opaque',
  'material:nomass': 'nomass',
  'material:infraredtransparent': 'nomass',
  'material:airgap': 'airgap',
  'windowmaterial:glazing': 'glazing',
  'windowmaterial:glazing:refractionextinctionmethod': 'glazing',
  'windowmaterial:glazinggroup:thermochromic': 'glazing',
  'windowmaterial:glazing:equivalentlayer': 'glazing',
  'windowmaterial:gas': 'gas',
  'windowmaterial:gasmixture': 'gas',
  'windowmaterial:gap': 'gas',
  'windowmaterial:gap:equivalentlayer': 'gas',
  'windowmaterial:simpleglazingsystem': 'simpleglazing',
  'windowmaterial:shade': 'shading',
  'windowmaterial:blind': 'shading',
  'windowmaterial:screen': 'shading',
  'windowmaterial:complexshade': 'shading',
  'windowmaterial:shade:equivalentlayer': 'shading',
  'windowmaterial:blind:equivalentlayer': 'shading',
  'windowmaterial:screen:equivalentlayer': 'shading',
  'windowmaterial:drape:equivalentlayer': 'shading',
};

/** Material classes whose "Thickness" field is the depth of the layer. */
const HAS_THICKNESS = new Set([
  'material',
  'material:roofvegetation',
  'windowmaterial:glazing',
  'windowmaterial:glazing:refractionextinctionmethod',
  'windowmaterial:gas',
  'windowmaterial:gasmixture',
  'windowmaterial:gap',
  'windowmaterial:shade',
  'windowmaterial:complexshade',
]);

const LAYER_FIELD = /^(Outside Layer|Layer \d+)$/;

export function constructionList(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  references: ReferenceIndex,
): ConstructionRow[] {
  if (!schema) return [];
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);
  const allFields = (obj: IdfObject, r: FieldReader, skip: (name: string) => boolean) =>
    (r.cls?.fields ?? [])
      .filter((f) => !skip(f.name))
      .map((f) => describeField(obj, r, references, f.name))
      .filter((f): f is DescribedField => Boolean(f) && (f as DescribedField).value !== '');

  // Surfaces by construction name.
  const surfaces = new Map<string, GeometryResult['surfaces']>();
  for (const s of geometry.surfaces) {
    if (s.kind === 'shading' || !s.construction) continue;
    const key = s.construction.toLowerCase();
    const list = surfaces.get(key) ?? [];
    list.push(s);
    surfaces.set(key, list);
  }

  // 22.1+: internal heat sources point to their construction.
  const sources = new Map<string, InternalSource>();
  for (const obj of model.ofClass('constructionproperty:internalheatsource')) {
    const r = reader(obj);
    sources.set(r.str('Construction Name').toLowerCase(), {
      id: obj.id,
      className: obj.className,
      name: r.str('Name') || undefined,
      afterLayer: r.num('Thermal Source Present After Layer Number'),
      fields: allFields(obj, r, (n) => n === 'Name' || n === 'Construction Name'),
    });
  }

  const layerOf = (obj: IdfObject, r: FieldReader, field: string): ConstructionLayer | null => {
    const name = r.str(field);
    if (!name) return null;
    const index = r.indexOf(field) as number;
    const target = references.uses.get(obj.id)?.find((e) => e.field === index)?.to;
    const material = target === undefined ? undefined : model.objects[target];
    if (!material) return { name, category: 'missing', fields: [] };
    const cls = material.className.toLowerCase();
    const mr = reader(material);
    return {
      name,
      id: material.id,
      className: material.className,
      category: CATEGORY[cls] ?? 'other',
      thickness: HAS_THICKNESS.has(cls) ? mr.num('Thickness') : undefined,
      fields: allFields(material, mr, (n) => n === 'Name'),
    };
  };

  const rows: ConstructionRow[] = [];
  for (const key of CONSTRUCTION_CLASSES) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const name = r.str('Name');
      const layerFields = (r.cls?.fields ?? [])
        .map((f) => f.name)
        .filter((n) => LAYER_FIELD.test(n));
      const layers = layerFields
        .map((f) => layerOf(obj, r, f))
        .filter((l): l is ConstructionLayer => l !== null);

      let internalSource = sources.get(name.toLowerCase());
      const fields = allFields(obj, r, (n) => n === 'Name' || LAYER_FIELD.test(n));
      if (key === 'construction:internalsource') {
        internalSource = {
          id: obj.id,
          className: obj.className,
          afterLayer: r.num('Source Present After Layer Number'),
          fields,
        };
      }

      const used = surfaces.get(name.toLowerCase()) ?? [];
      const byKind = new Map<SurfaceKind, { count: number; area: number }>();
      let area = 0;
      for (const s of used) {
        const a = s.area * s.multiplier;
        area += a;
        const entry = byKind.get(s.kind) ?? { count: 0, area: 0 };
        entry.count++;
        entry.area += a;
        byKind.set(s.kind, entry);
      }

      const usedBy: ConstructionUser[] = [];
      for (const edge of references.usedBy.get(obj.id) ?? []) {
        const from = model.objects[edge.from] as IdfObject;
        const cls = from.className.toLowerCase();
        if (GEOMETRY_CLASSES.has(cls) || cls === 'constructionproperty:internalheatsource')
          continue;
        const fromCls = schema.classes[cls];
        usedBy.push({
          id: from.id,
          className: from.className,
          name: objectName(from, fromCls),
          fieldName: fromCls?.fields[edge.field]?.name ?? `Field ${edge.field + 1}`,
        });
      }

      rows.push({
        id: obj.id,
        name,
        className: obj.className,
        layers,
        fields: key === 'construction:internalsource' ? [] : fields,
        internalSource,
        glazed: layers.some((l) => ['glazing', 'gas', 'simpleglazing'].includes(l.category)),
        thickness: layers.reduce((sum, l) => sum + (l.thickness ?? 0), 0),
        usage: {
          surfaces: used.length,
          area,
          zones: new Set(used.map((s) => s.zone?.toLowerCase()).filter(Boolean)).size,
          byKind: [...byKind].map(([kind, v]) => ({ kind, ...v })),
          list: used.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            zone: s.zone,
            area: s.area * s.multiplier,
          })),
        },
        usedBy,
      });
    }
  }
  return rows;
}
