import { useFrame } from "@react-three/fiber";
import { useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import CampScene, { Label } from "./Camp";
import { Beacon, Glass, Lamp, PAINT, Stack, Tracks, Wheels, mat } from "./parts";
import { FxCtx, emitAt } from "./Particles";
import { LevelShell, type BaseVehicle, type LevelProps, type LevelSpec } from "./Shell";
import {
  CELL, HALF, MACHINES, N, TRUCK_CAPACITY, createGame, currentAction, cycleVehicle, heightAt, objectiveHint, pathLength, progress, recomputeHeights, recover,
  roadFrontier, selectVehicle, stepGame,
  type Machine, type Vehicle, type World,
} from "./world";

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

/** Dirt mounds, plus the road's mud holes (sunken puddle, mud rim, warning cone) and the off-road bog patches. */
function Hazards({ world }: { world: World }) {
  const mounds = useRef<THREE.InstancedMesh>(null!), bog = useRef<THREE.InstancedMesh>(null!);
  const puddle = useRef<THREE.InstancedMesh>(null!), rim = useRef<THREE.InstancedMesh>(null!), cone = useRef<THREE.InstancedMesh>(null!), patch = useRef<THREE.InstancedMesh>(null!);
  const moundCells = useMemo(() => world.road.filter((r) => r.kind === "mound"), [world]);
  const holes = useMemo(() => world.road.filter((r) => r.kind === "mud"), [world]);
  const bogCells = useMemo(() => world.mudCells.filter((c) => !holes.some((h) => h.cell === c)), [world, holes]);
  const anim = useMemo(() => new Float32Array(holes.length), [holes]); // 0 = open hole, 1 = filled in
  const o = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    bogCells.forEach((c, i) => {
      const x = -HALF + ((c % N) + 0.5) * CELL, z = -HALF + (Math.floor(c / N) + 0.5) * CELL;
      o.position.set(x, heightAt(world, x, z) + 0.05, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
      o.updateMatrix(); bog.current.setMatrixAt(i, o.matrix);
    });
    bog.current.instanceMatrix.needsUpdate = true;
  }, [world, bogCells, o]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (world.dirtyHazards) {
      world.dirtyHazards = false;
      moundCells.forEach((r, i) => {
        const s = r.kind === "mound" ? 0.5 + r.mound * 0.35 : 0;
        o.position.set(r.x, heightAt(world, r.x, r.z), r.z); o.rotation.set(0, i * 1.7, 0); o.scale.set(s * 1.3, s, s * 1.3);
        o.updateMatrix(); mounds.current.setMatrixAt(i, o.matrix);
      });
      mounds.current.instanceMatrix.needsUpdate = true;
    }
    holes.forEach((r, i) => {
      if (r.kind !== "mud") anim[i] = Math.min(1, anim[i] + dt * 1.6);
      const open = 1 - anim[i], y = heightAt(world, r.x, r.z);
      o.rotation.set(0, i, 0);
      o.position.set(r.x, y + 0.31, r.z); o.scale.set(open, 1, open); o.updateMatrix(); puddle.current.setMatrixAt(i, o.matrix);
      o.position.set(r.x, y + 0.14, r.z); o.scale.set(1 - anim[i] * 0.3, 1 - anim[i] * 0.85, 1 - anim[i] * 0.3); o.updateMatrix(); rim.current.setMatrixAt(i, o.matrix);
      o.position.set(r.x + 1.3, y + 0.05, r.z - 1.3); o.rotation.set(0, 0, 0); o.scale.setScalar(open); o.updateMatrix(); cone.current.setMatrixAt(i, o.matrix);
      o.position.set(r.x, y + 0.1, r.z); o.rotation.set(0, i * 2, 0); o.scale.set(anim[i] * 1.2, 1, anim[i] * 1.2); o.updateMatrix(); patch.current.setMatrixAt(i, o.matrix);
    });
    for (const m of [puddle, rim, cone, patch]) m.current.instanceMatrix.needsUpdate = true;
  });
  const nHoles = Math.max(1, holes.length);
  return (
    <>
      <instancedMesh ref={mounds} args={[undefined, undefined, Math.max(1, moundCells.length)]} castShadow receiveShadow>
        <coneGeometry args={[1.2, 1.4, 7]} /><meshStandardMaterial color="#7a5533" flatShading />
      </instancedMesh>
      <instancedMesh ref={bog} args={[undefined, undefined, Math.max(1, bogCells.length)]} frustumCulled={false}>
        <boxGeometry args={[CELL * 1.05, 0.06, CELL * 1.05]} /><meshStandardMaterial color="#6e5a3f" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={puddle} args={[undefined, undefined, nHoles]} frustumCulled={false}>
        <cylinderGeometry args={[1.3, 1.3, 0.06, 10]} /><meshStandardMaterial color="#120b07" roughness={0.04} metalness={0.7} />
      </instancedMesh>
      <instancedMesh ref={rim} args={[undefined, undefined, nHoles]} frustumCulled={false} castShadow>
        <cylinderGeometry args={[1.55, 1.95, 0.3, 10]} /><meshStandardMaterial color="#5a4128" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={cone} args={[undefined, undefined, nHoles]} frustumCulled={false} castShadow>
        <coneGeometry args={[0.32, 0.9, 6]} /><meshStandardMaterial color="#ff6a1a" flatShading />
      </instancedMesh>
      <instancedMesh ref={patch} args={[undefined, undefined, nHoles]} frustumCulled={false} receiveShadow>
        <cylinderGeometry args={[1.5, 1.6, 0.14, 9]} /><meshStandardMaterial color="#8a6a45" roughness={1} flatShading />
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

const STACK_AT: Record<Machine, [number, number, number]> = { dozer: [0.5, 2.4, 0.6], excavator: [0.7, 2.5, -1.3], truck: [1.02, 3, 1.1], paver: [-0.55, 2.4, 0.5] };

function VehicleMesh({ v, active, night }: { v: Vehicle; active: boolean; night: boolean }) {
  const g = useRef<THREE.Group>(null!);
  const arm = useRef<THREE.Group>(null!), blade = useRef<THREE.Group>(null!), bed = useRef<THREE.Group>(null!), roller = useRef<THREE.Group>(null!);
  const load = useRef<THREE.Mesh>(null!);
  const marker = useRef<THREE.Mesh>(null!);
  const bus = useContext(FxCtx);
  const acc = useRef({ smoke: 0, dust: 0 });
  useFrame(({ clock }, dt) => {
    g.current.position.set(v.x, v.y, v.z);
    g.current.rotation.set(0, 0, 0);
    g.current.rotateY(v.heading); g.current.rotateX(v.pitch); g.current.rotateZ(v.roll);
    if (arm.current) arm.current.rotation.x = -0.25 + Math.sin(clock.elapsedTime * 6) * 0.35 * v.work + (v.dirt + v.rock > 0 ? -0.4 : 0);
    if (blade.current) blade.current.rotation.x = 0.2 + Math.sin(clock.elapsedTime * 9) * 0.03 * Math.min(1, Math.abs(v.speed) / 3);
    if (bed.current) bed.current.rotation.x = -v.work * 0.85; // the dump truck tips its bed while unloading
    if (roller.current) roller.current.rotation.x += (v.speed * dt) / 0.35;
    if (load.current) {
      const f = (v.dirt + v.rock) / (v.kind === "truck" ? TRUCK_CAPACITY : 1);
      load.current.visible = f > 0;
      load.current.scale.set(1, Math.max(0.01, f * (v.kind === "truck" ? 1 - 0.5 * v.work : 1)), 1);
      if (v.kind === "truck") load.current.position.z = 1.6 - v.work * 1.1; // the load slides out the back
    }
    if (marker.current) { marker.current.visible = active; marker.current.position.y = 4.6 + Math.sin(clock.elapsedTime * 3) * 0.2; }
    // exhaust smoke, and dust / steam where the machine meets the work
    const a = acc.current, running = v.fuel > 0 && !v.tipped, moving = Math.abs(v.speed) > 0.5;
    a.smoke += dt; a.dust += dt;
    if (running && a.smoke > (active ? (moving ? 0.12 : 0.3) : 0.9)) { a.smoke = 0; emitAt(bus, g, "smoke", STACK_AT[v.kind]); }
    if (a.dust > 0.1) {
      a.dust = 0;
      if (v.kind === "dozer" && v.speed > 0.8) { emitAt(bus, g, "dust", [-1.2, 0.2, 2.4]); emitAt(bus, g, "dust", [1.2, 0.2, 2.4]); }
      else if (v.kind === "excavator" && v.work > 0.5) emitAt(bus, g, "dust", [0.4, 0, 4.2], 2);
      else if (v.kind === "truck" && v.work > 0.6) emitAt(bus, g, "dirt", [0, 1.3, -2.6], 2);
      else if (v.kind === "truck" && Math.abs(v.speed) > 4) emitAt(bus, g, "dust", [1.05, 0.2, -1.3]);
      else if (v.kind === "paver" && v.speed > 0.5) emitAt(bus, g, "steam", [0, 1.5, 1.5]);
    }
  });
  const paint = PAINT[v.kind];
  return (
    <group ref={g}>
      <mesh ref={marker} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.4, 0.8, 4]} />{mat("#ffffff")}</mesh>
      {v.kind === "dozer" && (
        <>
          <Tracks v={v} />
          <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.46, -0.2]}><boxGeometry args={[0.4, 0.02, 2]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.35, -0.6]} castShadow><boxGeometry args={[1.45, 0.08, 1.35]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 1.9, -0.04]} s={[1, 0.55, 0.04]} />
          <Glass p={[0, 1.9, -1.16]} s={[1, 0.55, 0.04]} />
          <Glass p={[0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Lamp p={[0.55, 1.15, 1.01]} s={[0.28, 0.2, 0.06]} on={active && night} color="#fff3c4" />
          <Lamp p={[-0.55, 1.15, 1.01]} s={[0.28, 0.2, 0.06]} on={active && night} color="#fff3c4" />
          <Stack p={[0.5, 1.9, 0.6]} />
          <Beacon p={[0, 2.39, -0.6]} on={active} />
          <group ref={blade} position={[0, 0.55, 2.1]}><mesh castShadow><boxGeometry args={[3.2, 1, 0.25]} />{mat("#9a7414")}</mesh></group>
        </>
      )}
      {v.kind === "excavator" && (
        <>
          <Tracks v={v} />
          <mesh position={[0, 1.1, -0.3]} castShadow><boxGeometry args={[1.9, 0.7, 2.6]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.1, -1.75]} castShadow><boxGeometry args={[1.8, 0.75, 0.5]} />{mat("#3a3a3a")}</mesh>
          <mesh position={[-0.45, 1.9, 0.2]} castShadow><boxGeometry args={[0.9, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[-0.45, 2.38, 0.2]} castShadow><boxGeometry args={[1.05, 0.07, 1.25]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[-0.45, 1.95, 0.76]} s={[0.72, 0.6, 0.04]} />
          <Glass p={[-0.91, 1.95, 0.2]} s={[0.04, 0.6, 0.85]} />
          <Glass p={[0.01, 1.95, 0.2]} s={[0.04, 0.6, 0.85]} />
          <Lamp p={[-0.75, 2.46, 0.7]} s={[0.22, 0.14, 0.1]} on={active && night} color="#fff3c4" />
          <Lamp p={[-0.15, 2.46, 0.7]} s={[0.22, 0.14, 0.1]} on={active && night} color="#fff3c4" />
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
          <Wheels v={v} />
          <mesh position={[0, 1.4, 1.7]} castShadow><boxGeometry args={[1.9, 1.3, 1.2]} />{mat(paint)}</mesh>
          <Glass p={[0, 1.65, 2.31]} s={[1.65, 0.6, 0.05]} />
          <Glass p={[0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <mesh position={[0, 1.08, 2.31]}><boxGeometry args={[1.2, 0.3, 0.05]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 0.8, 2.38]} castShadow><boxGeometry args={[2.1, 0.25, 0.15]} />{mat("#2b2b2b")}</mesh>
          <Lamp p={[0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={active && night} color="#fff3c4" />
          <Lamp p={[-0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={active && night} color="#fff3c4" />
          <Lamp p={[0.85, 1.0, -2.22]} s={[0.3, 0.2, 0.05]} on={active && night} color="#ff2a1a" />
          <Lamp p={[-0.85, 1.0, -2.22]} s={[0.3, 0.2, 0.05]} on={active && night} color="#ff2a1a" />
          <Stack p={[1.02, 2.25, 1.1]} h={1.4} />
          <Stack p={[-1.02, 2.25, 1.1]} h={1.4} />
          <Beacon p={[0, 2.05, 1.7]} on={active} />
          <mesh position={[0, 0.9, -0.2]} castShadow><boxGeometry args={[2.1, 0.3, 4]} />{mat("#333")}</mesh>
          <group ref={bed} position={[0, 1.05, -2.1]}>
            <mesh position={[0, 0.5, 1.6]} castShadow><boxGeometry args={[2.2, 1, 3]} />{mat("#a8a8a8")}</mesh>
            <mesh ref={load} position={[0, 1.0, 1.6]}><boxGeometry args={[2, 0.8, 2.8]} />{mat("#6b4a2b")}</mesh>
          </group>
        </>
      )}
      {v.kind === "paver" && (
        <>
          <Tracks v={v} />
          <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.46, -0.2]}><boxGeometry args={[0.4, 0.02, 2]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.35, -0.6]} castShadow><boxGeometry args={[1.45, 0.08, 1.35]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 1.9, -0.04]} s={[1, 0.55, 0.04]} />
          <Glass p={[0, 1.9, -1.16]} s={[1, 0.55, 0.04]} />
          <Glass p={[0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.61, 1.9, -0.6]} s={[0.04, 0.55, 0.8]} />
          <Lamp p={[0.7, 1.15, 0.99]} s={[0.28, 0.2, 0.06]} on={active && night} color="#fff3c4" />
          <Lamp p={[-0.7, 1.15, 0.99]} s={[0.28, 0.2, 0.06]} on={active && night} color="#fff3c4" />
          <Stack p={[-0.55, 1.9, 0.5]} h={0.8} />
          <Beacon p={[0, 2.39, -0.6]} on={active} />
          <mesh position={[0, 0.9, 1.5]} castShadow><boxGeometry args={[2, 0.9, 0.9]} />{mat("#555")}</mesh>
          <mesh position={[0, 1.38, 1.5]}><boxGeometry args={[2, 0.06, 0.9]} />{mat("#e8b322")}</mesh>
          <group ref={roller} position={[0, 0.3, -1.9]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.35, 0.35, 3, 8]} />{mat("#444")}</mesh>
            <mesh><boxGeometry args={[3.02, 0.55, 0.1]} />{mat("#6a6a6a")}</mesh>
          </group>
        </>
      )}
    </group>
  );
}

/** Flags and light beams planted where the unbroken graded and paved stretches end. */
function FrontierFlag({ world, which }: { world: World; which: "graded" | "paved" }) {
  const root = useRef<THREE.Group>(null!), cloth = useRef<THREE.Group>(null!);
  const n = useRef(0);
  const color = which === "graded" ? "#f2c230" : "#f5f5f5";
  useFrame(({ clock }) => {
    if (n.current++ % 8 === 0) {
      const f = roadFrontier(world)[which];
      root.current.position.set(f.x + 4.2, heightAt(world, f.x + 4.2, f.z), f.z);
    }
    cloth.current.rotation.y = Math.sin(clock.elapsedTime * 3 + (which === "graded" ? 0 : 1.5)) * 0.3;
  });
  return (
    <group ref={root}>
      <mesh position={[0, 2.5, 0]} castShadow><cylinderGeometry args={[0.07, 0.09, 5, 6]} />{mat("#c9ced3")}</mesh>
      <group ref={cloth} position={[0, 4.3, 0]}>
        <group position={[0.9, 0, 0]}><Label text={which === "graded" ? "GRADED" : "PAVED"} w={1.8} h={0.8} bg={color} size={72} /></group>
      </group>
      <mesh position={[0, 8, 0]}><cylinderGeometry args={[0.12, 0.12, 16, 6]} /><meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} /></mesh>
    </group>
  );
}

/** A distance post every 50 m along the route. */
function DistancePosts({ world }: { world: World }) {
  const posts = useMemo(() => {
    const L = pathLength(world), out: { x: number; z: number; m: number }[] = [];
    for (let m = 50; m < L; m += 50) {
      const i = Math.round((m / L) * (world.path.length - 1)), p = world.path[i];
      out.push({ x: p.x + 4.6, z: p.z, m });
    }
    return out;
  }, [world]);
  return (
    <>
      {posts.map((p) => (
        <group key={p.m} position={[p.x, heightAt(world, p.x, p.z), p.z]}>
          <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[0.12, 1.8, 0.12]} />{mat("#e8e8e8")}</mesh>
          <group position={[0, 2.05, 0.1]} rotation={[-0.5, 0, 0]}><Label text={`${p.m} m`} w={1.4} h={0.6} bg="#2a6fb0" fg="#ffffff" size={80} /></group>
        </group>
      ))}
    </>
  );
}

const WEIGHT: Record<Machine, number> = { dozer: 0.9, excavator: 0.8, truck: 0.6, paver: 0.7 };
const LAMP: Record<Machine, [number, number, number, number]> = { dozer: [0, 1.3, 1.1, 0.55], excavator: [-0.45, 2.45, 0.8, 0.3], truck: [0, 1.1, 2.4, 0.7], paver: [0, 1.3, 1.1, 0.7] };
const ROLES: Record<Machine, string> = {
  dozer: "pushes small rocks off the road and grades dirt flat.",
  excavator: "breaks boulders, digs mounds, fills mud holes (needs dirt from a mound first), loads the truck.",
  truck: "tips dirt into mud holes or dumps loads off-road.",
  paver: "lays asphalt on graded dirt.",
};

const CHUNKS = 48;

export default function RoadLevel(props: LevelProps) {
  const game = useMemo(() => createGame(props.settings.difficulty), []); // eslint-disable-line react-hooks/exhaustive-deps
  const world = game.world;
  const spec = useMemo<LevelSpec>(() => {
    const chunkOf = world.road.map((r) => Math.min(CHUNKS - 1, Math.floor(r.t * CHUNKS)));
    return {
      id: "pass-road",
      title: "Pass Road",
      brief: "Build the road up the mountain. Get 95% of it paved to open the pass.",
      game,
      machines: Object.fromEntries((Object.keys(MACHINES) as Machine[]).map((k) => [k, { ...MACHINES[k], weight: WEIGHT[k], paint: PAINT[k], lamp: LAMP[k] }])),
      roles: ROLES,
      jobOrder: "1. Clear boulders, rocks and dirt mounds. 2. Fill each mud hole: dig dirt from a mound with the excavator, then hold Space with the hole in front of the bucket. 3. Drive the bulldozer over the road to grade it. 4. Drive the paver over graded dirt. Flags show how far the graded and paved stretches reach. Watch steep edges: loaded trucks tip easily and bog down in mud.",
      winText: "The pass is open.",
      par: 660,
      penalties: () => 0,
      extra: () => [],
      step: (input, dt) => stepGame(game, input, dt),
      action: () => { const a = currentAction(game); return a ? { label: a.label, time: a.time } : null; },
      recover: () => recover(game),
      select: (i) => selectVehicle(game, i),
      cycle: (d) => cycleVehicle(game, d),
      hint: () => objectiveHint(game),
      progress: () => progress(world).paved,
      cargo: () => {
        const v = game.vehicles[game.active];
        return v.kind === "truck" ? `Load ${v.dirt + v.rock}/${TRUCK_CAPACITY} (${v.dirt} dirt, ${v.rock} rock)` : v.kind === "excavator" ? (v.dirt ? "Bucket: dirt (find a mud hole)" : v.rock ? "Bucket: rock" : "Bucket: empty") : "";
      },
      tasks: () => {
        const p = progress(world), f = roadFrontier(world);
        return [
          ["Rocks off the road", p.rocksOnRoad ? `${p.rocksOnRoad} left` : "done", !p.rocksOnRoad],
          ["Dirt mounds dug", p.mounds ? `${p.mounds} left` : "done", !p.mounds],
          ["Mud holes filled", p.mud ? `${p.mud} left` : "done", !p.mud],
          ["Graded", `${Math.floor(p.graded * 100)}% · ${Math.round(f.graded.m)} m`, p.graded > 0.95],
          ["Paved", `${Math.floor(p.paved * 100)}% · ${Math.round(f.paved.m)} m`, p.paved >= 0.95],
        ];
      },
      map: () => {
        const stage = new Array<number>(CHUNKS).fill(3), blocked = new Array<boolean>(CHUNKS).fill(false), seen = new Array<boolean>(CHUNKS).fill(false);
        world.road.forEach((r, i) => {
          const c = chunkOf[i];
          seen[c] = true; stage[c] = Math.min(stage[c], r.stage);
          if (r.kind !== "ok") blocked[c] = true;
        });
        const segs = [];
        for (let c = 0; c < CHUNKS; c++) {
          const a = world.path[Math.round((c / CHUNKS) * (world.path.length - 1))], b = world.path[Math.round(((c + 1) / CHUNKS) * (world.path.length - 1))];
          segs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, color: blocked[c] && stage[c] < 3 ? "#d1493b" : stage[c] >= 3 ? "#9aa0a8" : stage[c] === 2 ? "#e0c28c" : "#8a6a45" });
        }
        const end = world.path[world.path.length - 1], pump = world.camp.fuel;
        return { segs, pins: [{ x: world.camp.x, z: world.camp.z, color: "#f2c230", label: "C" }, { x: pump.x, z: pump.z, color: "#ff8a3d", label: "F" }, { x: end.x, z: end.z, color: "#ffffff", label: "S" }] };
      },
      scene: (
        <>
          <Terrain world={world} />
          <RoadWork world={world} />
          <Hazards world={world} />
          <Rocks world={world} />
          <Scenery world={world} />
          <CampScene camp={world.camp} hy={(x, z) => heightAt(world, x, z)} />
          <FrontierFlag world={world} which="graded" />
          <FrontierFlag world={world} which="paved" />
          <DistancePosts world={world} />
        </>
      ),
      vehicle: (v: BaseVehicle, active, lamps) => <VehicleMesh v={v as Vehicle} active={active} night={lamps} />,
    };
  }, [game, world]);
  return <LevelShell spec={spec} {...props} />;
}
