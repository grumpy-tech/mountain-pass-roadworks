import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CELL, HALF, MACHINES, N, createTruck, createWorld, heightAt, progress, recomputeHeights, stepTruck, type Truck, type World } from "./world";

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
    const pos = geo.attributes.position as THREE.BufferAttribute;
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
  const rocks = useRef<THREE.InstancedMesh>(null!);
  const m = useMemo(() => new THREE.Object3D(), []);
  const update = (idx: number) => {
    const r = world.road[idx];
    const y = heightAt(world, r.x, r.z);
    m.position.set(r.x, y + 0.6 * Math.min(1, r.hp), r.z);
    m.rotation.set(r.hp * 3, idx, 0);
    m.scale.setScalar(r.stage === 0 ? 0.35 + r.hp * 0.25 : 0);
    m.updateMatrix(); rocks.current.setMatrixAt(idx, m.matrix);
    m.position.set(r.x, y + 0.03, r.z); m.rotation.set(0, 0, 0);
    m.scale.set(r.stage >= 2 ? 1 : 0, 1, r.stage >= 2 ? 1 : 0);
    m.updateMatrix(); tiles.current.setMatrixAt(idx, m.matrix);
    tiles.current.setColorAt(idx, r.stage === 3 ? ASPHALT : DIRT);
  };
  useEffect(() => {
    world.road.forEach((_, i) => update(i));
    tiles.current.instanceMatrix.needsUpdate = true; rocks.current.instanceMatrix.needsUpdate = true;
    if (tiles.current.instanceColor) tiles.current.instanceColor.needsUpdate = true;
  }, [world]);
  useFrame(() => {
    if (!world.dirtyCells.size) return;
    for (const c of world.dirtyCells) update(world.cellToRoad[c]);
    world.dirtyCells.clear();
    tiles.current.instanceMatrix.needsUpdate = true; rocks.current.instanceMatrix.needsUpdate = true;
    if (tiles.current.instanceColor) tiles.current.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={tiles} args={[undefined, undefined, world.road.length]} receiveShadow>
        <boxGeometry args={[CELL * 1.02, 0.12, CELL * 1.02]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, world.road.length]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#7d7770" flatShading />
      </instancedMesh>
    </>
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

function Track({ x }: { x: number }) {
  return (
    <mesh position={[x, 0.35, 0]} castShadow>
      <boxGeometry args={[0.55, 0.7, 3.2]} /><meshStandardMaterial color="#2a2a2a" flatShading />
    </mesh>
  );
}

function TruckMesh({ machine }: { machine: string }) {
  const body = machine === "dozer" ? "#e8b322" : "#e06b24";
  return (
    <group>
      <Track x={-0.95} /><Track x={0.95} />
      <mesh position={[0, 1.05, -0.2]} castShadow><boxGeometry args={[1.6, 0.8, 2.4]} /><meshStandardMaterial color={body} flatShading /></mesh>
      <mesh position={[0, 1.85, -0.6]} castShadow><boxGeometry args={[1.2, 0.9, 1.1]} /><meshStandardMaterial color={body} flatShading /></mesh>
      <mesh position={[0, 1.95, -0.05]}><boxGeometry args={[1.1, 0.6, 0.05]} /><meshStandardMaterial color="#9fc7d8" metalness={0.3} roughness={0.2} /></mesh>
      <mesh position={[0.5, 1.9, 0.6]} castShadow><cylinderGeometry args={[0.08, 0.08, 1, 6]} /><meshStandardMaterial color="#333" /></mesh>
      {machine === "dozer" ? (
        <mesh position={[0, 0.55, 2.1]} rotation={[0.2, 0, 0]} castShadow><boxGeometry args={[3.2, 1, 0.25]} /><meshStandardMaterial color="#c99a1a" flatShading /></mesh>
      ) : (
        <>
          <mesh position={[0, 0.9, 1.5]} castShadow><boxGeometry args={[2, 0.9, 0.9]} /><meshStandardMaterial color="#555" flatShading /></mesh>
          <mesh position={[0, 0.3, -1.9]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.35, 0.35, 3, 8]} /><meshStandardMaterial color="#444" flatShading /></mesh>
        </>
      )}
    </group>
  );
}

function Player({ world, truck, machine, onReady }: { world: World; truck: Truck; machine: string; onReady: () => void }) {
  const g = useRef<THREE.Group>(null!);
  const light = useRef<THREE.DirectionalLight>(null!);
  const { camera } = useThree();
  const frames = useRef(0);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const throttle = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
    stepTruck(world, truck, { throttle, steer }, dt);
    g.current.position.set(truck.x, truck.y, truck.z);
    g.current.rotation.set(0, 0, 0);
    g.current.rotateY(truck.heading); g.current.rotateX(truck.pitch); g.current.rotateZ(truck.roll);
    const target = new THREE.Vector3(truck.x + 6, truck.y + 42, truck.z + 16);
    camera.position.lerp(target, 1 - Math.exp(-3 * dt));
    camera.lookAt(truck.x, truck.y, truck.z);
    light.current.position.set(truck.x + 20, truck.y + 40, truck.z + 10);
    light.current.target.position.set(truck.x, truck.y, truck.z);
    light.current.target.updateMatrixWorld();
    if (++frames.current === 3) onReady();
  });
  return (
    <>
      <directionalLight ref={light} intensity={2.4} color="#fff1d6" castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0005} />
      <group ref={g}><TruckMesh machine={machine} /></group>
    </>
  );
}

export default function Game() {
  const world = useMemo(() => createWorld(), []);
  const truck = useMemo(() => createTruck(world), [world]);
  const [machine, setMachine] = useState(truck.machine);
  const [hud, setHud] = useState({ cleared: 0, graded: 0, paved: 0, speed: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "tab" || k === "q") {
        e.preventDefault();
        truck.machine = truck.machine === "dozer" ? "paver" : "dozer";
        truck.speed = 0;
        setMachine(truck.machine);
      }
      if (k === "r") { const t = createTruck(world); Object.assign(truck, { ...t, machine: truck.machine }); }
      keys.add(k);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    const id = setInterval(() => setHud({ ...progress(world), speed: Math.abs(truck.speed) }), 200);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); clearInterval(id); };
  }, [world, truck]);

  const done = hud.paved >= 0.95;
  return (
    <div className="relative h-screen w-full overflow-hidden" data-scene-ready={ready ? "" : undefined}>
      <Canvas shadows camera={{ fov: 40, position: [truck.x + 6, 42, truck.z + 16], far: 400 }}>
        <color attach="background" args={["#b9d3e0"]} />
        <fog attach="fog" args={["#b9d3e0", 60, 160]} />
        <hemisphereLight args={["#dbeeff", "#6b5a3e", 0.5]} />
        <Environment resolution={64} environmentIntensity={0.35}>
          <Lightformer intensity={1.5} position={[0, 5, 0]} scale={[10, 10, 1]} />
          <Lightformer intensity={0.8} color="#ffd9a8" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
        </Environment>
        <Terrain world={world} />
        <RoadWork world={world} />
        <Scenery world={world} />
        <Player world={world} truck={truck} machine={machine} onReady={() => setReady(true)} />
      </Canvas>

      <div className="pointer-events-none absolute left-4 top-4 w-72 rounded-md border-2 border-foreground/80 bg-card/90 p-4 font-mono text-sm text-card-foreground shadow-lg">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Job · Pass Road</div>
        <div className="mt-1 text-lg font-bold">{MACHINES[machine].label}</div>
        {[["Cleared", hud.cleared], ["Graded", hud.graded], ["Paved", hud.paved]].map(([l, v]) => (
          <div key={l as string} className="mt-2">
            <div className="flex justify-between"><span>{l}</span><span>{Math.floor((v as number) * 100)}%</span></div>
            <div className="h-2 bg-muted"><div className="h-2 bg-primary" style={{ width: `${(v as number) * 100}%` }} /></div>
          </div>
        ))}
        <div className="mt-3 text-xs text-muted-foreground">{(hud.speed * 3.6).toFixed(0)} km/h</div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-md bg-card/85 px-4 py-3 font-mono text-xs text-card-foreground">
        <b>W/S</b> drive · <b>A/D</b> steer · <b>Tab</b> swap machine · <b>R</b> back to start
        <div className="mt-1 text-muted-foreground">Dozer: push rocks, flatten bumps · Paver: pave graded dirt</div>
      </div>

      {done && (
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
