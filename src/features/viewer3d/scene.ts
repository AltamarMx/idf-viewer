/**
 * three.js scene of the building (C1, C3, C5). Surfaces are merged into two
 * meshes (opaque and glazed) so that thousands of surfaces stay fast; colors and
 * visibility are updated in place. Rendering happens only when something changes.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GeometryView, SurfaceView } from '../../core/session';
import { isGlazed } from './colors';
import type { Vec3 } from './explode';

export type ViewName = 'iso' | 'top' | 'north' | 'south' | 'east' | 'west';

const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  iso: [-1, -1.4, 1.1],
  top: [0, -0.0001, 1],
  north: [0, 1, 0.12],
  south: [0, -1, 0.12],
  east: [1, 0, 0.12],
  west: [-1, 0, 0.12],
};

/** Windows sit slightly in front of their wall to avoid flickering. */
const GLASS_OFFSET = 0.02;

interface Slot {
  group: 0 | 1;
  vertexStart: number;
  vertexCount: number;
  triangles: Uint32Array;
  edges: Uint32Array;
  /** Positions as built, before the exploded view moves them. */
  base: Float32Array;
}

interface Group {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  colors: THREE.BufferAttribute;
  /** Surface index of each drawn triangle, for picking. */
  triangleOwner: Int32Array;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly groups: Group[] = [];
  private readonly slots: Slot[] = [];
  private readonly radius: number;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private readonly raycaster = new THREE.Raycaster();
  onRender?: (northAngle: number) => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly geometry: GeometryView,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const [sx, sy, sz] = geometry.size;
    this.radius = Math.max(1, Math.hypot(sx, sy, sz) / 2);
    this.camera = new THREE.PerspectiveCamera(40, 1, this.radius / 500, this.radius * 200);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.camera);

    // Bright ambient light so that colors stay close to the legend.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd0d4d8, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(0.3, 0.5, 1);
    this.camera.add(light);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());

    this.buildMeshes(geometry.surfaces);
    this.addPoints();
    this.addHelpers();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView('iso');
  }

  private buildMeshes(surfaces: SurfaceView[]) {
    const buckets: SurfaceView[][] = [[], []];
    const order: number[][] = [[], []];
    surfaces.forEach((s, i) => {
      const g = isGlazed(s) ? 1 : 0;
      buckets[g]?.push(s);
      order[g]?.push(i);
    });

    for (const g of [0, 1] as const) {
      const list = buckets[g] as SurfaceView[];
      const vertexCount = list.reduce((n, s) => n + s.positions.length / 3, 0);
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);
      const colors = new Float32Array(vertexCount * 3).fill(1);
      let offset = 0;
      list.forEach((s, k) => {
        const n = s.positions.length / 3;
        const shift = g === 1 ? GLASS_OFFSET : 0;
        for (let v = 0; v < n; v++) {
          for (let c = 0; c < 3; c++) {
            positions[(offset + v) * 3 + c] =
              (s.positions[v * 3 + c] as number) + shift * (s.normal[c] as number);
            normals[(offset + v) * 3 + c] = s.normal[c] as number;
          }
        }
        const edges = new Uint32Array(n * 2);
        for (let v = 0; v < n; v++) {
          edges[v * 2] = offset + v;
          edges[v * 2 + 1] = offset + ((v + 1) % n);
        }
        this.slots[order[g]?.[k] as number] = {
          group: g,
          vertexStart: offset,
          vertexCount: n,
          triangles: s.triangles.map((t) => t + offset),
          edges,
          base: positions.slice(offset * 3, (offset + n) * 3),
        };
        offset += n;
      });

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      const colorAttr = new THREE.BufferAttribute(colors, 3);
      geometry.setAttribute('color', colorAttr);
      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: g === 1,
        opacity: g === 1 ? 0.55 : 1,
        depthWrite: g === 0,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = g;

      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position', geometry.getAttribute('position'));
      const edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({ color: 0x3b4450, transparent: true, opacity: 0.55 }),
      );
      this.scene.add(mesh, edges);
      this.groups.push({ mesh, edges, colors: colorAttr, triangleOwner: new Int32Array(0) });
    }
    this.setVisible(surfaces.map(() => true));
  }

  private addHelpers() {
    const size = Math.max(...this.geometry.size, 1);
    const [cx, cy, cz] = this.geometry.center;
    const minZ = -this.geometry.size[2] / 2;
    // Axes at the world origin of the file (x red, y green, z blue).
    const axes = new THREE.AxesHelper(size * 0.15);
    axes.position.set(-cx, -cy, -cz);
    // A light grid under the building.
    const grid = new THREE.GridHelper(Math.ceil(size * 2), 20, 0x9aa3ab, 0xc5cbd1);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = minZ - 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(axes, grid);
  }

  setTheme(dark: boolean) {
    this.scene.background = new THREE.Color(dark ? '#151a20' : '#eef1f4');
    for (const g of this.groups) {
      (g.edges.material as THREE.LineBasicMaterial).color.set(dark ? 0xc8d0d8 : 0x3b4450);
    }
    this.requestRender();
  }

  /** One CSS color per surface; `lighter` surfaces are mixed with white (glazing). */
  setColors(colors: string[], lighter?: boolean[]) {
    const color = new THREE.Color();
    const white = new THREE.Color(1, 1, 1);
    this.slots.forEach((slot, i) => {
      color.set(colors[i] ?? '#ffffff');
      if (lighter?.[i]) color.lerp(white, 0.45);
      const attr = (this.groups[slot.group] as Group).colors;
      for (let v = 0; v < slot.vertexCount; v++) {
        attr.setXYZ(slot.vertexStart + v, color.r, color.g, color.b);
      }
    });
    for (const g of this.groups) g.colors.needsUpdate = true;
    this.requestRender();
  }

  setVisible(visible: boolean[]) {
    this.groups.forEach((group, g) => {
      const triangles: number[] = [];
      const owners: number[] = [];
      const edges: number[] = [];
      this.slots.forEach((slot, i) => {
        if (slot.group !== g || !visible[i]) return;
        for (let t = 0; t < slot.triangles.length; t += 3) {
          triangles.push(
            slot.triangles[t] as number,
            slot.triangles[t + 1] as number,
            slot.triangles[t + 2] as number,
          );
          owners.push(i);
        }
        for (const e of slot.edges) edges.push(e);
      });
      group.mesh.geometry.setIndex(triangles);
      group.mesh.geometry.computeBoundingSphere();
      group.edges.geometry.setIndex(edges);
      group.triangleOwner = Int32Array.from(owners);
    });
    this.requestRender();
  }

  /** Opacity of the opaque surfaces (C7); 1 draws them solid. */
  setOpacity(opacity: number) {
    const group = this.groups[0];
    if (!group) return;
    const material = group.mesh.material as THREE.MeshLambertMaterial;
    material.opacity = opacity;
    material.transparent = opacity < 1;
    material.depthWrite = opacity >= 1;
    material.needsUpdate = true;
    this.requestRender();
  }

  /** Horizontal cut (C7): hides everything above `z` (scene coordinates), or nothing when null. */
  setCut(z: number | null) {
    this.renderer.localClippingEnabled = z !== null;
    const planes = z === null ? [] : [new THREE.Plane(new THREE.Vector3(0, 0, -1), z)];
    this.cutPlanes = planes;
    for (const g of this.groups) {
      (g.mesh.material as THREE.Material).clippingPlanes = planes;
      (g.edges.material as THREE.Material).clippingPlanes = planes;
    }
    if (this.points) (this.points.material as THREE.Material).clippingPlanes = planes;
    if (this.pairs) (this.pairs.material as THREE.Material).clippingPlanes = planes;
    this.requestRender();
  }

  /** Exploded view (C7): moves each surface by `offsets[i]` and each point by `pointOffsets[i]`. */
  setOffsets(offsets: Vec3[], pointOffsets: Vec3[]) {
    this.groups.forEach((group, g) => {
      const attr = group.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      this.slots.forEach((slot, i) => {
        if (slot.group !== g) return;
        const [dx, dy, dz] = offsets[i] ?? [0, 0, 0];
        for (let v = 0; v < slot.vertexCount; v++) {
          const at = (slot.vertexStart + v) * 3;
          array[at] = (slot.base[v * 3] as number) + dx;
          array[at + 1] = (slot.base[v * 3 + 1] as number) + dy;
          array[at + 2] = (slot.base[v * 3 + 2] as number) + dz;
        }
      });
      attr.needsUpdate = true;
      group.mesh.geometry.computeBoundingSphere();
    });
    if (this.points) {
      const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.geometry.daylightingPoints.forEach((p, i) => {
        const [dx, dy, dz] = pointOffsets[i] ?? [0, 0, 0];
        attr.setXYZ(i, p.position[0] + dx, p.position[1] + dy, p.position[2] + dz);
      });
      attr.needsUpdate = true;
      this.points.geometry.computeBoundingSphere();
    }
    this.refit();
    this.requestRender();
  }

  private pairs?: THREE.LineSegments;
  private cutPlanes: THREE.Plane[] = [];

  /** Lines between interzone pairs, each with its color; empty removes them. */
  setPairLines(segments: { from: Vec3; to: Vec3; color: string }[]) {
    if (this.pairs) {
      this.scene.remove(this.pairs);
      this.pairs.geometry.dispose();
      (this.pairs.material as THREE.Material).dispose();
      this.pairs = undefined;
    }
    if (segments.length > 0) {
      const positions = new Float32Array(segments.length * 6);
      const colors = new Float32Array(segments.length * 6);
      const color = new THREE.Color();
      segments.forEach((s, i) => {
        positions.set([...s.from, ...s.to], i * 6);
        color.set(s.color);
        colors.set([color.r, color.g, color.b, color.r, color.g, color.b], i * 6);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
      material.clippingPlanes = this.cutPlanes;
      this.pairs = new THREE.LineSegments(geometry, material);
      this.pairs.renderOrder = 4;
      this.scene.add(this.pairs);
    }
    this.requestRender();
  }

  /** Daylighting reference points (C9). */
  setPointsVisible(visible: boolean[]) {
    if (!this.points) return;
    const index: number[] = [];
    visible.forEach((v, i) => {
      if (v) index.push(i);
    });
    this.points.geometry.setIndex(index);
    this.requestRender();
  }

  private points?: THREE.Points;

  private addPoints() {
    const list = this.geometry.daylightingPoints;
    if (list.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(Float32Array.from(list.flatMap((p) => p.position)), 3),
    );
    const material = new THREE.PointsMaterial({
      color: 0xffb300,
      size: 9,
      sizeAttenuation: false,
      depthTest: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = 3;
    this.scene.add(this.points);
  }

  /** Index of the surface under the pointer, or null. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.groups.map((g) => g.mesh),
      false,
    );
    const hit = hits[0];
    if (!hit || hit.faceIndex == null) return null;
    const group = this.groups.find((g) => g.mesh === hit.object);
    const owner = group?.triangleOwner[hit.faceIndex];
    return owner === undefined ? null : owner;
  }

  setView(name: ViewName) {
    this.frame3d(new THREE.Vector3(...VIEW_DIRECTIONS[name]).normalize());
  }

  /** Center and radius of what is drawn; they grow when the parts are pulled apart. */
  private bounds = { center: new THREE.Vector3(), radius: 0 };

  /** Looks at the model from `dir` (from the target to the camera) so that all of it fits. */
  private frame3d(dir: THREE.Vector3) {
    const radius = this.bounds.radius || this.radius;
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.05;
    this.controls.target.copy(this.bounds.center);
    this.camera.position.copy(this.bounds.center).addScaledVector(dir, distance);
    this.controls.update();
    this.requestRender();
  }

  /** After moving the parts: refit the camera, keeping the direction it looks from. */
  private refit() {
    const box = new THREE.Box3();
    for (const g of this.groups) {
      g.mesh.geometry.computeBoundingBox();
      if (g.mesh.geometry.boundingBox) box.union(g.mesh.geometry.boundingBox);
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const same =
      sphere.center.distanceTo(this.bounds.center) < 1e-6 &&
      Math.abs(sphere.radius - this.bounds.radius) < 1e-6;
    if (same) return;
    this.bounds = { center: sphere.center, radius: Math.max(sphere.radius, 1) };
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.frame3d(dir);
  }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
      if (this.onRender) {
        // Screen direction of true north (+y in EnergyPlus world coordinates).
        const a = new THREE.Vector3(0, 0, 0).project(this.camera);
        const b = new THREE.Vector3(0, this.radius * 0.1, 0).project(this.camera);
        this.onRender(Math.atan2(b.x - a.x, b.y - a.y));
      }
    });
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
