// Rendering for the urban construction-site level. Reads state from game/site.ts + game/crane.ts; owns no rules.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { SLAB_T, PALLETS, foundationDone, hookedPallet, structureTop, supportY, inRect, type Pallet, type Site } from "./site";
import type { World } from "./grid";

type V3 = { x: number; y: number; z: number };
const mat = (c: string, extra: Record<string, unknown> = {}) => <meshStandardMaterial color={c} flatShading {...extra} />;
const YELLOW = "#e8b322";
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** A thin cylinder stretched between two points that are re-read every frame (cables, slings, tie rods). */
function Rod({ a, b, r = 0.05, color = "#2a2a2a", show }: { a: () => V3; b: () => V3; r?: number; color?: string; show?: () => boolean }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    const m = ref.current;
    if (show && !show()) { m.visible = false; return; }
    const p = a(), q = b();
    _d.set(q.x - p.x, q.y - p.y, q.z - p.z);
    const len = _d.length();
    m.visible = len > 1e-4;
    if (!m.visible) return;
    m.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
    m.scale.set(r, len, r);
    m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
  });
  return <mesh ref={ref}><cylinderGeometry args={[1, 1, 1, 5]} />{mat(color)}</mesh>;
}

const Box = ({ p, s, c, cast = true }: { p: [number, number, number]; s: [number, number, number]; c: string; cast?: boolean }) => (
  <mesh position={p} castShadow={cast} receiveShadow><boxGeometry args={s} />{mat(c)}</mesh>
);

// ---------- static scenery ----------

function Windows({ x, z0, z1, h, dir, c }: { x: number; z0: number; z1: number; h: number; dir: 1 | -1; c: string }) {
  // a grid of dark panes on a building's east/west face (dir -1 = west face of the east building)
  const cells = useMemo(() => {
    const out: [number, number][] = [];
    for (let y = 3; y < h - 1.5; y += 3.4) for (let z = z0 + 3; z < z1 - 2; z += 4) out.push([y, z]);
    return out;
  }, [z0, z1, h]);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const o = new THREE.Object3D();
    cells.forEach(([y, z], i) => { o.position.set(x + dir * 0.05, y, z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
  };
  return (
    <instancedMesh ref={setup} args={[undefined, undefined, Math.max(1, cells.length)]}>
      <boxGeometry args={[0.1, 1.8, 2.2]} /><meshStandardMaterial color={c} roughness={0.2} metalness={0.3} />
    </instancedMesh>
  );
}

function SouthWindows({ x0, x1, z, h, c }: { x0: number; x1: number; z: number; h: number; c: string }) {
  const cells = useMemo(() => {
    const out: [number, number][] = [];
    for (let y = 3; y < h - 1.5; y += 3.4) for (let x = x0 + 4; x < x1 - 3; x += 5) out.push([x, y]);
    return out;
  }, [x0, x1, h]);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const o = new THREE.Object3D();
    cells.forEach(([x, y], i) => { o.position.set(x, y, z + 0.05); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
  };
  return (
    <instancedMesh ref={setup} args={[undefined, undefined, Math.max(1, cells.length)]}>
      <boxGeometry args={[2.4, 1.8, 0.1]} /><meshStandardMaterial color={c} roughness={0.2} metalness={0.3} />
    </instancedMesh>
  );
}

const FAR_BLOCKS: [number, number, number, number, number, string][] = [
  [-62, 54, 22, 22, 26, "#a89c8a"], [-30, 52, 26, 20, 16, "#8f98a3"], [4, 56, 24, 24, 34, "#9aa39b"], [38, 52, 26, 20, 20, "#b1a48d"],
  [68, 56, 20, 24, 28, "#8c93a0"], [-8, 74, 60, 14, 22, "#a0a0a0"],
];

export function UrbanScenery({ site }: { site: Site }) {
  const cfg = site.cfg;
  const fp = cfg.footprint, dz = cfg.deliveryZone, sz = cfg.spoilZone;
  const dashes = useMemo(() => Array.from({ length: 27 }, (_, i) => -78 + i * 6), []);
  const poles = [-52, -22, 22, 52];
  const [bw, be, bn] = cfg.buildings;
  return (
    <>
      {/* street + pavement */}
      <mesh position={[0, 0.03, 31]} receiveShadow><boxGeometry args={[160, 0.06, 14]} />{mat("#34363a", { roughness: 0.95 })}</mesh>
      <mesh position={[0, 0.08, 22.15]} receiveShadow><boxGeometry args={[160, 0.16, 3.7]} />{mat("#b9b6ae")}</mesh>
      <mesh position={[0, 0.07, 24.05]}><boxGeometry args={[160, 0.14, 0.2]} />{mat("#cfccc4")}</mesh>
      {dashes.map((x) => <mesh key={x} position={[x, 0.07, 31]}><boxGeometry args={[3, 0.02, 0.2]} />{mat("#e8e2c0")}</mesh>)}

      {/* neighbours */}
      <Box p={[(bw.x0 + bw.x1) / 2, bw.h / 2, (bw.z0 + bw.z1) / 2]} s={[bw.x1 - bw.x0, bw.h, bw.z1 - bw.z0]} c="#a89c8a" />
      <Windows x={bw.x1} z0={bw.z0} z1={bw.z1} h={bw.h} dir={1} c="#42586b" />
      <Box p={[(be.x0 + be.x1) / 2, be.h / 2, (be.z0 + be.z1) / 2]} s={[be.x1 - be.x0, be.h, be.z1 - be.z0]} c="#8f98a3" />
      <Windows x={be.x0} z0={be.z0} z1={be.z1} h={be.h} dir={-1} c="#42586b" />
      <Box p={[(bn.x0 + bn.x1) / 2, bn.h / 2, (bn.z0 + bn.z1) / 2]} s={[bn.x1 - bn.x0, bn.h, bn.z1 - bn.z0]} c="#9a948a" />
      <SouthWindows x0={-36} x1={36} z={bn.z1} h={bn.h} c="#42586b" />
      {FAR_BLOCKS.map(([x, z, w, d, h, c], i) => <Box key={i} p={[x, h / 2, z]} s={[w, h, d]} c={c} />)}

      {/* site fence + gates */}
      {cfg.fences.map((f, i) => <Box key={i} p={[(f.x0 + f.x1) / 2, 1.2, (f.z0 + f.z1) / 2]} s={[f.x1 - f.x0, 2.4, f.z1 - f.z0]} c="#3d6f9e" />)}
      {[-18, -6, 4, 16].map((x) => <Box key={x} p={[x, 1.4, 20]} s={[0.5, 2.8, 0.7]} c="#f2f2f0" />)}

      {/* pads */}
      <mesh position={[(dz.x0 + dz.x1) / 2, 0.05, (dz.z0 + dz.z1) / 2]} receiveShadow><boxGeometry args={[dz.x1 - dz.x0, 0.1, dz.z1 - dz.z0]} />{mat("#e8c53a")}</mesh>
      <mesh position={[(dz.x0 + dz.x1) / 2, 0.08, (dz.z0 + dz.z1) / 2]}><boxGeometry args={[dz.x1 - dz.x0 - 0.7, 0.1, dz.z1 - dz.z0 - 0.7]} />{mat("#3a3a3c")}</mesh>
      {cfg.zoneSlots.map((s, i) => <mesh key={i} position={[s.x, 0.14, s.z]}><boxGeometry args={[4.4, 0.04, 2.6]} />{mat("#5a5a5e")}</mesh>)}
      <mesh position={[(sz.x0 + sz.x1) / 2, 0.05, (sz.z0 + sz.z1) / 2]} receiveShadow><boxGeometry args={[sz.x1 - sz.x0, 0.1, sz.z1 - sz.z0]} />{mat("#d9822b")}</mesh>
      <mesh position={[(sz.x0 + sz.x1) / 2, 0.08, (sz.z0 + sz.z1) / 2]}><boxGeometry args={[sz.x1 - sz.x0 - 0.7, 0.1, sz.z1 - sz.z0 - 0.7]} />{mat("#4a4038")}</mesh>
      <Box p={[sz.x0 + 0.4, 1.2, sz.z0 + 0.4]} s={[0.15, 2.4, 0.15]} c="#ddd" />
      <Box p={[sz.x0 + 0.4, 2.6, sz.z0 + 0.4]} s={[1.6, 0.9, 0.12]} c="#d9822b" />

      {/* pit outline on the ground */}
      {([[fp.x0 - 0.25, (fp.z0 + fp.z1) / 2, 0.3, fp.z1 - fp.z0 + 0.8], [fp.x1 + 0.25, (fp.z0 + fp.z1) / 2, 0.3, fp.z1 - fp.z0 + 0.8], [(fp.x0 + fp.x1) / 2, fp.z0 - 0.25, fp.x1 - fp.x0 + 0.8, 0.3], [(fp.x0 + fp.x1) / 2, fp.z1 + 0.25, fp.x1 - fp.x0 + 0.8, 0.3]] as const).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.1, z]}><boxGeometry args={[w, 0.06, d]} />{mat("#f2c230")}</mesh>
      ))}

      {/* power lines */}
      {poles.map((x) => (
        <group key={x} position={[x, 0, cfg.powerLines.z]}>
          <Box p={[0, 7, 0]} s={[0.4, 14, 0.4]} c="#6b5a45" />
          <Box p={[0, 12, 0]} s={[0.3, 0.3, 2.8]} c="#5b4a37" />
        </group>
      ))}
      {cfg.powerLines.ys.map((y) => (
        <mesh key={y} position={[(cfg.powerLines.x0 + cfg.powerLines.x1) / 2, y, cfg.powerLines.z]}><boxGeometry args={[cfg.powerLines.x1 - cfg.powerLines.x0, 0.07, 0.07]} />{mat("#111")}</mesh>
      ))}
    </>
  );
}

// ---------- life on the street (decoration only) ----------

export function StreetLife() {
  const peds = useRef<(THREE.Group | null)[]>([]);
  const cars = useRef<(THREE.Group | null)[]>([]);
  const P = useMemo(() => [
    { z: 21.6, v: 1.3, o: 10, c: "#c0392b" }, { z: 22.9, v: -1.1, o: 70, c: "#2e6f95" }, { z: 21.9, v: 1.6, o: 120, c: "#7d5ba6" },
    { z: 23.2, v: -1.4, o: 40, c: "#3f8f5a" }, { z: 22.4, v: 1.0, o: 95, c: "#d68c2a" },
  ], []);
  const C = useMemo(() => [{ v: -9, o: 0, c: "#c8392b" }, { v: -7, o: 70, c: "#2d6cdf" }, { v: -8, o: 130, c: "#e8e8e8" }], []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    P.forEach((p, i) => {
      const g = peds.current[i]; if (!g) return;
      g.position.set(((((t * p.v + p.o) % 150) + 150) % 150) - 75, 0.16 + Math.abs(Math.sin(t * 7 + i)) * 0.06, p.z);
      g.rotation.y = p.v > 0 ? Math.PI / 2 : -Math.PI / 2;
    });
    C.forEach((c, i) => {
      const g = cars.current[i]; if (!g) return;
      g.position.set(((((t * c.v + c.o) % 180) + 180) % 180) - 90, 0.1, 34.5);
      g.rotation.y = -Math.PI / 2;
    });
  });
  return (
    <>
      {P.map((p, i) => (
        <group key={i} ref={(g) => { peds.current[i] = g; }}>
          <mesh position={[0, 0.7, 0]} castShadow><cylinderGeometry args={[0.22, 0.28, 1.1, 6]} />{mat(p.c)}</mesh>
          <mesh position={[0, 1.5, 0]} castShadow><icosahedronGeometry args={[0.24, 0]} />{mat("#e0b48f")}</mesh>
        </group>
      ))}
      {C.map((c, i) => (
        <group key={i} ref={(g) => { cars.current[i] = g; }}>
          <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[1.8, 0.7, 4]} />{mat(c.c)}</mesh>
          <mesh position={[0, 1.2, -0.2]} castShadow><boxGeometry args={[1.5, 0.6, 2.2]} />{mat("#9fc7d8")}</mesh>
        </group>
      ))}
    </>
  );
}

// ---------- crane ----------

/** A see-through lattice boom along local +z from z0 to z1: three chords and instanced posts, so the jib never hides the lot from above. */
function Truss({ z0, z1, color }: { z0: number; z1: number; color: string }) {
  const len = z1 - z0, mid = (z0 + z1) / 2;
  const posts = useMemo(() => Array.from({ length: Math.floor(len / 2.2) + 1 }, (_, i) => z0 + i * 2.2), [z0, len]);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const o = new THREE.Object3D();
    posts.forEach((z, i) => {
      for (const [j, x] of [-0.5, 0.5].entries()) { o.position.set(x, 0.55, z); o.updateMatrix(); m.setMatrixAt(i * 2 + j, o.matrix); }
    });
    m.instanceMatrix.needsUpdate = true;
  };
  return (
    <>
      <Box p={[-0.5, 0, mid]} s={[0.16, 0.16, len]} c={color} />
      <Box p={[0.5, 0, mid]} s={[0.16, 0.16, len]} c={color} />
      <Box p={[0, 1.1, mid]} s={[0.18, 0.18, len]} c={color} />
      <instancedMesh ref={setup} args={[undefined, undefined, posts.length * 2]} castShadow>
        <boxGeometry args={[0.1, 1.1, 0.1]} />{mat(color)}
      </instancedMesh>
    </>
  );
}

export function CraneMesh({ site, hideCab }: { site: Site; hideCab: () => boolean }) {
  const c = site.crane, cfg = c.cfg;
  const slew = useRef<THREE.Group>(null!), trolley = useRef<THREE.Group>(null!), hook = useRef<THREE.Group>(null!), cab = useRef<THREE.Group>(null!);
  const jibLen = cfg.trolleyMax + 4;
  const rings = useMemo(() => Array.from({ length: Math.floor(cfg.jibY / 3.5) }, (_, i) => 2 + i * 3.5), [cfg.jibY]);
  useFrame(() => {
    slew.current.rotation.y = c.slew;
    trolley.current.position.z = c.trolley;
    hook.current.position.set(c.hook.x, c.hook.y, c.hook.z);
    cab.current.visible = !hideCab(); // the operator's eye is inside the cab in cab view
  });
  const load = () => hookedPallet(site);
  const corner = (sx: number, sz: number) => () => {
    const l = load();
    if (!l) return c.hook;
    const d = PALLETS[l.kind];
    return { x: l.x + sx * d.w * 0.4, y: l.y + d.h, z: l.z + sz * d.d * 0.4 };
  };
  return (
    <>
      <group position={[cfg.x, 0, cfg.z]}>
        <Box p={[0, 0.5, 0]} s={[4.2, 1, 4.2]} c="#7d7d80" />
        <Box p={[0, cfg.jibY / 2, 0]} s={[1.5, cfg.jibY, 1.5]} c={YELLOW} />
        {rings.map((y) => <Box key={y} p={[0, y, 0]} s={[1.9, 0.25, 1.9]} c="#c99a1a" cast={false} />)}
        <group ref={slew} position={[0, cfg.jibY, 0]}>
          <group ref={cab}>
            <Box p={[0, 0.3, 0]} s={[2.2, 0.7, 2.2]} c="#c99a1a" />
            <Box p={[1.5, 0.1, 0.5]} s={[1.3, 1.4, 1.4]} c="#f2f2f0" />
            <mesh position={[1.5, 0.3, 1.22]}><boxGeometry args={[1.0, 0.6, 0.05]} /><meshStandardMaterial color="#9fc7d8" metalness={0.3} roughness={0.2} /></mesh>
          </group>
          {/* jib, counter-jib, counterweights, apex */}
          <Truss z0={-1} z1={jibLen - 1} color={YELLOW} />
          <Truss z0={-13.5} z1={-1} color={YELLOW} />
          <Box p={[0, 0.7, -12.2]} s={[2.2, 1.6, 2.4]} c="#58585c" />
          <Box p={[0, 0.7, -9.6]} s={[2.2, 1.6, 2.4]} c="#58585c" />
          <mesh position={[0, 3.6, 0]} castShadow><coneGeometry args={[0.9, 5.5, 4]} />{mat(YELLOW)}</mesh>
          <Rod a={() => ({ x: 0, y: 6.2, z: 0 })} b={() => ({ x: 0, y: 1.6, z: cfg.trolleyMax + 2.5 })} r={0.06} color="#444" />
          <Rod a={() => ({ x: 0, y: 6.2, z: 0 })} b={() => ({ x: 0, y: 1.4, z: -13 })} r={0.06} color="#444" />
          <group ref={trolley} position={[0, 0, 12]}>
            <Box p={[0, 0.05, 0]} s={[1.3, 0.6, 1.6]} c="#2b2b2e" />
          </group>
        </group>
      </group>
      {/* cable, hook block and slings live in world space: they swing independently of the jib */}
      <Rod a={() => c.pivot} b={() => c.hook} r={0.05} color="#1c1c1c" />
      <group ref={hook}>
        <Box p={[0, 0.35, 0]} s={[0.7, 0.7, 0.7]} c="#2b2b2e" />
        <Box p={[0, 0.8, 0]} s={[0.35, 0.3, 0.35]} c="#d63b2a" />
      </group>
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
        <Rod key={i} a={() => c.hook} b={corner(sx, sz)} r={0.035} color="#111" show={() => !!load()} />
      ))}
    </>
  );
}

// ---------- building under construction ----------

const STEEL = "#b5482b";

function FloorMesh({ site, k }: { site: Site; k: number }) {
  const { footprint: fp, floorH: H } = site.cfg;
  const y0 = -site.cfg.pitDepth + (k - 1) * H;
  const frame = useRef<THREE.Group>(null!), slab = useRef<THREE.Mesh>(null!), glass = useRef<THREE.Group>(null!);
  const slabMat = useRef<THREE.MeshStandardMaterial>(null!);
  const W = fp.x1 - fp.x0, D = fp.z1 - fp.z0, cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  const h = H - SLAB_T;
  const cols = useMemo(() => {
    const out: [number, number][] = [];
    for (const x of [fp.x0 + 0.4, cx, fp.x1 - 0.4]) for (const z of [fp.z0 + 0.4, fp.z1 - 0.4]) out.push([x, z]);
    return out;
  }, [fp, cx]);
  const WET = useMemo(() => new THREE.Color("#5f5f5c"), []), DRY = useMemo(() => new THREE.Color("#a6a6a2"), []);
  useFrame(() => {
    const done = site.floorsDone >= k;
    frame.current.visible = done || (site.floorsDone === k - 1 && site.frameUp);
    slab.current.visible = done;
    glass.current.visible = done;
    if (done) {
      const cure = site.cure && site.cure.floor === k ? site.cure.t : 1;
      slab.current.scale.y = 0.2 + 0.8 * Math.min(1, cure * 2);
      slab.current.position.y = y0 + H - SLAB_T + (SLAB_T * slab.current.scale.y) / 2;
      slabMat.current.color.copy(WET).lerp(DRY, cure);
    }
  });
  return (
    <>
      <group ref={frame}>
        {cols.map(([x, z], i) => <Box key={i} p={[x, y0 + h / 2, z]} s={[0.5, h, 0.5]} c={STEEL} />)}
        {[fp.z0 + 0.4, fp.z1 - 0.4].map((z) => <Box key={z} p={[cx, y0 + h - 0.2, z]} s={[W, 0.4, 0.35]} c={STEEL} />)}
        {[fp.x0 + 0.4, cx, fp.x1 - 0.4].map((x) => <Box key={x} p={[x, y0 + h - 0.45, cz]} s={[0.35, 0.35, D]} c={STEEL} />)}
        {[0.33, 0.66].map((f) => <Box key={f} p={[cx, y0 + h * f, fp.z1 - 0.4]} s={[W * 0.9, 0.14, 0.14]} c="#8f3a22" cast={false} />)}
      </group>
      <mesh ref={slab} position={[cx, y0 + H - SLAB_T / 2, cz]} castShadow receiveShadow>
        <boxGeometry args={[W + 0.2, SLAB_T, D + 0.2]} /><meshStandardMaterial ref={slabMat} color="#a6a6a2" flatShading />
      </mesh>
      <group ref={glass}>
        {([[cx, fp.z1, W, 0.1], [cx, fp.z0, W, 0.1], [fp.x0, cz, 0.1, D], [fp.x1, cz, 0.1, D]] as const).map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, y0 + h / 2, z]}><boxGeometry args={[w, h - 0.2, d]} /><meshStandardMaterial color="#7fb7d6" transparent opacity={0.45} metalness={0.4} roughness={0.15} /></mesh>
        ))}
      </group>
    </>
  );
}

export function BuildingMesh({ site }: { site: Site }) {
  const { footprint: fp, floors, floorH } = site.cfg;
  const roof = useRef<THREE.Group>(null!);
  const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  const topY = -site.cfg.pitDepth + floors * floorH;
  useFrame(() => { roof.current.visible = site.roofDone; });
  return (
    <>
      {Array.from({ length: floors }, (_, i) => <FloorMesh key={i} site={site} k={i + 1} />)}
      <group ref={roof} position={[cx, topY, cz]}>
        <Box p={[0, PALLETS.roof.h / 2, 0]} s={[PALLETS.roof.w, PALLETS.roof.h, PALLETS.roof.d]} c="#b9bdc2" />
        <mesh position={[0, PALLETS.roof.h + 0.1, 0]}><cylinderGeometry args={[0.9, 0.9, 0.2, 10]} />{mat("#444")}</mesh>
      </group>
    </>
  );
}

/** The outline the next component will fill, plus a ring and plumb line under the hook to judge height from above. */
export function HookGuides({ site, world }: { site: Site; world: World }) {
  const ghost = useRef<THREE.LineSegments>(null!), ring = useRef<THREE.Mesh>(null!), ringMat = useRef<THREE.MeshBasicMaterial>(null!);
  const fp = site.cfg.footprint, c = site.crane;
  const lines = useRef<THREE.LineBasicMaterial>(null!);
  const unit = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  const OK = useMemo(() => new THREE.Color("#43d17a"), []), WARN = useMemo(() => new THREE.Color("#ff5a4a"), []), NEUTRAL = useMemo(() => new THREE.Color("#ffffff"), []);
  useFrame(() => {
    const next = site.cfg.script[site.nextBuild];
    const show = foundationDone(site) && !site.toppedOut && !!next;
    ghost.current.visible = show;
    if (show) {
      const hh = next.kind === "steel" ? site.cfg.floorH - SLAB_T : next.kind === "concrete" ? SLAB_T : PALLETS.roof.h;
      const base = structureTop(site);
      ghost.current.scale.set(fp.x1 - fp.x0, hh, fp.z1 - fp.z0);
      ghost.current.position.set((fp.x0 + fp.x1) / 2, base + hh / 2, (fp.z0 + fp.z1) / 2);
      const l = hookedPallet(site);
      lines.current.color.copy(l && l.idx === site.nextBuild ? OK : NEUTRAL);
    }
    const h = c.hook, load = hookedPallet(site);
    const y = supportY(site, world, h.x, h.z) + 0.12;
    ring.current.position.set(h.x, y, h.z);
    ring.current.visible = h.y - y > 1;
    const bad = !!load && inRect(site.cfg.publicZone, h.x, h.z);
    const good = !!load && load.idx === site.nextBuild && inRect(fp, h.x, h.z);
    ringMat.current.color.copy(bad ? WARN : good ? OK : NEUTRAL);
  });
  return (
    <>
      <lineSegments ref={ghost} geometry={unit}><lineBasicMaterial ref={lines} color="#43d17a" /></lineSegments>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.9, 1.2, 20]} /><meshBasicMaterial ref={ringMat} color="#fff" transparent opacity={0.85} depthWrite={false} /></mesh>
      <Rod a={() => c.hook} b={() => ({ x: c.hook.x, y: supportY(site, world, c.hook.x, c.hook.z) + 0.12, z: c.hook.z })} r={0.025} color="#ffffff" show={() => c.hook.y - supportY(site, world, c.hook.x, c.hook.z) > 1} />
    </>
  );
}

// ---------- loads + trucks ----------

function PalletBody({ kind }: { kind: Pallet["kind"] }) {
  const d = PALLETS[kind];
  if (kind === "steel") {
    return (
      <>
        {[-0.5, 0, 0.5].map((z) => <Box key={z} p={[0, 0.18, z * 0.8]} s={[d.w, 0.34, 0.42]} c="#8f98a3" />)}
        {[-0.25, 0.25].map((z) => <Box key={z} p={[0, 0.58, z * 0.8]} s={[d.w, 0.34, 0.42]} c="#8f98a3" />)}
        {[-1.4, 1.4].map((x) => <Box key={x} p={[x, 0.4, 0]} s={[0.12, 0.8, d.d + 0.1]} c={YELLOW} cast={false} />)}
      </>
    );
  }
  if (kind === "concrete") {
    return (
      <>
        <Box p={[0, d.h * 0.4, 0]} s={[d.w, d.h * 0.8, d.d]} c="#d8a31d" />
        <Box p={[0, d.h * 0.9, 0]} s={[d.w - 0.3, 0.3, d.d - 0.3]} c="#7a7a78" />
      </>
    );
  }
  return (
    <>
      <Box p={[0, d.h * 0.35, 0]} s={[d.w, d.h * 0.7, d.d]} c="#b9bdc2" />
      <mesh position={[0, d.h * 0.7 + 0.15, 0]}><cylinderGeometry args={[0.8, 0.8, 0.3, 10]} />{mat("#444")}</mesh>
      <Box p={[0, d.h * 0.85, 0.9]} s={[d.w - 0.4, 0.4, 0.3]} c="#8d9298" />
    </>
  );
}

function PalletMesh({ site, i }: { site: Site; i: number }) {
  const g = useRef<THREE.Group>(null!);
  const kinds = useRef<Record<string, THREE.Group | null>>({});
  useFrame(() => {
    const p = site.pallets[i];
    g.current.visible = !!p;
    if (!p) return;
    g.current.position.set(p.x, p.y, p.z);
    for (const k of Object.keys(kinds.current)) { const n = kinds.current[k]; if (n) n.visible = k === p.kind; }
  });
  return (
    <group ref={g}>
      {(["steel", "concrete", "roof"] as const).map((k) => <group key={k} ref={(n) => { kinds.current[k] = n; }}><PalletBody kind={k} /></group>)}
    </group>
  );
}

export function Pallets({ site }: { site: Site }) {
  return <>{Array.from({ length: 12 }, (_, i) => <PalletMesh key={i} site={site} i={i} />)}</>;
}

function TruckMesh({ site, i }: { site: Site; i: number }) {
  const g = useRef<THREE.Group>(null!), bed = useRef<THREE.Group>(null!);
  const kinds = useRef<Record<string, THREE.Group | null>>({});
  useFrame(() => {
    const t = site.trucks[i];
    g.current.visible = !!t;
    if (!t) return;
    g.current.position.set(t.x, 0, site.cfg.truck.laneZ);
    bed.current.visible = t.state === "driving";
    for (const k of Object.keys(kinds.current)) { const n = kinds.current[k]; if (n) n.visible = k === t.kind; }
  });
  return (
    <group ref={g} rotation={[0, Math.PI / 2, 0]}>
      {[-1.05, 1.05].flatMap((x) => [-2.2, -0.6, 1.8].map((z) => (
        <mesh key={`${x}${z}`} position={[x, 0.5, z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.4, 8]} />{mat("#222")}</mesh>
      )))}
      <Box p={[0, 0.9, -0.4]} s={[2.1, 0.3, 6]} c="#333" />
      <Box p={[0, 1.6, 2.2]} s={[2.1, 1.6, 1.6]} c="#2f6fb5" />
      <mesh position={[0, 1.9, 3.02]}><boxGeometry args={[1.7, 0.6, 0.05]} /><meshStandardMaterial color="#9fc7d8" metalness={0.3} roughness={0.2} /></mesh>
      <Box p={[0, 1.15, -0.8]} s={[2.3, 0.25, 4.6]} c="#8a8f98" />
      <Box p={[0.9, 1.9, -3.3]} s={[0.3, 1.8, 0.3]} c="#d9902a" />
      <group ref={bed} position={[0, 1.28, -0.8]}>
        {(["steel", "concrete", "roof"] as const).map((k) => (
          <group key={k} ref={(n) => { kinds.current[k] = n; }} rotation={[0, k === "steel" ? Math.PI / 2 : 0, 0]}><PalletBody kind={k} /></group>
        ))}
      </group>
    </group>
  );
}

export function DeliveryTrucks({ site }: { site: Site }) {
  return <>{Array.from({ length: 4 }, (_, i) => <TruckMesh key={i} site={site} i={i} />)}</>;
}
