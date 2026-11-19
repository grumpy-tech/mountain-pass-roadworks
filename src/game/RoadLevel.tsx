import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Beacon, Glass, HeadSpot, Lamp, PAINT, Stack, Tracks, Wheels, mat } from "./parts";
import { LevelShell, type BaseVehicle, type LevelProps, type LevelSpec } from "./Shell";
import {
  CELL, HALF, MACHINES, N, TRUCK_CAPACITY, createGame, currentAction, cycleVehicle, heightAt, objectiveHint, progress, recomputeHeights, recover,
  selectVehicle, stepGame,
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

function VehicleMesh({ v, active, night }: { v: Vehicle; active: boolean; night: boolean }) {
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
  const spot = ({ dozer: [0, 1.3, 1.1], excavator: [-0.45, 2.4, 0.8], truck: [0, 1.1, 2.4], paver: [0, 1.3, 1.1] } as Record<Machine, [number, number, number]>)[v.kind];
  return (
    <group ref={g}>
      <mesh ref={marker} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.4, 0.8, 4]} />{mat("#ffffff")}</mesh>
      <HeadSpot p={spot} on={active && night} />
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

const WEIGHT: Record<Machine, number> = { dozer: 0.9, excavator: 0.8, truck: 0.6, paver: 0.7 };
const ROLES: Record<Machine, string> = {
  dozer: "pushes small rocks off the road and grades dirt flat.",
  excavator: "breaks boulders, digs mounds, loads the truck.",
  truck: "fills mud holes or dumps loads off-road.",
  paver: "lays asphalt on graded dirt.",
};

export default function RoadLevel(props: LevelProps) {
  const game = useMemo(() => createGame(), []);
  const world = game.world;
  const spec = useMemo<LevelSpec>(() => ({
    id: "pass-road",
    title: "Pass Road",
    brief: "Build the road up the mountain. Get 95% of it paved to open the pass.",
    game,
    machines: Object.fromEntries((Object.keys(MACHINES) as Machine[]).map((k) => [k, { ...MACHINES[k], weight: WEIGHT[k], paint: PAINT[k] }])),
    roles: ROLES,
    jobOrder: "1. Clear rocks and dirt mounds, fill mud holes. 2. Drive the bulldozer over the road to grade it. 3. Drive the paver over graded dirt. Watch steep edges: loaded trucks tip easily and bog down in mud.",
    winText: "The pass is open.",
    step: (input, dt) => stepGame(game, input, dt),
    action: () => { const a = currentAction(game); return a ? { label: a.label, time: a.time } : null; },
    recover: () => recover(game),
    select: (i) => selectVehicle(game, i),
    cycle: (d) => cycleVehicle(game, d),
    hint: () => objectiveHint(game),
    progress: () => progress(world).paved,
    cargo: () => {
      const v = game.vehicles[game.active];
      return v.kind === "truck" ? `Load ${v.dirt + v.rock}/${TRUCK_CAPACITY} (${v.dirt} dirt, ${v.rock} rock)` : v.kind === "excavator" ? (v.dirt ? "Bucket: dirt" : v.rock ? "Bucket: rock" : "Bucket: empty") : "";
    },
    tasks: () => {
      const p = progress(world);
      return [
        ["Rocks off the road", p.rocksOnRoad ? `${p.rocksOnRoad} left` : "done", !p.rocksOnRoad],
        ["Dirt mounds dug", p.mounds ? `${p.mounds} left` : "done", !p.mounds],
        ["Mud holes filled", p.mud ? `${p.mud} left` : "done", !p.mud],
        ["Graded", `${Math.floor(p.graded * 100)}%`, p.graded > 0.95],
        ["Paved", `${Math.floor(p.paved * 100)}%`, p.paved >= 0.95],
      ];
    },
    scene: (
      <>
        <Terrain world={world} />
        <RoadWork world={world} />
        <Hazards world={world} />
        <Rocks world={world} />
        <Scenery world={world} />
      </>
    ),
    vehicle: (v: BaseVehicle, active, night) => <VehicleMesh v={v as Vehicle} active={active} night={night} />,
  }), [game, world]);
  return <LevelShell spec={spec} {...props} />;
}
