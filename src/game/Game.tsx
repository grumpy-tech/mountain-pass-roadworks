import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import {
  CELL, HALF, MACHINES, N, TRUCK_CAPACITY, createGame, currentAction, cycleVehicle, heightAt, progress, recomputeHeights, recover, stepGame,
  type Game as GameState, type Machine, type Vehicle, type World,
} from "./world";

const keys = new Set<string>();
const PAINT: Record<Machine, string> = { dozer: "#e8b322", excavator: "#d9902a", truck: "#c8392b", paver: "#e06b24" };
const DIRT = new THREE.Color("#8a6a45"), ASPHALT = new THREE.Color("#3a3c40");

function Terrain({ world }: { world: World }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(N * CELL, N * CELL, N, N);
    g.rotateX(-Math.PI / 2);
    g.setAttribute("color", new THREE.BufferAttribute(world.colors, 3));
    return g;
  }, [world]);
  useFrame(() => {
    if (!world.dirtyTerrain) return;
    world.dirtyTerrain = false;
    recomputeHeights(world);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) pos.setY(v, world.heights[v]);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

function RoadWork({ world }: { world: World }) {
  const tiles = useRef<THREE.InstancedMesh>(null!);
  const m = useMemo(() => new THREE.Object3D(), []);
  const update = (idx: number) => {
    const r = world.road[idx];
    m.position.set(r.x, heightAt(world, r.x, r.z) + 0.03, r.z);
    m.scale.set(r.stage >= 2 ? 1 : 0, 1, r.stage >= 2 ? 1 : 0);
    m.updateMatrix(); tiles.current.setMatrixAt(idx, m.matrix);
    tiles.current.setColorAt(idx, r.stage === 3 ? ASPHALT : DIRT);
  };
  const flush = () => {
    tiles.current.instanceMatrix.needsUpdate = true;
    if (tiles.current.instanceColor) tiles.current.instanceColor.needsUpdate = true;
  };
  useEffect(() => { world.road.forEach((_, i) => update(i)); flush(); }, [world]);
  useFrame(() => {
    if (!world.dirtyCells.size) return;
    for (const c of world.dirtyCells) update(world.cellToRoad[c]);
    world.dirtyCells.clear(); flush();
  });
  return (
    <instancedMesh ref={tiles} args={[undefined, undefined, world.road.length]} receiveShadow>
      <boxGeometry args={[CELL * 1.02, 0.12, CELL * 1.02]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  );
}

function Hazards({ world }: { world: World }) {
  const mounds = useRef<THREE.InstancedMesh>(null!), mud = useRef<THREE.InstancedMesh>(null!);
  const moundCells = useMemo(() => world.road.filter((r) => r.kind === "mound"), [world]);
  useFrame(() => {
    if (!world.dirtyHazards) return;
    world.dirtyHazards = false;
    const o = new THREE.Object3D();
    moundCells.forEach((r, i) => {
      const s = r.kind === "mound" ? 0.5 + r.mound * 0.35 : 0;
      o.position.set(r.x, heightAt(world, r.x, r.z), r.z); o.rotation.set(0, i * 1.7, 0); o.scale.set(s * 1.3, s, s * 1.3);
      o.updateMatrix(); mounds.current.setMatrixAt(i, o.matrix);
    });
    world.mudCells.forEach((c, i) => {
      const x = -HALF + ((c % N) + 0.5) * CELL, z = -HALF + (Math.floor(c / N) + 0.5) * CELL;
      const s = world.mud[c] ? 1 : 0;
      o.position.set(x, heightAt(world, x, z) + 0.06, z); o.rotation.set(0, 0, 0); o.scale.set(s, 1, s);
      o.updateMatrix(); mud.current.setMatrixAt(i, o.matrix);
    });
    mounds.current.instanceMatrix.needsUpdate = true; mud.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={mounds} args={[undefined, undefined, Math.max(1, moundCells.length)]} castShadow receiveShadow>
        <coneGeometry args={[1.2, 1.4, 7]} /><meshStandardMaterial color="#7a5533" flatShading />
      </instancedMesh>
      <instancedMesh ref={mud} args={[undefined, undefined, Math.max(1, world.mudCells.length)]}>
        <boxGeometry args={[CELL * 1.05, 0.08, CELL * 1.05]} /><meshStandardMaterial color="#3b2a1c" roughness={0.25} metalness={0.1} />
      </instancedMesh>
    </>
  );
}

function Rocks({ world }: { world: World }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const mesh = ref.current;
    for (let i = 0; i < world.rockCapacity; i++) {
      const r = world.rocks[i];
      if (r) {
        o.position.set(r.x, heightAt(world, r.x, r.z) + r.r * 0.6, r.z);
        o.rotation.set(r.spin, r.id, r.spin * 0.5);
        o.scale.set(r.r, r.r * 0.8, r.r);
      } else o.scale.setScalar(0);
      o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, world.rockCapacity)]} castShadow frustumCulled={false}>
      <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#7d7770" flatShading />
    </instancedMesh>
  );
}

function Scenery({ world }: { world: World }) {
  const trunk = useRef<THREE.InstancedMesh>(null!), crown = useRef<THREE.InstancedMesh>(null!), boulder = useRef<THREE.InstancedMesh>(null!);
  useEffect(() => {
    const o = new THREE.Object3D();
    world.trees.forEach((t, i) => {
      const y = heightAt(world, t.x, t.z);
      o.position.set(t.x, y + 0.6 * t.s, t.z); o.scale.setScalar(t.s); o.rotation.set(0, 0, 0); o.updateMatrix(); trunk.current.setMatrixAt(i, o.matrix);
      o.position.set(t.x, y + 2.4 * t.s, t.z); o.rotation.y = i; o.updateMatrix(); crown.current.setMatrixAt(i, o.matrix);
    });
    world.boulders.forEach((b, i) => {
      o.position.set(b.x, heightAt(world, b.x, b.z) + 0.3 * b.s, b.z); o.scale.set(b.s, b.s * 0.7, b.s); o.rotation.set(i, i * 2, 0); o.updateMatrix(); boulder.current.setMatrixAt(i, o.matrix);
    });
  }, [world]);
  return (
    <>
      <instancedMesh ref={trunk} args={[undefined, undefined, world.trees.length]} castShadow>
        <cylinderGeometry args={[0.15, 0.22, 1.2, 5]} /><meshStandardMaterial color="#5b3d26" flatShading />
      </instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, world.trees.length]} castShadow>
        <coneGeometry args={[1.1, 3, 6]} /><meshStandardMaterial color="#2f5a35" flatShading />
      </instancedMesh>
      <instancedMesh ref={boulder} args={[undefined, undefined, world.boulders.length]} castShadow>
        <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#8b8680" flatShading />
      </instancedMesh>
    </>
  );
}

const mat = (c: string) => <meshStandardMaterial color={c} flatShading />;

function Tracks() {
  return (
    <>
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 0.35, 0]} castShadow><boxGeometry args={[0.55, 0.7, 3.2]} />{mat("#2a2a2a")}</mesh>
      ))}
    </>
  );
}

function Wheels() {
  return (
    <>
      {[-1.05, 1.05].flatMap((x) => [-1.3, 0, 1.4].map((z) => (
        <mesh key={`${x}${z}`} position={[x, 0.5, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.5, 0.5, 0.45, 8]} />{mat("#222")}
        </mesh>
      )))}
    </>
  );
}

const glass = <meshStandardMaterial color="#05070a" metalness={0.75} roughness={0.1} />;

/** Blacked-out window pane. */
function Glass({ p, s }: { p: [number, number, number]; s: [number, number, number] }) {
  return <mesh position={p}><boxGeometry args={s} />{glass}</mesh>;
}

/** Light that glows only while its machine is the one being driven. */
function Lamp({ p, s, on, color }: { p: [number, number, number]; s: [number, number, number]; on: boolean; color: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={on ? color : "#3a3a3a"} emissive={color} emissiveIntensity={on ? 2.2 : 0} />
    </mesh>
  );
}

/** Amber roof beacon: spins and flashes while the machine is active. */
function Beacon({ p, on }: { p: [number, number, number]; on: boolean }) {
  const spin = useRef<THREE.Group>(null!);
  const bulb = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    spin.current.rotation.y = clock.elapsedTime * 7;
    bulb.current.emissiveIntensity = on ? 0.5 + 2.5 * Math.max(0, Math.sin(clock.elapsedTime * 9)) : 0;
  });
  return (
    <group position={p}>
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[0.16, 0.2, 0.1, 8]} />{mat("#222")}</mesh>
      <group ref={spin}>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.13, 0.15, 0.24, 8]} />
          <meshStandardMaterial ref={bulb} color="#ffa000" emissive="#ff9100" emissiveIntensity={0} flatShading />
        </mesh>
      </group>
    </group>
  );
}

function Stack({ p, h = 0.9 }: { p: [number, number, number]; h?: number }) {
  return (
    <mesh position={p} castShadow>
      <cylinderGeometry args={[0.07, 0.09, h, 6]} /><meshStandardMaterial color="#b8bcc2" metalness={0.8} roughness={0.25} flatShading />
    </mesh>
  );
}

function VehicleMesh({ v, active }: { v: Vehicle; active: boolean }) {
  const g = useRef<THREE.Group>(null!);
  const arm = useRef<THREE.Group>(null!);
  const load = useRef<THREE.Mesh>(null!);
  const marker = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    g.current.position.set(v.x, v.y, v.z);
    g.current.rotation.set(0, 0, 0);
    g.current.rotateY(v.heading); g.current.rotateX(v.pitch); g.current.rotateZ(v.roll);
    if (arm.current) arm.current.rotation.x = -0.25 + Math.sin(clock.elapsedTime * 6) * 0.35 * v.work + (v.dirt + v.rock > 0 ? -0.4 : 0);
    if (load.current) {
      const f = (v.dirt + v.rock) / (v.kind === "truck" ? TRUCK_CAPACITY : 1);
      load.current.visible = f > 0;
      load.current.scale.set(1, Math.max(0.01, f), 1);
    }
    if (marker.current) { marker.current.visible = active; marker.current.position.y = 4.6 + Math.sin(clock.elapsedTime * 3) * 0.2; }
  });
  const paint = PAINT[v.kind];
  return (
    <group ref={g}>
      <mesh ref={marker} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.4, 0.8, 4]} />{mat("#ffffff")}</mesh>
      {v.kind === "dozer" && (
        <>
          <Tracks />
          <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.46, -0.2]}><boxGeometry args={[0.4, 0.02, 2]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.35, -0.6]} castShadow><boxGeometry args={[1.45, 0.08, 1.35]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 1.9, -0.04]} s={[1, 0.55, 0.04]} />
          <Glass p={[0, 1.9, -1.16]} s={[1, 0.55, 0.04]} />
          <Glass p={[0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Lamp p={[0.55, 1.15, 1.01]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[-0.55, 1.15, 1.01]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
          <Stack p={[0.5, 1.9, 0.6]} />
          <Beacon p={[0, 2.39, -0.6]} on={active} />
          <mesh position={[0, 0.55, 2.1]} rotation={[0.2, 0, 0]} castShadow><boxGeometry args={[3.2, 1, 0.25]} />{mat("#9a7414")}</mesh>
        </>
      )}
      {v.kind === "excavator" && (
        <>
          <Tracks />
          <mesh position={[0, 1.1, -0.3]} castShadow><boxGeometry args={[1.9, 0.7, 2.6]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.1, -1.75]} castShadow><boxGeometry args={[1.8, 0.75, 0.5]} />{mat("#3a3a3a")}</mesh>
          <mesh position={[-0.45, 1.9, 0.2]} castShadow><boxGeometry args={[0.9, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[-0.45, 2.38, 0.2]} castShadow><boxGeometry args={[1.05, 0.07, 1.25]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[-0.45, 1.95, 0.76]} s={[0.72, 0.6, 0.04]} />
          <Glass p={[-0.91, 1.95, 0.2]} s={[0.04, 0.6, 0.85]} />
          <Glass p={[0.01, 1.95, 0.2]} s={[0.04, 0.6, 0.85]} />
          <Lamp p={[-0.75, 2.46, 0.7]} s={[0.22, 0.14, 0.1]} on={active} color="#fff3c4" />
          <Lamp p={[-0.15, 2.46, 0.7]} s={[0.22, 0.14, 0.1]} on={active} color="#fff3c4" />
          <Stack p={[0.7, 1.95, -1.3]} h={1} />
          <Beacon p={[-0.45, 2.42, -0.15]} on={active} />
          <group ref={arm} position={[0.4, 1.5, 0.6]}>
            <mesh position={[0, 0.6, 1.2]} rotation={[-0.5, 0, 0]} castShadow><boxGeometry args={[0.35, 0.4, 2.8]} />{mat("#c07a1e")}</mesh>
            <mesh position={[0, 0.1, 2.7]} rotation={[0.6, 0, 0]} castShadow><boxGeometry args={[0.3, 0.3, 1.6]} />{mat("#c07a1e")}</mesh>
            <mesh position={[0, -0.6, 3.2]} castShadow><boxGeometry args={[0.9, 0.6, 0.6]} />{mat("#444")}</mesh>
            <mesh ref={load} position={[0, -0.35, 3.2]}><boxGeometry args={[0.8, 0.3, 0.5]} />{mat(v.rock ? "#7d7770" : "#6b4a2b")}</mesh>
          </group>
        </>
      )}
      {v.kind === "truck" && (
        <>
          <Wheels />
          <mesh position={[0, 1.4, 1.7]} castShadow><boxGeometry args={[1.9, 1.3, 1.2]} />{mat(paint)}</mesh>
          <Glass p={[0, 1.65, 2.31]} s={[1.65, 0.6, 0.05]} />
          <Glass p={[0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <mesh position={[0, 1.08, 2.31]}><boxGeometry args={[1.2, 0.3, 0.05]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 0.8, 2.38]} castShadow><boxGeometry args={[2.1, 0.25, 0.15]} />{mat("#2b2b2b")}</mesh>
          <Lamp p={[0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[-0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[0.85, 1.0, -2.22]} s={[0.3, 0.2, 0.05]} on={active} color="#ff2a1a" />
          <Lamp p={[-0.85, 1.0, -2.22]} s={[0.3, 0.2, 0.05]} on={active} color="#ff2a1a" />
          <Stack p={[1.02, 2.25, 1.1]} h={1.4} />
          <Stack p={[-1.02, 2.25, 1.1]} h={1.4} />
          <Beacon p={[0, 2.05, 1.7]} on={active} />
          <mesh position={[0, 0.9, -0.2]} castShadow><boxGeometry args={[2.1, 0.3, 4]} />{mat("#333")}</mesh>
          <mesh position={[0, 1.55, -0.5]} castShadow><boxGeometry args={[2.2, 1, 3]} />{mat("#a8a8a8")}</mesh>
          <mesh ref={load} position={[0, 2.05, -0.5]}><boxGeometry args={[2, 0.8, 2.8]} />{mat("#6b4a2b")}</mesh>
        </>
      )}
      {v.kind === "paver" && (
        <>
          <Tracks />
          <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.46, -0.2]}><boxGeometry args={[0.4, 0.02, 2]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.35, -0.6]} castShadow><boxGeometry args={[1.45, 0.08, 1.35]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 1.9, -0.04]} s={[1, 0.55, 0.04]} />
          <Glass p={[0, 1.9, -1.16]} s={[1, 0.55, 0.04]} />
          <Glass p={[0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Lamp p={[0.7, 1.15, 0.99]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[-0.7, 1.15, 0.99]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
          <Stack p={[-0.55, 1.9, 0.5]} h={0.8} />
          <Beacon p={[0, 2.39, -0.6]} on={active} />
          <mesh position={[0, 0.9, 1.5]} castShadow><boxGeometry args={[2, 0.9, 0.9]} />{mat("#555")}</mesh>
          <mesh position={[0, 1.38, 1.5]}><boxGeometry args={[2, 0.06, 0.9]} />{mat("#e8b322")}</mesh>
          <mesh position={[0, 0.3, -1.9]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.35, 0.35, 3, 8]} />{mat("#444")}</mesh>
        </>
      )}
    </group>
  );
}

function Director({ game, paused, onReady }: { game: GameState; paused: MutableRefObject<boolean>; onReady: () => void }) {
  const light = useRef<THREE.DirectionalLight>(null!);
  const { camera } = useThree();
  const frames = useRef(0);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const throttle = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
    if (!paused.current) stepGame(game, { throttle, steer, action: keys.has(" ") }, dt);
    const v = game.vehicles[game.active];
    camera.position.lerp(new THREE.Vector3(v.x + 6, v.y + 42, v.z + 16), 1 - Math.exp(-3 * dt));
    camera.lookAt(v.x, v.y, v.z);
    light.current.position.set(v.x + 20, v.y + 40, v.z + 10);
    light.current.target.position.set(v.x, v.y, v.z);
    light.current.target.updateMatrixWorld();
    if (++frames.current === 3) onReady();
  });
  return (
    <directionalLight ref={light} intensity={2.4} color="#fff1d6" castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0005} />
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-foreground/40 bg-muted px-1.5 py-0.5 font-mono text-xs font-bold text-foreground">{children}</kbd>;
}

const CONTROLS: [string, string][] = [
  ["W / S  or  ↑ / ↓", "Drive forward / reverse"],
  ["A / D  or  ← / →", "Steer"],
  ["Space (hold)", "Work: dig, break, load, dump, fill"],
  ["Tab / Shift+Tab", "Switch to next / previous machine"],
  ["R", "Recover after a rollover"],
  ["? or H", "Show / hide these instructions"],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4" role="dialog" aria-modal="true" aria-label="Instructions">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-md border-2 border-foreground bg-card p-6 font-mono text-sm text-card-foreground shadow-xl">
        <h2 className="text-xl font-bold">Pass Road · Crew Briefing</h2>
        <p className="mt-1 text-muted-foreground">Build the road up the mountain. Get 95% of it paved to open the pass.</p>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">Controls</h3>
        <ul className="mt-1 space-y-1">
          {CONTROLS.map(([k, d]) => (
            <li key={k} className="flex items-baseline justify-between gap-4"><Key>{k}</Key><span className="text-right">{d}</span></li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">The crew</h3>
        <ul className="mt-1 space-y-1">
          {(Object.keys(MACHINES) as Machine[]).map((m) => (
            <li key={m} className="flex gap-2">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-sm border border-foreground/60" style={{ background: PAINT[m] }} />
              <span><b>{MACHINES[m].nick}</b> the {MACHINES[m].label}: {ROLES[m]}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">Job order</h3>
        <p className="mt-1">1. Clear rocks and dirt mounds, fill mud holes. 2. Drive the bulldozer over the road to grade it. 3. Drive the paver over graded dirt. Watch steep edges: loaded trucks tip easily and bog down in mud.</p>

        <div className="mt-5 flex justify-end">
          <button type="button" autoFocus onClick={onClose} className="rounded-md border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground hover:opacity-90">
            Start work <span className="ml-1 text-xs font-normal">(Enter)</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const ROLES: Record<Machine, string> = {
  dozer: "pushes small rocks off the road and grades dirt flat.",
  excavator: "breaks boulders, digs mounds, loads the truck.",
  truck: "fills mud holes or dumps loads off-road.",
  paver: "lays asphalt on graded dirt.",
};

export default function Game() {
  const game = useMemo(() => createGame(), []);
  const world = game.world;
  const [hud, setHud] = useState(() => ({ ...progress(world), active: 0, speed: 0, msg: "", action: "", actionT: 0, actionMax: 1, cargo: "", won: false }));
  const [ready, setReady] = useState(false);
  const [help, setHelp] = useState(true); // instructions open on load; the sim is paused while they are up
  const helpRef = useRef(true);
  const setHelpOpen = useCallback((open: boolean) => { helpRef.current = open; keys.clear(); setHelp(open); }, []);

  useEffect(() => {
    if (typeof window !== "undefined") (window as unknown as { __game: GameState }).__game = game;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "tab") e.preventDefault(); // never move browser focus
      if (e.repeat && (k === "tab" || k === "r" || k === "?" || k === "h")) return;
      if (k === "?" || k === "h") { setHelpOpen(!helpRef.current); return; }
      if (helpRef.current) { if (k === "escape" || k === "enter") setHelpOpen(false); return; }
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      if (k === "tab") cycleVehicle(game, e.shiftKey ? -1 : 1);
      if (k === "r") recover(game);
      keys.add(k);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    const id = setInterval(() => {
      const v = game.vehicles[game.active];
      const a = currentAction(game);
      const cargo = v.kind === "truck" ? `Load ${v.dirt + v.rock}/${TRUCK_CAPACITY} (${v.dirt} dirt, ${v.rock} rock)` : v.kind === "excavator" ? (v.dirt ? "Bucket: dirt" : v.rock ? "Bucket: rock" : "Bucket: empty") : "";
      setHud({ ...progress(world), active: game.active, speed: Math.abs(v.speed), msg: game.msgT > 0 ? game.msg : "", action: a ? a.label : "", actionT: game.actionT, actionMax: a && Number.isFinite(a.time) ? a.time : 0, cargo, won: game.won });
    }, 120);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); clearInterval(id); };
  }, [game, world, setHelpOpen]);

  const v = game.vehicles[hud.active];
  const tasks: [string, string, boolean][] = [
    ["Rocks off the road", hud.rocksOnRoad ? `${hud.rocksOnRoad} left` : "done", !hud.rocksOnRoad],
    ["Dirt mounds dug", hud.mounds ? `${hud.mounds} left` : "done", !hud.mounds],
    ["Mud holes filled", hud.mud ? `${hud.mud} left` : "done", !hud.mud],
    ["Graded", `${Math.floor(hud.graded * 100)}%`, hud.graded > 0.95],
    ["Paved", `${Math.floor(hud.paved * 100)}%`, hud.paved >= 0.95],
  ];
  return (
    <div className="relative h-screen w-full overflow-hidden" data-scene-ready={ready ? "" : undefined}>
      <Canvas shadows camera={{ fov: 40, position: [v.x + 6, 42, v.z + 16], far: 400 }}>
        <color attach="background" args={["#b9d3e0"]} />
        <fog attach="fog" args={["#b9d3e0", 60, 160]} />
        <hemisphereLight args={["#dbeeff", "#6b5a3e", 0.5]} />
        <Environment resolution={64} environmentIntensity={0.35}>
          <Lightformer intensity={1.5} position={[0, 5, 0]} scale={[10, 10, 1]} />
          <Lightformer intensity={0.8} color="#ffd9a8" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
        </Environment>
        <Terrain world={world} />
        <RoadWork world={world} />
        <Hazards world={world} />
        <Rocks world={world} />
        <Scenery world={world} />
        {game.vehicles.map((veh, i) => <VehicleMesh key={i} v={veh} active={i === hud.active} />)}
        <Director game={game} paused={helpRef} onReady={() => setReady(true)} />
      </Canvas>

      <div className="pointer-events-none absolute left-4 top-4 w-80 rounded-md border-2 border-foreground/80 bg-card/90 p-4 font-mono text-sm text-card-foreground shadow-lg">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Job · Pass Road</div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-lg font-bold">{MACHINES[v.kind].nick} <span className="text-xs font-normal text-muted-foreground">the {MACHINES[v.kind].label}</span></span>
          <span className="text-xs text-muted-foreground">{(hud.speed * 3.6).toFixed(0)} km/h</span>
        </div>
        {hud.cargo && <div className="text-xs">{hud.cargo}</div>}
        <ul className="mt-3 space-y-1">
          {tasks.map(([l, val, ok]) => (
            <li key={l} className="flex justify-between">
              <span className={ok ? "text-muted-foreground line-through" : ""}>{l}</span><span>{val}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 h-2 bg-muted"><div className="h-2 bg-primary" style={{ width: `${hud.paved * 100}%` }} /></div>
      </div>

      {(hud.action || hud.msg) && (
        <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 space-y-2 text-center font-mono text-sm">
          {hud.msg && <div className="rounded-md bg-foreground px-4 py-2 text-background">{hud.msg}</div>}
          {hud.action && (
            <div className="rounded-md bg-card/90 px-4 py-2 text-card-foreground">
              {hud.actionMax ? <><b>Hold Space</b> · {hud.action}</> : hud.action}
              {hud.actionMax > 0 && hud.actionT > 0 && (
                <div className="mt-1 h-1.5 bg-muted"><div className="h-1.5 bg-primary" style={{ width: `${Math.min(1, hud.actionT / hud.actionMax) * 100}%` }} /></div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="absolute right-4 top-4 flex flex-col items-end gap-2 font-mono text-xs">
        <button
          type="button" tabIndex={-1} aria-label="Show instructions" title="Instructions (?)"
          onClick={(e) => { e.currentTarget.blur(); setHelpOpen(true); }}
          className="h-9 w-9 rounded-full border-2 border-foreground/80 bg-card/90 text-base font-bold text-card-foreground shadow-lg hover:bg-card"
        >?</button>
        <div className="pointer-events-none w-44 rounded-md border-2 border-foreground/80 bg-card/90 p-2 text-card-foreground shadow-lg">
          <div className="mb-1 uppercase tracking-widest text-muted-foreground"><Key>Tab</Key> switch</div>
          {game.vehicles.map((veh, i) => (
            <div key={i} className={`flex items-center gap-2 rounded px-1.5 py-1 ${i === hud.active ? "bg-primary/25 font-bold" : ""}`}>
              <span className="h-3 w-3 shrink-0 rounded-sm border border-foreground/60" style={{ background: PAINT[veh.kind] }} />
              <span className="flex-1 truncate">{MACHINES[veh.kind].nick}</span>
              {veh.tipped && <span className="text-destructive">tipped</span>}
            </div>
          ))}
        </div>
      </div>

      {help && <Help onClose={() => setHelpOpen(false)} />}

      {hud.won && (
        <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
          <div className="rounded-md border-2 border-foreground bg-card p-8 text-center font-mono">
            <div className="text-2xl font-bold">Road complete!</div>
            <div className="mt-2 text-muted-foreground">The pass is open.</div>
          </div>
        </div>
      )}
    </div>
  );
}
