import { useFrame } from "@react-three/fiber";
import { useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import CampScene, { Label } from "./Camp";
import {
  FALL_TIME, FOREST_MACHINES, LOG_TARGET, SKIDDER_CAPACITY, TRUCK_CAPACITY, WASTE_ALLOWANCE, blockersLeft, blockersTotal, createForestGame, currentForestAction,
  cycleForestVehicle, forestHeightAt, forestHint, forestProgress, recomputeForestHeights, recoverForest, roadLevelled, selectForestVehicle, stepForestGame,
  type ForestMachine, type ForestVehicle, type ForestWorld, type ForestGame,
} from "./forest";
import { Beacon, Glass, Lamp, PAINT, Stack, Tracks, Wheels, mat } from "./parts";
import { FxBus, FxCtx, emitAt } from "./Particles";
import { LevelShell, type BaseVehicle, type LevelProps, type LevelSpec } from "./Shell";
import { CELL, N, nearestOnPath } from "./world";

const OVERGROWN: [number, number, number] = [0.34, 0.4, 0.22], GRADED: [number, number, number] = [0.66, 0.55, 0.38];

/** Recolour the road vertices: weedy and overgrown while rutted, pale gravel once graded. */
function paintRoad(w: ForestWorld) {
  for (let v = 0; v < w.roadV.length; v++) {
    if (!w.roadV[v]) continue;
    const f = 1 - w.rough[v], j = 0.9 + ((v * 37) % 100) / 500;
    for (let k = 0; k < 3; k++) w.colors[v * 3 + k] = (OVERGROWN[k] + (GRADED[k] - OVERGROWN[k]) * f) * j;
  }
}

function Terrain({ world }: { world: ForestWorld }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(N * CELL, N * CELL, N, N);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) pos.setY(v, world.heights[v]);
    paintRoad(world);
    g.setAttribute("color", new THREE.BufferAttribute(world.colors, 3));
    g.computeVertexNormals();
    return g;
  }, [world]);
  useFrame(() => {
    if (!world.dirtyTerrain) return;
    world.dirtyTerrain = false;
    recomputeForestHeights(world); paintRoad(world);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) pos.setY(v, world.heights[v]);
    pos.needsUpdate = true; geo.getAttribute("color").needsUpdate = true;
    geo.computeVertexNormals();
  });
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

const YELLOW = new THREE.Color("#ffd400"), ORANGE = new THREE.Color("#ff7a1a");

function Trees({ world }: { world: ForestWorld }) {
  const trunk = useRef<THREE.InstancedMesh>(null!), low = useRef<THREE.InstancedMesh>(null!), high = useRef<THREE.InstancedMesh>(null!), tape = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    if (!world.dirtyTrees) return;
    world.dirtyTrees = false;
    world.trees.forEach((t, i) => {
      const y = forestHeightAt(world, t.x, t.z);
      o.rotation.set(0, 0, 0);
      // a felled tree leaves a stump behind
      o.scale.set(t.s, t.alive ? t.s : t.s * 0.3, t.s); o.position.set(t.x, y + (t.alive ? 0.6 : 0.18) * t.s, t.z); o.updateMatrix(); trunk.current.setMatrixAt(i, o.matrix);
      const k = t.alive ? t.s : 0;
      o.scale.setScalar(k); o.rotation.y = i;
      o.position.set(t.x, y + 2.3 * k, t.z); o.updateMatrix(); low.current.setMatrixAt(i, o.matrix);
      o.position.set(t.x, y + 4 * k, t.z); o.updateMatrix(); high.current.setMatrixAt(i, o.matrix);
      // survey markers floating above the crown: yellow on road blockers, orange on the marked trees once the road is open
      const show = t.alive && (t.kind === "blocker" || (t.kind === "marked" && world.roadOpen));
      o.rotation.set(0, i, 0); o.scale.setScalar(show ? 1 : 0); o.position.set(t.x, y + 6.6 * t.s, t.z); o.updateMatrix();
      tape.current.setMatrixAt(i, o.matrix); tape.current.setColorAt(i, t.kind === "blocker" ? YELLOW : ORANGE);
    });
    for (const m of [trunk, low, high, tape]) m.current.instanceMatrix.needsUpdate = true;
    if (tape.current.instanceColor) tape.current.instanceColor.needsUpdate = true;
  });
  const n = Math.max(1, world.trees.length);
  return (
    <>
      <instancedMesh ref={trunk} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.15, 0.24, 1.2, 5]} />{mat("#5b3d26")}
      </instancedMesh>
      <instancedMesh ref={low} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <coneGeometry args={[1.35, 2.8, 6]} />{mat("#2b5a33")}
      </instancedMesh>
      <instancedMesh ref={high} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <coneGeometry args={[0.95, 2.4, 6]} />{mat("#3a6e3e")}
      </instancedMesh>
      <instancedMesh ref={tape} args={[undefined, undefined, n]} frustumCulled={false}>
        <octahedronGeometry args={[0.55, 0]} /><meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/** Trees that have just been cut tip over, hit the ground with leaves and dust, then become a log. */
function FallingTrees({ bus, world }: { bus: FxBus; world: ForestWorld }) {
  const MAXF = 8;
  const groups = useRef<(THREE.Group | null)[]>([]);
  const st = useMemo(() => Array.from({ length: MAXF }, () => ({ on: false, t: 0, x: 0, y: 0, z: 0, h: 0, s: 1 })), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    for (const e of bus.falls.splice(0)) {
      const f = st.find((q) => !q.on);
      if (f) Object.assign(f, { on: true, t: 0, x: e.x, y: forestHeightAt(world, e.x, e.z), z: e.z, h: e.heading ?? 0, s: e.s ?? 1 });
    }
    st.forEach((f, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.visible = f.on;
      if (!f.on) return;
      f.t += dt;
      const k = Math.min(1, f.t / FALL_TIME);
      g.position.set(f.x, f.y, f.z);
      g.rotation.order = "YXZ";
      g.rotation.set(k * k * Math.PI * 0.49, f.h, 0); // slow start, fast finish
      g.scale.setScalar(f.s);
      if (k >= 1) {
        f.on = false;
        const ix = f.x + Math.sin(f.h) * 3.4 * f.s, iz = f.z + Math.cos(f.h) * 3.4 * f.s, y = forestHeightAt(world, ix, iz);
        bus.emit("leaves", ix, y, iz, 18); bus.emit("dust", ix, y, iz, 10);
      }
    });
  });
  return (
    <>
      {st.map((_, i) => (
        <group key={i} ref={(el) => { groups.current[i] = el; }} visible={false}>
          <mesh position={[0, 0.6, 0]} castShadow><cylinderGeometry args={[0.15, 0.24, 1.2, 5]} />{mat("#5b3d26")}</mesh>
          <mesh position={[0, 2.3, 0]} castShadow><coneGeometry args={[1.35, 2.8, 6]} />{mat("#2b5a33")}</mesh>
          <mesh position={[0, 4, 0]} castShadow><coneGeometry args={[0.95, 2.4, 6]} />{mat("#3a6e3e")}</mesh>
        </group>
      ))}
    </>
  );
}

const LOG_R = 0.38, LOG_LEN = 4;

/** Felled logs (visible once they have landed), deadfalls across the road, and the pile at the landing. */
function Logs({ game }: { game: ForestGame }) {
  const world = game.world;
  const ground = useRef<THREE.InstancedMesh>(null!), pile = useRef<THREE.InstancedMesh>(null!), falls = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []);
  const shown = useRef(-1), last = useRef(0);
  const PILE = 36;
  useFrame(() => {
    o.rotation.order = "YXZ";
    const n = world.logs.length;
    for (let i = 0; i < Math.max(n, last.current); i++) {
      const l = world.logs[i];
      if (l && l.at <= game.time) { o.position.set(l.x, forestHeightAt(world, l.x, l.z) + LOG_R, l.z); o.rotation.set(Math.PI / 2, l.heading, 0); o.scale.set(1, 1, 1); }
      else o.scale.setScalar(0);
      o.updateMatrix(); ground.current.setMatrixAt(i, o.matrix);
    }
    last.current = n;
    ground.current.instanceMatrix.needsUpdate = true;
    if (world.dirtyLogs) {
      world.dirtyLogs = false;
      world.deadfalls.forEach((d, i) => {
        o.position.set(d.x, forestHeightAt(world, d.x, d.z) + 0.55, d.z); o.rotation.set(Math.PI / 2, d.heading, 0); o.scale.setScalar(d.cleared ? 0 : 1);
        o.updateMatrix(); falls.current.setMatrixAt(i, o.matrix);
      });
      falls.current.instanceMatrix.needsUpdate = true;
    }
    const stack = Math.min(PILE, world.landing.stack);
    if (shown.current !== stack) { // the landing pile: rows of 6, stacked in layers
      shown.current = stack;
      const bx = world.landing.x + 7.5, bz = world.landing.z - 2, by = forestHeightAt(world, bx, bz);
      for (let i = 0; i < PILE; i++) {
        const layer = Math.floor(i / 6), col = i % 6;
        o.position.set(bx + (col - 2.5 + (layer % 2) * 0.4) * 0.8, by + LOG_R + layer * 0.62, bz);
        o.rotation.set(Math.PI / 2, 0, 0); o.scale.setScalar(i < stack ? 1 : 0);
        o.updateMatrix(); pile.current.setMatrixAt(i, o.matrix);
      }
      pile.current.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <>
      <instancedMesh ref={ground} args={[undefined, undefined, Math.max(1, LOG_TARGET + 6)]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[LOG_R, LOG_R, LOG_LEN, 7]} />{mat("#8b5a2b")}
      </instancedMesh>
      <instancedMesh ref={falls} args={[undefined, undefined, Math.max(1, world.deadfalls.length)]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.6, 0.65, 9.4, 8]} />{mat("#6e4a28")}
      </instancedMesh>
      <instancedMesh ref={pile} args={[undefined, undefined, PILE]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[LOG_R, LOG_R, LOG_LEN, 7]} />{mat("#9a6632")}
      </instancedMesh>
    </>
  );
}

/** Stakes round the landing, the sawmill gate and shed at the camp end, and signs for the road and cut block. */
function Landmarks({ world }: { world: ForestWorld }) {
  const stakes = useRef<THREE.InstancedMesh>(null!), chimney = useRef<THREE.Group>(null!);
  const bus = useContext(FxCtx);
  const acc = useRef(0);
  const o = useMemo(() => new THREE.Object3D(), []);
  const at = useMemo(() => {
    const dirOf = (i: number) => { const a = world.path[i], b = world.path[Math.min(world.path.length - 1, i + 3)]; return Math.atan2(b.x - a.x, b.z - a.z); };
    const p0 = world.path[0], iSign = 60;
    return { mill: { x: p0.x, z: p0.z, h: dirOf(0), y: forestHeightAt(world, p0.x, p0.z) }, sign: { ...world.path[iSign], h: dirOf(iSign) } };
  }, [world]);
  const COUNT = 28;
  useEffect(() => {
    let k = 0;
    for (const zone of [world.landing, world.mill]) {
      for (let i = 0; i < COUNT; i++, k++) {
        const a = (i / COUNT) * Math.PI * 2, x = zone.x + Math.cos(a) * zone.r, z = zone.z + Math.sin(a) * zone.r;
        o.position.set(x, forestHeightAt(world, x, z) + 0.6, z); o.rotation.set(0, 0, 0); o.scale.setScalar(1);
        o.updateMatrix(); stakes.current.setMatrixAt(k, o.matrix);
        stakes.current.setColorAt(k, new THREE.Color(zone === world.landing ? "#ffffff" : "#ffd54a"));
      }
    }
    stakes.current.instanceMatrix.needsUpdate = true;
    if (stakes.current.instanceColor) stakes.current.instanceColor.needsUpdate = true;
  }, [world, o]);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current > 0.3) { acc.current = 0; emitAt(bus, chimney, "smoke", [0, 0, 0], 1); } // sawmill chimney
  });
  const sx = at.sign.x - Math.cos(at.sign.h) * 6, sz = at.sign.z + Math.sin(at.sign.h) * 6; // left of the road
  return (
    <>
      <instancedMesh ref={stakes} args={[undefined, undefined, COUNT * 2]} frustumCulled={false}>
        <coneGeometry args={[0.18, 1.2, 4]} /><meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <group position={[at.mill.x, at.mill.y, at.mill.z]} rotation={[0, at.mill.h, 0]}>
        {[-4.4, 4.4].map((x) => <mesh key={x} position={[x, 2.6, -4]} castShadow>{<boxGeometry args={[0.6, 5.2, 0.6]} />}{mat("#7a4a22")}</mesh>)}
        <mesh position={[0, 5.3, -4]} castShadow><boxGeometry args={[9.6, 1.2, 0.5]} />{mat("#2c5f9e")}</mesh>
        <group position={[0, 5.3, -4.3]} rotation={[0, Math.PI, 0]}><Label text="SAWMILL" w={8.4} h={1} bg="#2c5f9e" fg="#ffffff" size={86} /></group>
        <mesh position={[-13, 2.2, 1]} castShadow receiveShadow><boxGeometry args={[9, 4.4, 8]} />{mat("#8a8f96")}</mesh>
        <mesh position={[-13, 4.7, 1]} rotation={[0, 0, 0.1]} castShadow><boxGeometry args={[9.8, 0.5, 8.8]} />{mat("#5a2e22")}</mesh>
        <mesh position={[-16, 6.2, 3]} castShadow><cylinderGeometry args={[0.5, 0.6, 3.6, 7]} />{mat("#555")}</mesh>
        <group ref={chimney} position={[-16, 8.1, 3]} />
        {[0, 1, 2].map((i) => <mesh key={i} position={[-8.4, 0.5 + (i > 1 ? 0.75 : 0), 8 + (i % 2) * 0.1 + (i > 1 ? 0.7 : i * 1.0)]} rotation={[0, Math.PI / 2 + 0.05, 0]} castShadow><cylinderGeometry args={[0.45, 0.45, 5, 7]} />{mat("#9a6632")}</mesh>)}
      </group>
      <group position={[sx, forestHeightAt(world, sx, sz), sz]} rotation={[0, at.sign.h + Math.PI / 2, 0]}>
        {[-1.4, 1.4].map((x) => <mesh key={x} position={[x, 1.2, 0]} castShadow><boxGeometry args={[0.15, 2.4, 0.15]} />{mat("#5a4630")}</mesh>)}
        <group position={[0, 1.9, 0.1]}><Label text="OLD LOGGING RD" w={3.4} h={1.1} size={50} bg="#7a4a22" fg="#f5e6c8" /></group>
      </group>
      <BlockSign world={world} />
    </>
  );
}

/** A sign at the cut block, at the far end of the road. */
function BlockSign({ world }: { world: ForestWorld }) {
  const x = world.landing.x - 10, z = world.landing.z + 4;
  return (
    <group position={[x, forestHeightAt(world, x, z), z]} rotation={[0, 0.5, 0]}>
      {[-1.4, 1.4].map((px) => <mesh key={px} position={[px, 1.2, 0]} castShadow><boxGeometry args={[0.15, 2.4, 0.15]} />{mat("#5a4630")}</mesh>)}
      <group position={[0, 1.9, 0.1]}><Label text="CUT BLOCK" w={3.4} h={1.1} size={64} bg="#ff7a1a" fg="#1a1a1a" /></group>
    </group>
  );
}

const slot = (arr: React.MutableRefObject<(THREE.Mesh | null)[]>, i: number) => (m: THREE.Mesh | null) => { arr.current[i] = m; };
const STACK_AT: Record<ForestMachine, [number, number, number]> = { feller: [0.7, 2.5, -1.0], grader: [0.7, 3.4, -4.1], skidder: [0.55, 2.6, 1.7], logtruck: [1.02, 3, 1.1] };

function ForestVehicleMesh({ v, active, night }: { v: ForestVehicle; active: boolean; night: boolean }) {
  const g = useRef<THREE.Group>(null!), arm = useRef<THREE.Group>(null!), blade = useRef<THREE.Group>(null!), crane = useRef<THREE.Group>(null!);
  const saw = useRef<THREE.Mesh>(null!), marker = useRef<THREE.Mesh>(null!);
  const slots = useRef<(THREE.Mesh | null)[]>([]);
  const bus = useContext(FxCtx);
  const acc = useRef({ smoke: 0, fx: 0 });
  useFrame(({ clock }, delta) => {
    g.current.position.set(v.x, v.y, v.z);
    g.current.rotation.set(0, 0, 0);
    g.current.rotateY(v.heading); g.current.rotateX(v.pitch); g.current.rotateZ(v.roll);
    const t = clock.elapsedTime;
    if (arm.current) arm.current.rotation.x = v.kind === "feller" ? 0.1 + v.work * 0.35 : v.work * 0.4 + Math.sin(t * 5) * 0.08 * v.work; // felling head / grapple dips to the work
    if (saw.current) saw.current.rotation.x += delta * (2 + v.work * 40);
    if (blade.current) blade.current.rotation.x = Math.sin(t * 8) * 0.025 * Math.min(1, Math.abs(v.speed) / 3);
    if (crane.current) crane.current.rotation.y = Math.sin(t * 3) * 0.9 * v.work; // the truck crane swings logs aboard
    slots.current.forEach((m, i) => { if (m) m.visible = i < v.logs; });
    if (marker.current) { marker.current.visible = active; marker.current.position.y = 5 + Math.sin(t * 3) * 0.2; }
    const a = acc.current, running = v.fuel > 0 && !v.tipped, moving = Math.abs(v.speed) > 0.5;
    a.smoke += delta; a.fx += delta;
    if (running && a.smoke > (active ? (moving ? 0.12 : 0.3) : 0.9)) { a.smoke = 0; emitAt(bus, g, "smoke", STACK_AT[v.kind]); }
    if (a.fx > 0.07) {
      a.fx = 0;
      if (v.kind === "feller" && v.work > 0.3) emitAt(bus, g, "sawdust", [0, 1.0, 4.3], 3); // sawdust flies from the cut
      else if (v.kind === "grader" && v.speed > 0.8) { emitAt(bus, g, "dust", [-1.6, 0.2, 1.0]); emitAt(bus, g, "dust", [1.6, 0.2, 1.0]); }
      else if (v.kind === "skidder" && v.work > 0.5) emitAt(bus, g, "dust", [0, 0.2, 3.0], 2);
      else if (v.kind === "logtruck" && Math.abs(v.speed) > 4) emitAt(bus, g, "dust", [1.05, 0.2, -2.0]);
    }
  });
  const paint = PAINT[v.kind];
  const on = active && night;
  return (
    <group ref={g}>
      <mesh ref={marker} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.4, 0.8, 4]} />{mat("#ffffff")}</mesh>
      {v.kind === "feller" && (
        <>
          <Tracks v={v} />
          <mesh position={[0, 1.1, -0.3]} castShadow><boxGeometry args={[1.9, 0.7, 2.4]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.9, -0.2]} castShadow><boxGeometry args={[1.3, 0.9, 1.2]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.38, -0.2]} castShadow><boxGeometry args={[1.5, 0.08, 1.4]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 1.95, 0.41]} s={[1.1, 0.55, 0.04]} />
          <Glass p={[0, 1.95, -0.81]} s={[1.1, 0.55, 0.04]} />
          <Glass p={[0.66, 1.95, -0.2]} s={[0.04, 0.55, 0.9]} />
          <Glass p={[-0.66, 1.95, -0.2]} s={[0.04, 0.55, 0.9]} />
          <Lamp p={[0.6, 1.15, 0.91]} s={[0.28, 0.2, 0.06]} on={on} color="#fff3c4" />
          <Lamp p={[-0.6, 1.15, 0.91]} s={[0.28, 0.2, 0.06]} on={on} color="#fff3c4" />
          <Stack p={[0.7, 1.95, -1.0]} h={1} />
          <Beacon p={[0, 2.42, -0.2]} on={active} />
          <group ref={arm} position={[0, 1.3, 0.9]}>
            <mesh position={[0, 0.3, 1.4]} rotation={[-0.3, 0, 0]} castShadow><boxGeometry args={[0.4, 0.4, 2.6]} />{mat("#276a31")}</mesh>
            <group position={[0, -0.1, 2.7]}>
              <mesh castShadow><boxGeometry args={[0.7, 1.1, 0.6]} />{mat("#2b2b2b")}</mesh>
              <mesh ref={saw} position={[0, -0.2, 0.55]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.75, 0.75, 0.06, 10]} /><meshStandardMaterial color="#c9ced3" metalness={0.8} roughness={0.3} flatShading /></mesh>
            </group>
          </group>
        </>
      )}
      {v.kind === "grader" && (
        <>
          <Wheels v={v} zs={[2.3, -2.0, -3.3]} x={1.15} r={0.75} width={0.55} />
          <mesh position={[0, 1.6, 0.4]} castShadow><boxGeometry args={[0.7, 0.5, 5.6]} />{mat("#3a3a3a")}</mesh>
          <mesh position={[0, 1.3, 3.1]} castShadow><boxGeometry args={[1.1, 0.7, 1]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.55, -2.7]} castShadow><boxGeometry args={[2, 0.6, 4.2]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.4, -2.1]} castShadow><boxGeometry args={[1.8, 1.3, 1.8]} />{mat(paint)}</mesh>
          <mesh position={[0, 3.1, -2.1]} castShadow><boxGeometry args={[2.1, 0.1, 2.1]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 2.5, -1.19]} s={[1.5, 0.7, 0.04]} />
          <Glass p={[0, 2.5, -3.01]} s={[1.5, 0.7, 0.04]} />
          <Glass p={[0.91, 2.5, -2.1]} s={[0.04, 0.7, 1.3]} />
          <Glass p={[-0.91, 2.5, -2.1]} s={[0.04, 0.7, 1.3]} />
          <mesh position={[0, 2.1, -4.3]} castShadow><boxGeometry args={[1.8, 0.9, 1.4]} />{mat("#3a3a3a")}</mesh>
          <Lamp p={[0.5, 1.35, 3.62]} s={[0.28, 0.2, 0.06]} on={on} color="#fff3c4" />
          <Lamp p={[-0.5, 1.35, 3.62]} s={[0.28, 0.2, 0.06]} on={on} color="#fff3c4" />
          <Stack p={[0.7, 3.2, -4.1]} h={1.2} />
          <Beacon p={[0, 3.14, -2.1]} on={active} />
          <group ref={blade} position={[0, 0.75, 1.1]}>
            <mesh rotation={[0, 0.35, 0]} castShadow><boxGeometry args={[3.8, 0.8, 0.18]} />{mat("#6a6a6a")}</mesh>
          </group>
        </>
      )}
      {v.kind === "skidder" && (
        <>
          <Wheels v={v} zs={[1.0, -1.3]} x={1.15} r={0.8} width={0.6} />
          <mesh position={[0, 1.2, 1.0]} castShadow><boxGeometry args={[1.5, 0.8, 1.6]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.95, 0.7]} castShadow><boxGeometry args={[1.4, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.43, 0.7]} castShadow><boxGeometry args={[1.6, 0.08, 1.3]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 2.0, 1.26]} s={[1.2, 0.55, 0.04]} />
          <Glass p={[0.71, 2.0, 0.7]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.71, 2.0, 0.7]} s={[0.04, 0.55, 0.8]} />
          <mesh position={[0, 1.2, -1.2]} castShadow><boxGeometry args={[1.6, 0.8, 1.9]} />{mat("#3a3a3a")}</mesh>
          <Lamp p={[0.5, 1.3, 1.81]} s={[0.28, 0.2, 0.06]} on={on} color="#fff3c4" />
          <Lamp p={[-0.5, 1.3, 1.81]} s={[0.28, 0.2, 0.06]} on={on} color="#fff3c4" />
          <Stack p={[0.55, 2.1, 1.7]} h={0.9} />
          <Beacon p={[0, 2.47, 0.7]} on={active} />
          <group ref={arm} position={[0, 1.8, -2.0]}>
            <mesh position={[0, 0.2, -0.9]} rotation={[0.5, 0, 0]} castShadow><boxGeometry args={[0.3, 0.3, 2]} />{mat("#222")}</mesh>
            <mesh position={[0, -0.5, -1.7]} castShadow><boxGeometry args={[1.1, 0.2, 0.35]} />{mat("#555")}</mesh>
          </group>
          {[-0.45, 0.45, 0].map((x, i) => (
            <mesh key={i} ref={slot(slots, i)} position={[x, 0.45 + (i === 2 ? 0.6 : 0), -3.6]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[LOG_R, LOG_R, LOG_LEN, 7]} />{mat("#8b5a2b")}
            </mesh>
          ))}
        </>
      )}
      {v.kind === "logtruck" && (
        <>
          <Wheels v={v} zs={[-1.9, -0.6, 1.4]} />
          <mesh position={[0, 1.4, 1.7]} castShadow><boxGeometry args={[1.9, 1.3, 1.2]} />{mat(paint)}</mesh>
          <Glass p={[0, 1.65, 2.31]} s={[1.65, 0.6, 0.05]} />
          <Glass p={[0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <mesh position={[0, 1.08, 2.31]}><boxGeometry args={[1.2, 0.3, 0.05]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 0.8, 2.38]} castShadow><boxGeometry args={[2.1, 0.25, 0.15]} />{mat("#2b2b2b")}</mesh>
          <Lamp p={[0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={on} color="#fff3c4" />
          <Lamp p={[-0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={on} color="#fff3c4" />
          <Lamp p={[0.85, 1.0, -3.22]} s={[0.3, 0.2, 0.05]} on={on} color="#ff2a1a" />
          <Lamp p={[-0.85, 1.0, -3.22]} s={[0.3, 0.2, 0.05]} on={on} color="#ff2a1a" />
          <Stack p={[1.02, 2.25, 1.1]} h={1.4} />
          <Stack p={[-1.02, 2.25, 1.1]} h={1.4} />
          <Beacon p={[0, 2.05, 1.7]} on={active} />
          <mesh position={[0, 0.9, -0.7]} castShadow><boxGeometry args={[2.1, 0.3, 5]} />{mat("#333")}</mesh>
          {[-1.8, 0.6].flatMap((z) => [-1.05, 1.05].map((x) => (
            <mesh key={`${x}${z}`} position={[x, 1.7, z]} castShadow><boxGeometry args={[0.12, 1.5, 0.12]} />{mat("#555")}</mesh>
          )))}
          <group ref={crane} position={[0, 1.1, -2.9]}>
            <mesh position={[0, 0.4, 0]} castShadow><boxGeometry args={[0.5, 1, 0.5]} />{mat("#e8b322")}</mesh>
            <mesh position={[0, 1.2, 0.9]} rotation={[0.55, 0, 0]} castShadow><boxGeometry args={[0.3, 0.3, 2.2]} />{mat("#e8b322")}</mesh>
            <mesh position={[0, 1.6, 1.8]} castShadow><boxGeometry args={[0.7, 0.15, 0.3]} />{mat("#444")}</mesh>
          </group>
          {[[-0.8, 1.45], [0, 1.45], [0.8, 1.45], [-0.4, 2.1], [0.4, 2.1], [0, 2.75]].map(([x, y], i) => (
            <mesh key={i} ref={slot(slots, i)} position={[x, y, -0.7]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[LOG_R, LOG_R, LOG_LEN + 0.6, 7]} />{mat(i % 2 ? "#8b5a2b" : "#9a6632")}
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

const WEIGHT: Record<ForestMachine, number> = { feller: 0.9, grader: 0.8, skidder: 0.7, logtruck: 0.6 };
const LAMP: Record<ForestMachine, [number, number, number, number]> = { feller: [0, 1.3, 1.0, 0.6], grader: [0, 1.4, 3.5, 0.5], skidder: [0, 1.3, 1.85, 0.5], logtruck: [0, 1.1, 2.4, 0.7] };
const ROLES: Record<ForestMachine, string> = {
  feller: "saws trees down: blockers on the old road first, then only the marked trees in the cut block count.",
  grader: "levels the ruts just by driving along the old road. Slow going over rough ground.",
  skidder: "drags fallen deadfall logs off the road, hooks felled logs and hauls them to the landing.",
  logtruck: "loads the stack at the landing with its crane, then hauls it to the sawmill. Needs the restored road: it bogs down in the forest.",
};
const CHUNKS = 48;

export default function ForestLevel(props: LevelProps) {
  const game = useMemo(() => createForestGame(props.settings.difficulty), []); // eslint-disable-line react-hooks/exhaustive-deps
  const world = game.world;
  const spec = useMemo<LevelSpec>(() => {
    const chunkOf = world.road.map((r) => Math.min(CHUNKS - 1, Math.floor(r.t * CHUNKS)));
    const tChunk = (x: number, z: number) => Math.min(CHUNKS - 1, Math.floor(nearestOnPath(world.path, x, z).t * CHUNKS));
    const treeChunks = world.trees.map((t) => (t.kind === "blocker" ? tChunk(t.x, t.z) : -1));
    const fallChunks = world.deadfalls.map((d) => tChunk(d.x, d.z));
    return {
      id: "timber-ridge",
      title: "Timber Ridge",
      brief: `Reopen the old logging road, then deliver ${LOG_TARGET} logs from the cut block to the sawmill.`,
      game,
      machines: Object.fromEntries((Object.keys(FOREST_MACHINES) as ForestMachine[]).map((k) => [k, { ...FOREST_MACHINES[k], weight: WEIGHT[k], paint: PAINT[k], lamp: LAMP[k] }])),
      roles: ROLES,
      jobOrder: `1. Clear the blockers on the old road: fell the yellow-taped trees (feller) and drag the fallen logs aside (skidder). 2. Level the rutted road by driving the grader along it. 3. At the cut block (end of the road) fell only the ${LOG_TARGET} trees with orange ribbons. 4. Skid the logs to the landing, load the truck (it holds ${TRUCK_CAPACITY}) and haul to the sawmill at the camp end. Felling unmarked trees gives no log. Steep slopes and ruts tip a loaded truck.`,
      winText: "The sawmill has its logs.",
      par: 600,
      penalties: () => Math.max(0, world.wasted - WASTE_ALLOWANCE),
      extra: () => [["Unmarked trees felled", `${world.wasted}`]],
      step: (input, dt) => stepForestGame(game, input, dt),
      action: () => { const a = currentForestAction(game); return a ? { label: a.label, time: a.time } : null; },
      recover: () => recoverForest(game),
      select: (i) => selectForestVehicle(game, i),
      cycle: (d) => cycleForestVehicle(game, d),
      hint: () => forestHint(game),
      progress: () => forestProgress(world),
      cargo: () => {
        const v = game.vehicles[game.active];
        const stack = `Landing stack: ${world.landing.stack}`;
        if (v.kind === "skidder") return `Grapple ${v.logs}/${SKIDDER_CAPACITY} · ${stack}`;
        if (v.kind === "logtruck") return `Load ${v.logs}/${TRUCK_CAPACITY} · ${stack}`;
        return world.wasted ? `Unmarked trees felled: ${world.wasted}` : "";
      },
      tasks: () => {
        const left = blockersLeft(world), lvl = Math.floor(roadLevelled(world) * 100);
        return [
          ["Road blockers", left ? `${left} of ${blockersTotal(world)} left` : "cleared", left === 0],
          ["Road levelled", `${lvl}%`, world.roadOpen],
          ["Marked trees felled", `${world.felled}/${LOG_TARGET}`, world.felled >= LOG_TARGET],
          ["Logs at landing", `${world.stacked}/${LOG_TARGET}`, world.stacked >= LOG_TARGET],
          ["Delivered to sawmill", `${world.delivered}/${LOG_TARGET}`, world.delivered >= LOG_TARGET],
        ];
      },
      map: () => {
        const rut = new Array<number>(CHUNKS).fill(0), blocked = new Array<boolean>(CHUNKS).fill(false);
        world.road.forEach((r, i) => { const c = chunkOf[i]; rut[c] = Math.max(rut[c], r.rut); });
        world.trees.forEach((t, i) => { if (t.alive && treeChunks[i] >= 0) blocked[treeChunks[i]] = true; });
        world.deadfalls.forEach((d, i) => { if (!d.cleared) blocked[fallChunks[i]] = true; });
        const segs = [];
        for (let c = 0; c < CHUNKS; c++) {
          const a = world.path[Math.round((c / CHUNKS) * (world.path.length - 1))], b = world.path[Math.round(((c + 1) / CHUNKS) * (world.path.length - 1))];
          segs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, color: blocked[c] ? "#d1493b" : rut[c] > 0.5 ? "#5e7a3c" : rut[c] > 0.06 ? "#a08a52" : "#d9c08a" });
        }
        const pump = world.camp.fuel;
        return { segs, pins: [
          { x: world.camp.x, z: world.camp.z, color: "#f2c230", label: "C" }, { x: pump.x, z: pump.z, color: "#ff8a3d", label: "F" },
          { x: world.mill.x, z: world.mill.z, color: "#5aa0e0", label: "M" }, { x: world.landing.x, z: world.landing.z, color: "#ffffff", label: "L" },
          { x: world.block.x, z: world.block.z, color: "#ff7a1a", label: "B" },
        ] };
      },
      scene: <ForestScene game={game} />,
      vehicle: (v: BaseVehicle, active, lamps) => <ForestVehicleMesh v={v as unknown as ForestVehicle} active={active} night={lamps} />,
    };
  }, [game, world]);
  return <LevelShell spec={spec} {...props} />;
}

function ForestScene({ game }: { game: ForestGame }) {
  const world = game.world, bus = useContext(FxCtx);
  return (
    <>
      <Terrain world={world} />
      <Trees world={world} />
      <FallingTrees bus={bus} world={world} />
      <Logs game={game} />
      <Landmarks world={world} />
      <CampScene camp={world.camp} hy={(x, z) => forestHeightAt(world, x, z)} />
    </>
  );
}

