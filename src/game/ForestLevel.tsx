import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  FOREST_MACHINES, LOG_TARGET, SKIDDER_CAPACITY, TRUCK_CAPACITY,
  createForestGame, currentForestAction, cycleForestVehicle, forestHeightAt, forestHint, forestProgress, recoverForest, selectForestVehicle,
  stepForestGame, type ForestMachine, type ForestVehicle, type ForestWorld,
} from "./forest";
import { Beacon, Glass, HeadSpot, Lamp, PAINT, Stack, Tracks, mat } from "./parts";
import { LevelShell, type BaseVehicle, type LevelProps, type LevelSpec } from "./Shell";
import { CELL, N } from "./world";

function Terrain({ world }: { world: ForestWorld }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(N * CELL, N * CELL, N, N);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) pos.setY(v, world.heights[v]);
    g.setAttribute("color", new THREE.BufferAttribute(world.colors, 3));
    g.computeVertexNormals();
    return g;
  }, [world]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

function Trees({ world }: { world: ForestWorld }) {
  const trunk = useRef<THREE.InstancedMesh>(null!), low = useRef<THREE.InstancedMesh>(null!), high = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    if (!world.dirtyTrees) return;
    world.dirtyTrees = false;
    world.trees.forEach((t, i) => {
      const y = forestHeightAt(world, t.x, t.z), k = t.alive ? t.s : 0;
      o.rotation.set(0, 0, 0); o.scale.setScalar(k);
      o.position.set(t.x, y + 0.6 * k, t.z); o.updateMatrix(); trunk.current.setMatrixAt(i, o.matrix);
      o.rotation.y = i;
      o.position.set(t.x, y + 2.3 * k, t.z); o.updateMatrix(); low.current.setMatrixAt(i, o.matrix);
      o.position.set(t.x, y + 4 * k, t.z); o.updateMatrix(); high.current.setMatrixAt(i, o.matrix);
    });
    for (const m of [trunk, low, high]) m.current.instanceMatrix.needsUpdate = true;
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
    </>
  );
}

const LOG_R = 0.38, LOG_LEN = 4;

function Logs({ world }: { world: ForestWorld }) {
  const ground = useRef<THREE.InstancedMesh>(null!), pile = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []);
  const shown = useRef(-1);
  const PILE = 36;
  useFrame(() => {
    if (world.dirtyLogs) {
      world.dirtyLogs = false;
      o.rotation.order = "YXZ";
      for (let i = 0; i < world.trees.length; i++) {
        const l = world.logs[i];
        if (l) { o.position.set(l.x, forestHeightAt(world, l.x, l.z) + LOG_R, l.z); o.rotation.set(Math.PI / 2, l.heading, 0); o.scale.set(1, 1, 1); }
        else o.scale.setScalar(0);
        o.updateMatrix(); ground.current.setMatrixAt(i, o.matrix);
      }
      ground.current.instanceMatrix.needsUpdate = true;
    }
    const stack = Math.min(PILE, world.landing.stack);
    if (shown.current !== stack) { // the landing pile: rows of 6, stacked in layers
      shown.current = stack;
      const bx = world.landing.x + 7.5, bz = world.landing.z - 2, by = forestHeightAt(world, bx, bz);
      o.rotation.order = "YXZ";
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
      <instancedMesh ref={ground} args={[undefined, undefined, Math.max(1, world.trees.length)]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[LOG_R, LOG_R, LOG_LEN, 7]} />{mat("#8b5a2b")}
      </instancedMesh>
      <instancedMesh ref={pile} args={[undefined, undefined, 36]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[LOG_R, LOG_R, LOG_LEN, 7]} />{mat("#9a6632")}
      </instancedMesh>
    </>
  );
}

/** Stakes around the landing and the mill yard, plus the mill gate and shed. */
function Landmarks({ world }: { world: ForestWorld }) {
  const stakes = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []);
  const mill = useMemo(() => {
    const p = world.path, a = p[p.length - 4], b = p[p.length - 1];
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    return { x: b.x, z: b.z, heading, y: forestHeightAt(world, b.x, b.z) };
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
  return (
    <>
      <instancedMesh ref={stakes} args={[undefined, undefined, COUNT * 2]} frustumCulled={false}>
        <coneGeometry args={[0.18, 1.2, 4]} /><meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <group position={[mill.x, mill.y, mill.z]} rotation={[0, mill.heading, 0]}>
        {[-4.2, 4.2].map((x) => <mesh key={x} position={[x, 2.5, 6]} castShadow>{<boxGeometry args={[0.6, 5, 0.6]} />}{mat("#7a4a22")}</mesh>)}
        <mesh position={[0, 5.2, 6]} castShadow><boxGeometry args={[9.6, 0.7, 0.7]} />{mat("#c8392b")}</mesh>
        <mesh position={[11, 2, 4]} castShadow><boxGeometry args={[9, 4, 7]} />{mat("#8a8f96")}</mesh>
        <mesh position={[11, 4.5, 4]} rotation={[0, 0, 0.12]} castShadow><boxGeometry args={[9.6, 0.5, 7.6]} />{mat("#5a2e22")}</mesh>
      </group>
    </>
  );
}

const slot = (arr: React.MutableRefObject<(THREE.Mesh | null)[]>, i: number) => (m: THREE.Mesh | null) => { arr.current[i] = m; };

function ForestVehicleMesh({ v, active, night }: { v: ForestVehicle; active: boolean; night: boolean }) {
  const g = useRef<THREE.Group>(null!), arm = useRef<THREE.Group>(null!), saw = useRef<THREE.Mesh>(null!), marker = useRef<THREE.Mesh>(null!);
  const slots = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }, delta) => {
    g.current.position.set(v.x, v.y, v.z);
    g.current.rotation.set(0, 0, 0);
    g.current.rotateY(v.heading); g.current.rotateX(v.pitch); g.current.rotateZ(v.roll);
    if (arm.current) arm.current.rotation.x = v.kind === "feller" ? 0.1 + v.work * 0.35 : -0.15 + Math.sin(clock.elapsedTime * 5) * 0.1 * v.work;
    if (saw.current) saw.current.rotation.x += delta * (2 + v.work * 40);
    slots.current.forEach((m, i) => { if (m) m.visible = i < v.logs; });
    if (marker.current) { marker.current.visible = active; marker.current.position.y = 5 + Math.sin(clock.elapsedTime * 3) * 0.2; }
  });
  const paint = PAINT[v.kind];
  const spot = ({ feller: [0, 1.3, 1.0], skidder: [0, 1.6, 1.6], logtruck: [0, 1.1, 2.4] } as Record<ForestMachine, [number, number, number]>)[v.kind];
  return (
    <group ref={g}>
      <mesh ref={marker} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.4, 0.8, 4]} />{mat("#ffffff")}</mesh>
      <HeadSpot p={spot} on={active && night} />
      {v.kind === "feller" && (
        <>
          <Tracks />
          <mesh position={[0, 1.1, -0.3]} castShadow><boxGeometry args={[1.9, 0.7, 2.4]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.9, -0.2]} castShadow><boxGeometry args={[1.3, 0.9, 1.2]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.38, -0.2]} castShadow><boxGeometry args={[1.5, 0.08, 1.4]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 1.95, 0.41]} s={[1.1, 0.55, 0.04]} />
          <Glass p={[0, 1.95, -0.81]} s={[1.1, 0.55, 0.04]} />
          <Glass p={[0.66, 1.95, -0.2]} s={[0.04, 0.55, 0.9]} />
          <Glass p={[-0.66, 1.95, -0.2]} s={[0.04, 0.55, 0.9]} />
          <Lamp p={[0.6, 1.15, 0.91]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[-0.6, 1.15, 0.91]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
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
      {v.kind === "skidder" && (
        <>
          {[-1.15, 1.15].flatMap((x) => [1.0, -1.3].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.8, z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.8, 0.8, 0.6, 9]} />{mat("#222")}</mesh>
          )))}
          <mesh position={[0, 1.2, 1.0]} castShadow><boxGeometry args={[1.5, 0.8, 1.6]} />{mat(paint)}</mesh>
          <mesh position={[0, 1.95, 0.7]} castShadow><boxGeometry args={[1.4, 0.9, 1.1]} />{mat(paint)}</mesh>
          <mesh position={[0, 2.43, 0.7]} castShadow><boxGeometry args={[1.6, 0.08, 1.3]} />{mat("#2b2b2b")}</mesh>
          <Glass p={[0, 2.0, 1.26]} s={[1.2, 0.55, 0.04]} />
          <Glass p={[0.71, 2.0, 0.7]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.71, 2.0, 0.7]} s={[0.04, 0.55, 0.8]} />
          <mesh position={[0, 1.2, -1.2]} castShadow><boxGeometry args={[1.6, 0.8, 1.9]} />{mat("#3a3a3a")}</mesh>
          <Lamp p={[0.5, 1.3, 1.81]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[-0.5, 1.3, 1.81]} s={[0.28, 0.2, 0.06]} on={active} color="#fff3c4" />
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
          {[-1.05, 1.05].flatMap((x) => [-1.9, -0.6, 1.4].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.5, z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.45, 8]} />{mat("#222")}</mesh>
          )))}
          <mesh position={[0, 1.4, 1.7]} castShadow><boxGeometry args={[1.9, 1.3, 1.2]} />{mat(paint)}</mesh>
          <Glass p={[0, 1.65, 2.31]} s={[1.65, 0.6, 0.05]} />
          <Glass p={[0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <Glass p={[-0.96, 1.65, 1.75]} s={[0.04, 0.55, 0.8]} />
          <mesh position={[0, 1.08, 2.31]}><boxGeometry args={[1.2, 0.3, 0.05]} />{mat("#1a1a1a")}</mesh>
          <mesh position={[0, 0.8, 2.38]} castShadow><boxGeometry args={[2.1, 0.25, 0.15]} />{mat("#2b2b2b")}</mesh>
          <Lamp p={[0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[-0.7, 1.08, 2.33]} s={[0.3, 0.22, 0.06]} on={active} color="#fff3c4" />
          <Lamp p={[0.85, 1.0, -3.22]} s={[0.3, 0.2, 0.05]} on={active} color="#ff2a1a" />
          <Lamp p={[-0.85, 1.0, -3.22]} s={[0.3, 0.2, 0.05]} on={active} color="#ff2a1a" />
          <Stack p={[1.02, 2.25, 1.1]} h={1.4} />
          <Stack p={[-1.02, 2.25, 1.1]} h={1.4} />
          <Beacon p={[0, 2.05, 1.7]} on={active} />
          <mesh position={[0, 0.9, -0.7]} castShadow><boxGeometry args={[2.1, 0.3, 5]} />{mat("#333")}</mesh>
          {[-1.8, 0.6].flatMap((z) => [-1.05, 1.05].map((x) => (
            <mesh key={`${x}${z}`} position={[x, 1.7, z]} castShadow><boxGeometry args={[0.12, 1.5, 0.12]} />{mat("#555")}</mesh>
          )))}
          <mesh position={[0, 1.6, -1.6]} rotation={[-0.4, 0, 0]} castShadow><boxGeometry args={[0.3, 0.3, 1.8]} />{mat("#e8b322")}</mesh>
          <mesh position={[0, 1.4, -2.7]} castShadow><boxGeometry args={[0.5, 1, 0.5]} />{mat("#e8b322")}</mesh>
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

const WEIGHT: Record<ForestMachine, number> = { feller: 0.9, skidder: 0.7, logtruck: 0.6 };
const ROLES: Record<ForestMachine, string> = {
  feller: "drives into the trees and saws them down. Standing trunks block every machine.",
  skidder: "hooks felled logs and drags them to the landing (the grey clearing).",
  logtruck: "loads the stack at the landing with its crane, then hauls it to the mill gate. Stay on the road: it bogs down in the forest.",
};

export default function ForestLevel(props: LevelProps) {
  const game = useMemo(() => createForestGame(), []);
  const world = game.world;
  const spec = useMemo<LevelSpec>(() => ({
    id: "timber-ridge",
    title: "Timber Ridge",
    brief: `Run a logging operation. Get ${LOG_TARGET} logs from the forest to the mill.`,
    game,
    machines: Object.fromEntries((Object.keys(FOREST_MACHINES) as ForestMachine[]).map((k) => [k, { ...FOREST_MACHINES[k], weight: WEIGHT[k], paint: PAINT[k] }])),
    roles: ROLES,
    jobOrder: `1. Fell trees with the feller buncher. 2. Skid the logs to the landing with the skidder. 3. Load the stack onto the log truck (it holds ${TRUCK_CAPACITY}), then haul it to the mill gate. Repeat until ${LOG_TARGET} logs are delivered. Steep slopes tip a loaded truck.`,
    winText: "The mill has its logs.",
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
      return v.kind === "skidder" ? `Grapple ${v.logs}/${SKIDDER_CAPACITY} · ${stack}` : v.kind === "logtruck" ? `Load ${v.logs}/${TRUCK_CAPACITY} · ${stack}` : "";
    },
    tasks: () => [
      ["Trees felled", `${world.felled}/${LOG_TARGET}`, world.felled >= LOG_TARGET],
      ["Logs at landing", `${world.stacked}/${LOG_TARGET}`, world.stacked >= LOG_TARGET],
      ["Delivered to mill", `${world.delivered}/${LOG_TARGET}`, world.delivered >= LOG_TARGET],
    ],
    scene: (
      <>
        <Terrain world={world} />
        <Trees world={world} />
        <Logs world={world} />
        <Landmarks world={world} />
      </>
    ),
    vehicle: (v: BaseVehicle, active, night) => <ForestVehicleMesh v={v as ForestVehicle} active={active} night={night} />,
  }), [game, world]);
  return <LevelShell spec={spec} {...props} />;
}
