/**
 * Positions of the flow network diagram (L11). Each floor level is a plan view
 * (north up) placed side by side, so zones of different floors do not overlap.
 * Outdoor nodes go around the whole set, in the direction their surfaces face;
 * roof nodes go above it and floor nodes below it. Screen y grows downwards.
 */
import type { NetworkNode } from '../../core/airflow/network';

export interface NetworkLayout {
  positions: Map<string, [number, number]>;
  levels: { label: string; x: number; y: number }[];
}

/** Size of the largest plan, in diagram units. */
const PLAN = 300;
const LEVEL_GAP = 140;
const MIN_ZONE_GAP = 60;
const MIN_OUTDOOR_GAP = 80;
const RING = 110;

/** Pushes points apart until they are at least `gap` from each other. */
function separate(points: [number, number][], gap: number) {
  for (let iteration = 0; iteration < 40; iteration++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i] as [number, number];
        const b = points[j] as [number, number];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        if (d < 1e-6) {
          // Same spot: split them along a direction that depends on the pair.
          const angle = (i * 7 + j * 3) * 0.9;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const push = (gap - d) / 2 / d;
        a[0] -= dx * push;
        a[1] -= dy * push;
        b[0] += dx * push;
        b[1] += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

export function networkLayout(nodes: NetworkNode[]): NetworkLayout {
  const positions = new Map<string, [number, number]>();
  const levelLabels: NetworkLayout['levels'] = [];
  const zones = nodes.filter((n) => n.kind === 'zone');
  const placed = zones.filter((n) => n.x !== undefined && n.y !== undefined);
  const unplaced = zones.filter((n) => n.x === undefined || n.y === undefined);

  let width = 0;
  let height = 0;
  if (placed.length > 0) {
    const xs = placed.map((n) => n.x as number);
    const ys = placed.map((n) => n.y as number);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const k = PLAN / Math.max(maxX - minX, maxY - minY, 1);
    const planW = (maxX - minX) * k;
    height = (maxY - minY) * k;
    const levels = [...new Set(placed.map((n) => n.level ?? 0))].sort((a, b) => a - b);
    levels.forEach((level, i) => {
      const offset = i * (planW + LEVEL_GAP);
      const group = placed.filter((n) => (n.level ?? 0) === level);
      const points = group.map(
        (n) =>
          [offset + ((n.x as number) - minX) * k, (maxY - (n.y as number)) * k] as [number, number],
      );
      separate(points, MIN_ZONE_GAP);
      group.forEach((n, j) => {
        positions.set(n.key, points[j] as [number, number]);
      });
      if (levels.length > 1) {
        const top = Math.min(...points.map((p) => p[1]));
        levelLabels.push({ label: `Level ${level.toFixed(1)} m`, x: offset, y: top - 45 });
      }
    });
    width = levels.length * planW + (levels.length - 1) * LEVEL_GAP;
  }

  // Zones without geometry: a circle next to the plans (or alone).
  if (unplaced.length > 0) {
    const r = Math.max(80, (unplaced.length * MIN_ZONE_GAP) / (2 * Math.PI));
    const cx = placed.length > 0 ? width + LEVEL_GAP + r : r;
    const cy = placed.length > 0 ? height / 2 : r;
    unplaced.forEach((n, i) => {
      const a = (2 * Math.PI * i) / unplaced.length - Math.PI / 2;
      positions.set(n.key, [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    });
    width = cx + r;
    height = Math.max(height, cy + r);
  }

  // Outdoor nodes around everything.
  const outdoor = nodes.filter((n) => n.kind === 'outdoor');
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2 + RING;
  const ry = height / 2 + RING;
  const roofs = outdoor.filter((n) => n.facing === 'Roof');
  const floors = outdoor.filter((n) => n.facing === 'Floor');
  const sides = outdoor.filter((n) => n.facing !== 'Roof' && n.facing !== 'Floor');
  const points: [number, number][] = [];
  const order: NetworkNode[] = [];
  const row = (list: NetworkNode[], y: number) => {
    list.forEach((n, i) => {
      points.push([cx + (i - (list.length - 1) / 2) * MIN_OUTDOOR_GAP * 1.5, y]);
      order.push(n);
    });
  };
  row(roofs, cy - ry - RING * 0.8);
  row(floors, cy + ry + RING * 0.8);
  for (const n of sides) {
    const a = ((n.azimuth ?? 0) * Math.PI) / 180;
    points.push([cx + Math.sin(a) * rx, cy - Math.cos(a) * ry]);
    order.push(n);
  }
  separate(points, MIN_OUTDOOR_GAP);
  order.forEach((n, i) => {
    positions.set(n.key, points[i] as [number, number]);
  });

  return { positions, levels: levelLabels };
}
