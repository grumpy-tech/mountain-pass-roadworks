// One shared pool of low-poly particles for every effect: dust, smoke, splashes, sawdust, leaves...
// Rules push `Fx` events onto game.fx; vehicles emit continuously (exhaust, dust) via the bus.
import { useFrame } from "@react-three/fiber";
import { createContext, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { Fx, FxKind } from "./shared";

export class FxBus {
  queue: Fx[] = [];
  /** Tree-fall requests: the forest scene animates these itself. */
  falls: Fx[] = [];
  push(e: Fx) { if (e.kind === "treefall") this.falls.push(e); else if (this.queue.length < 400) this.queue.push(e); }
  emit(kind: FxKind, x: number, y: number, z: number, n = 1) { this.push({ kind, x, y, z, n }); }
}
export const FxCtx = createContext<FxBus>(new FxBus());

const _v = new THREE.Vector3();
/** Emit from a point in a group's local space (exhaust pipe, blade, saw...). */
export function emitAt(bus: FxBus, group: RefObject<THREE.Object3D | null>, kind: FxKind, local: [number, number, number], n = 1) {
  if (!group.current) return;
  _v.set(local[0], local[1], local[2]);
  group.current.localToWorld(_v);
  bus.emit(kind, _v.x, _v.y, _v.z, n);
}

interface Cfg { colors: string[]; life: [number, number]; size: [number, number]; speed: number; up: number; grav: number; grow: number; drag: number }
const CFG: Record<Exclude<FxKind, "treefall">, Cfg> = {
  smoke: { colors: ["#9a9a9a", "#7e7e7e"], life: [0.8, 1.3], size: [0.14, 0.24], speed: 0.2, up: 1.4, grav: 0, grow: 2.2, drag: 0.6 },
  steam: { colors: ["#f2f2f2", "#dcdcdc"], life: [1, 1.6], size: [0.25, 0.4], speed: 0.2, up: 1.4, grav: 0, grow: 2.4, drag: 0.5 },
  dust: { colors: ["#c4a97f", "#b39870"], life: [0.6, 1.1], size: [0.22, 0.4], speed: 1.3, up: 1, grav: -0.3, grow: 1.8, drag: 2 },
  dirt: { colors: ["#6b4a2b", "#7a5533", "#5a3d24"], life: [0.5, 0.9], size: [0.14, 0.28], speed: 3, up: 4.2, grav: 13, grow: 0, drag: 0.4 },
  splash: { colors: ["#4a3524", "#5b4330"], life: [0.5, 0.9], size: [0.14, 0.26], speed: 3, up: 5, grav: 14, grow: 0, drag: 0.3 },
  sawdust: { colors: ["#ecd7a6", "#d9bf86"], life: [0.5, 0.9], size: [0.07, 0.13], speed: 2.6, up: 3, grav: 6, grow: 0, drag: 1 },
  leaves: { colors: ["#2f6b36", "#3f8140", "#285c30"], life: [1, 1.6], size: [0.14, 0.24], speed: 3.5, up: 3, grav: 3, grow: 0, drag: 0.8 },
  chips: { colors: ["#8a847c", "#6e6862"], life: [0.5, 0.9], size: [0.12, 0.24], speed: 4.5, up: 5, grav: 14, grow: 0, drag: 0.2 },
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const SOFT = new Set<FxKind>(["smoke", "steam", "dust"]); // drawn translucent so they read as clouds, not rocks

function makePool(max: number) {
  return {
    max, next: 0, pos: new Float32Array(max * 3), vel: new Float32Array(max * 3),
    life: new Float32Array(max), span: new Float32Array(max), size: new Float32Array(max),
    grow: new Float32Array(max), drag: new Float32Array(max), grav: new Float32Array(max),
  };
}
type Pool = ReturnType<typeof makePool>;

function spawn(pool: Pool, mesh: THREE.InstancedMesh, e: Fx, c: Cfg, col: THREE.Color) {
  for (let k = 0; k < (e.n ?? 6); k++) {
    const i = pool.next++ % pool.max, a = Math.random() * Math.PI * 2, sp = c.speed * rnd(0.3, 1);
    pool.pos.set([e.x + rnd(-0.25, 0.25), (e.y ?? 0) + 0.15, e.z + rnd(-0.25, 0.25)], i * 3);
    pool.vel.set([Math.cos(a) * sp, c.up * rnd(0.4, 1), Math.sin(a) * sp], i * 3);
    pool.span[i] = pool.life[i] = rnd(c.life[0], c.life[1]);
    pool.size[i] = rnd(c.size[0], c.size[1]); pool.grow[i] = c.grow; pool.drag[i] = c.drag; pool.grav[i] = c.grav;
    col.set(c.colors[Math.floor(Math.random() * c.colors.length)]);
    mesh.setColorAt(i, col);
  }
}

function update(pool: Pool, mesh: THREE.InstancedMesh, o: THREE.Object3D, dt: number) {
  const { pos, vel } = pool;
  for (let i = 0; i < pool.max; i++) {
    if (pool.life[i] > 0) {
      pool.life[i] -= dt;
      const p = i * 3, damp = Math.exp(-pool.drag[i] * dt);
      vel[p] *= damp; vel[p + 2] *= damp; vel[p + 1] = (vel[p + 1] - pool.grav[i] * dt) * (pool.grav[i] === 0 ? damp : 1);
      pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt;
      const f = Math.max(0, pool.life[i] / pool.span[i]);
      o.position.set(pos[p], pos[p + 1], pos[p + 2]);
      o.scale.setScalar(pool.size[i] * (1 + pool.grow[i] * (1 - f)) * Math.min(1, f * 2.5));
    } else o.scale.setScalar(0);
    o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function Particles({ bus }: { bus: FxBus }) {
  const hardMesh = useRef<THREE.InstancedMesh>(null!), softMesh = useRef<THREE.InstancedMesh>(null!);
  const hard = useMemo(() => makePool(500), []), soft = useMemo(() => makePool(600), []);
  const o = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    for (const e of bus.queue.splice(0)) {
      const c = CFG[e.kind as Exclude<FxKind, "treefall">];
      if (!c) continue;
      if (SOFT.has(e.kind)) spawn(soft, softMesh.current, e, c, col); else spawn(hard, hardMesh.current, e, c, col);
    }
    for (const [pool, mesh] of [[hard, hardMesh.current], [soft, softMesh.current]] as const) {
      update(pool, mesh, o, dt);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={hardMesh} args={[undefined, undefined, 500]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial flatShading roughness={1} />
      </instancedMesh>
      <instancedMesh ref={softMesh} args={[undefined, undefined, 600]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={1} transparent opacity={0.42} depthWrite={false} />
      </instancedMesh>
    </>
  );
}
