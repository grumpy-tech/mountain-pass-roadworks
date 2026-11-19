import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  CELL, HALF, MACHINES, N, TRUCK_CAPACITY, createGame, currentAction, heightAt, progress, recomputeHeights, recover, stepGame, switchVehicle,
  type Game as GameState, type LevelConfig, type Vehicle, type World,
} from "./world";
import { MOUNTAIN_LEVEL } from "./levels/mountain";

const keys = new Set<string>();
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
    if (marker.current) { marker.current.visible = active; marker.current.position.y = 4.2 + Math.sin(clock.elapsedTime * 3) * 0.2; }
  });
  const yellow = "#e8b322";
  return (
    <group ref={g}>
      <mesh ref={marker} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.4, 0.8, 4]} />{mat("#ffffff")}</mesh>
      {v.kind === "dozer" && (
        <>
          <Tracks />
          <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} />{mat(yellow)}</mesh>
          <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} />{mat(yellow)}</mesh>
          <mesh position={[0, 0.55, 2.1]} rotation={[0.2, 0, 0]} castShadow><boxGeometry args={[3.2, 1, 0.25]} />{mat("#c99a1a")}</mesh>
        </>
      )}
      {v.kind === "excavator" && (
        <>
          <Tracks />
          <mesh position={[0, 1.1, -0.3]} castShadow><boxGeometry args={[1.9, 0.7, 2.6]} />{mat("#d9902a")}</mesh>
          <mesh position={[-0.45, 1.9, 0.2]} castShadow><boxGeometry args={[0.9, 0.9, 1.1]} />{mat("#d9902a")}</mesh>
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
          <mesh position={[0, 1.4, 1.7]} castShadow><boxGeometry args={[1.9, 1.3, 1.2]} />{mat("#c8392b")}</mesh>
          <mesh position={[0, 1.6, 2.32]}><boxGeometry args={[1.6, 0.5, 0.05]} /><meshStandardMaterial color="#9fc7d8" metalness={0.3} roughness={0.2} /></mesh>
          <mesh position={[0, 0.9, -0.2]} castShadow><boxGeometry args={[2.1, 0.3, 4]} />{mat("#333")}</mesh>
          <mesh position={[0, 1.55, -0.5]} castShadow><boxGeometry args={[2.2, 1, 3]} />{mat("#a8a8a8")}</mesh>
          <mesh ref={load} position={[0, 2.05, -0.5]}><boxGeometry args={[2, 0.8, 2.8]} />{mat("#6b4a2b")}</mesh>
        </>
      )}
      {v.kind === "paver" && (
        <>
          <Tracks />
          <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} />{mat("#e06b24")}</mesh>
          <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} />{mat("#e06b24")}</mesh>
          <mesh position={[0, 0.9, 1.5]} castShadow><boxGeometry args={[2, 0.9, 0.9]} />{mat("#555")}</mesh>
          <mesh position={[0, 0.3, -1.9]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.35, 0.35, 3, 8]} />{mat("#444")}</mesh>
        </>
      )}
    </group>
  );
}

function Director({ game, onReady }: { game: GameState; onReady: () => void }) {
  const light = useRef<THREE.DirectionalLight>(null!);
  const { camera } = useThree();
  const frames = useRef(0);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const throttle = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
    stepGame(game, { throttle, steer, action: keys.has(" ") }, dt);
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

export default function Game({ level = MOUNTAIN_LEVEL }: { level?: LevelConfig }) {
  const game = useMemo(() => createGame(level), [level]);
  const world = game.world;
  const [hud, setHud] = useState(() => ({ ...progress(world), active: 0, speed: 0, msg: "", action: "", actionT: 0, actionMax: 1, cargo: "", won: false }));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") (window as unknown as { __game: GameState }).__game = game;
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      if (k === "e" && !e.repeat) switchVehicle(game);
      if (k === "r" && !e.repeat) recover(game);
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
  }, [game, world]);

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
        <Director game={game} onReady={() => setReady(true)} />
      </Canvas>

      <div className="pointer-events-none absolute left-4 top-4 w-80 rounded-md border-2 border-foreground/80 bg-card/90 p-4 font-mono text-sm text-card-foreground shadow-lg">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Job · Pass Road</div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-lg font-bold">{MACHINES[v.kind].label}</span>
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

      <div className="pointer-events-none absolute bottom-4 left-4 max-w-xl rounded-md bg-card/85 px-4 py-3 font-mono text-xs text-card-foreground">
        <b>W/S</b> drive · <b>A/D</b> steer · <b>Space</b> work (hold) · <b>E</b> hop into nearby machine · <b>R</b> recover
        <div className="mt-1 text-muted-foreground">
          Bulldozer pushes small rocks off the road and flattens dirt · Excavator breaks boulders, digs mounds, loads the truck · Dump truck fills mud holes or dumps off-road · Paver paves flat dirt. Watch steep edges — loaded trucks tip easily and bog down in mud.
        </div>
      </div>

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
