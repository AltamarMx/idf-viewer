/**
 * three.js scene of the building (C1, C3, C5). Surfaces are merged into two
 * meshes (opaque and glazed) so that thousands of surfaces stay fast; colors and
 * visibility are updated in place. Rendering happens only when something changes.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GeometryView, SurfaceView } from '../../core/session';
import { isGlazed } from './colors';

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
    const dir = new THREE.Vector3(...VIEW_DIRECTIONS[name]).normalize();
    const distance = (this.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.05;
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(distance));
    this.controls.update();
    this.requestRender();
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
