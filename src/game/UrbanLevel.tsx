// Tower Block: the urban construction-site level, run by the shared Shell like the other levels.
// Rules live in urbanSim.ts / site.ts / crane.ts (no React); this file is the scene, the LevelSpec and the crane camera.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Label, Tank } from "./Camp";
import { CraneGauges } from "./UrbanHud";
import { BuildingMesh, CraneMesh, DeliveryTrucks, HookGuides, Pallets, StreetLife, UrbanScenery } from "./UrbanSite";
import GroundMarks from "./GroundMarksLayer";
import { URBAN_LEVEL, URBAN_PUMP, URBAN_SITE } from "./levels/urban";
import { PAINT } from "./parts";
import { VehicleMesh } from "./RoadLevel";
import { LevelShell, type BaseVehicle, type LevelProps, type LevelSpec } from "./Shell";
import { foundationDone, hookedPallet } from "./site";
import { readSiteHud, type SiteHud } from "./siteHud";
import {
  CELL, MACHINES, N, TRUCK_CAPACITY, craneAction, createGame, currentAction, cycleVehicle, heightAt, recomputeHeights, recover, selectVehicle, stepGame, switchVehicle, toggleCamera,
  type Game, type Machine, type World,
} from "./urbanSim";

const WEIGHT: Record<Machine, number> = { dozer: 0.9, excavator: 0.8, truck: 0.6, paver: 0.7, crane: 0.5 };
const LAMP: Record<Machine, [number, number, number, number]> = {
  dozer: [0, 1.3, 1.1, 0.55], excavator: [-0.45, 2.45, 0.8, 0.3], truck: [0, 1.1, 2.4, 0.7], paver: [0, 1.3, 1.1, 0.7], crane: [0, 3, 1, 0.5],
};
const ROLES: Partial<Record<Machine, string>> = {
  excavator: "digs the foundation pit (hold Space) and loads the dump truck.",
  truck: "hauls the spoil to the pad outside the west gate and dumps it there.",
  crane: "lifts every delivery onto the rising building. Swing is real: ease loads down before you release them.",
};

/** The lot's ground. Digging the foundation lowers vertices (world.dig) and darkens the soil. */
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
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
  });
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

/** The site fuel tank: a solid obstacle with a sign, refuelling and repairing any machine parked beside it. */
function FuelTank({ game }: { game: Game }) {
  const p = game.pump!;
  return (
    <group position={[p.x, heightAt(game.world, p.x, p.z), p.z]}>
      <Tank />
      <group position={[0, 3.6, 0]}><Label text="FUEL" w={1.8} h={0.7} bg="#f2c230" size={72} /></group>
    </group>
  );
}

/** Crane instruments, sampled a few times a second (the shell's HUD does not know about cranes). */
function CraneOverlay({ game }: { game: Game }) {
  const [h, setH] = useState<SiteHud | null>(null);
  useEffect(() => {
    const id = setInterval(() => setH(readSiteHud(game)), 120);
    return () => clearInterval(id);
  }, [game]);
  return h?.inCrane ? <CraneGauges h={h} /> : null;
}

const cargoOf = (game: Game) => {
  const v = game.vehicles[game.active], s = game.site;
  if (v.kind === "truck") return `Load ${v.dirt + v.rock}/${TRUCK_CAPACITY} spoil`;
  if (v.kind === "excavator") return v.dirt ? "Bucket: dirt (swing over the truck)" : "Bucket: empty";
  if (v.kind === "crane" && s) { const l = hookedPallet(s); return l ? `Hook: ${l.kind}` : "Hook: empty"; }
  return "";
};

export default function UrbanLevel(props: LevelProps) {
  const game = useMemo(() => createGame(URBAN_LEVEL, props.settings.difficulty), []); // eslint-disable-line react-hooks/exhaustive-deps
  const world = game.world, site = game.site!;
  const zoom = useRef(1), look = useRef(new THREE.Vector3()), lastCam = useRef<"overview" | "cab">("overview"), tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const wheel = (e: WheelEvent) => { zoom.current = Math.min(2.2, Math.max(0.6, zoom.current * Math.exp(e.deltaY * 0.001))); };
    window.addEventListener("wheel", wheel, { passive: true });
    return () => window.removeEventListener("wheel", wheel);
  }, []);

  const spec = useMemo<LevelSpec>(() => {
    const crane = (): boolean => game.vehicles[game.active].kind === "crane";
    return {
      id: "tower-block",
      title: "Tower Block",
      brief: URBAN_LEVEL.blurb,
      game,
      machines: Object.fromEntries(URBAN_LEVEL.machines.map((k) => [k, { ...MACHINES[k], max: Math.max(1, MACHINES[k].max), weight: WEIGHT[k], paint: PAINT[k], lamp: LAMP[k] }])),
      roles: ROLES as Record<string, string>,
      jobOrder: "1. Dig the foundation pit with the excavator (hold Space), swing the bucket over the dump truck to load it, and haul the spoil to the pad outside the west gate. 2. Take the crane (Tab or 3, or E beside its base). Hook each delivery as it arrives, lift it clear, slew over the green outline, ease it down and release. Each floor needs its steel frame, then its concrete slab; six floors and the rooftop plant top out the tower. 3. Keep loads off the public pavement, stay clear of the power lines and don't leave delivery trucks waiting in the street.",
      winText: "Topped out.",
      par: URBAN_SITE.parTime,
      // one penalty per safety criterion missed (damage, pavement exposure, blocked street)
      penalties: () => +(site.damage > 3) + +(site.exposure > 6) + +(site.traffic > 20),
      extra: () => [["Site damage", String(site.damage)], ["Over the pavement", `${site.exposure.toFixed(0)} s`], ["Street blocked", `${Math.floor(site.traffic)} s`]],
      controls: [
        ["E", "Hop into the nearest machine or the crane (get close); from the crane, climb down"],
        ["Crane: A/D · W/S · ↑/↓", "Slew · trolley out/in · hoist up/down"],
        ["Crane: Space (tap)", "Hook a load / release it"],
        ["Crane: V  /  wheel", "Cab or overview camera  /  zoom"],
      ],
      fuelNote: "The site fuel tank is in the east of the lot, beside the crane.",
      refuelHint: () => "Drive to the fuel tank in the east of the lot and hold Space",
      onKey: (k) => {
        if (k === "e") switchVehicle(game);
        else if (k === "v") toggleCamera(game);
        else if (k === " ") craneAction(game);
        else return false;
        return true;
      },
      step: (input, dt) => {
        // the crane splits the keys: W/S trolley, arrows hoist. Vehicles use W/S and the arrows alike.
        stepGame(game, { throttle: crane() ? input.trolley : input.throttle, steer: input.steer, action: input.action, lift: input.lift }, dt);
      },
      action: () => { const a = currentAction(game); return a ? { label: a.label, time: a.time } : null; },
      recover: () => recover(game),
      select: (i) => selectVehicle(game, i),
      cycle: (d) => cycleVehicle(game, d),
      hint: () => {
        const h = readSiteHud(game)!;
        if (site.toppedOut) return { text: "", machine: null };
        if (!foundationDone(site)) {
          const loaded = game.vehicles.some((o) => o.kind === "truck" && o.dirt + o.rock > 0);
          return loaded ? { text: "Haul the spoil to the pad outside the west gate and dump it (hold Space)", machine: "truck" } : { text: h.hint, machine: "excavator" };
        }
        return { text: h.inCrane ? h.hint : "Take the crane controls: Tab / 3, or E beside its base", machine: "crane" };
      },
      progress: () => { const h = readSiteHud(game)!; return (h.hauled / h.total) * 0.15 + (h.floors / h.floorsTotal) * 0.8 + (h.roof ? 0.05 : 0); },
      cargo: () => cargoOf(game),
      tasks: () => {
        const h = readSiteHud(game)!;
        const rows: [string, string, boolean][] = [
          ["Foundation dug", `${h.dug}/${h.total}`, h.dug >= h.total],
          ["Spoil hauled out", `${h.hauled}/${h.total}`, h.hauled >= h.total],
          ["Floors poured", `${h.floors}/${h.floorsTotal}`, h.floors >= h.floorsTotal],
          ["Rooftop plant", h.roof ? "done" : "—", h.roof],
        ];
        if (h.stage >= 2) rows.push(["Next load", h.next, false]);
        rows.push(["Damage (max 3)", String(h.damage), false], ["Street blocked (max 20 s)", `${Math.floor(h.traffic)} s`, false]);
        return rows;
      },
      map: () => {
        const f = site.cfg.footprint, c = site.cfg.crane, sp = site.cfg.spoilZone, dz = site.cfg.deliveryZone;
        const mid = (a: number, b: number) => (a + b) / 2, outline = foundationDone(site) ? "#9aa0a8" : "#e0c28c";
        const segs = [
          { x1: -80, z1: 31, x2: 80, z2: 31, color: "#5a5d63" },
          { x1: f.x0, z1: f.z0, x2: f.x1, z2: f.z0, color: outline }, { x1: f.x1, z1: f.z0, x2: f.x1, z2: f.z1, color: outline },
          { x1: f.x1, z1: f.z1, x2: f.x0, z2: f.z1, color: outline }, { x1: f.x0, z1: f.z1, x2: f.x0, z2: f.z0, color: outline },
        ];
        return {
          segs,
          pins: [
            { x: c.x ?? 0, z: c.z ?? 0, color: "#f2c230", label: "K" },
            { x: URBAN_PUMP.x, z: URBAN_PUMP.z, color: "#ff8a3d", label: "F" },
            { x: mid(sp.x0, sp.x1), z: mid(sp.z0, sp.z1), color: "#c8a46a", label: "S" },
            { x: mid(dz.x0, dz.x1), z: mid(dz.z0, dz.z1), color: "#ffffff", label: "D" },
          ],
        };
      },
      camera: (cam, dt) => {
        const v = game.vehicles[game.active];
        let fov = 40, focus: [number, number, number] | null = null;
        if (v.kind === "crane") {
          const c = site.crane;
          if (game.cam === "cab") {
            // operator's seat on the slewing unit, looking at the load
            const th = c.slew;
            cam.position.set(c.cfg.x + 1.5 * Math.cos(th) + 0.5 * Math.sin(th), c.cfg.jibY + 0.7, c.cfg.z - 1.5 * Math.sin(th) + 0.5 * Math.cos(th));
            if (lastCam.current !== "cab") look.current.set(c.hook.x, c.hook.y, c.hook.z);
            look.current.lerp(tmp.set(c.hook.x, c.hook.y - 1.5, c.hook.z), 1 - Math.exp(-7 * dt));
            cam.lookAt(look.current);
            fov = 62;
          } else {
            // follow the hook, leaning a little toward the building so both stay in frame
            const b = site.cfg.footprint, bx = (b.x0 + b.x1) / 2, bz = (b.z0 + b.z1) / 2;
            const fx = c.hook.x + (bx - c.hook.x) * 0.2, fy = Math.max(0, c.hook.y * 0.25), fz = c.hook.z + (bz - c.hook.z) * 0.2;
            // stay above the jib so the boom never sits between the camera and the lot
            const camY = Math.max(fy + 40 * zoom.current, c.cfg.jibY + 10);
            cam.position.lerp(tmp.set(fx + 8 * zoom.current, camY, fz + 24 * zoom.current), 1 - Math.exp(-3 * dt));
            cam.lookAt(fx, fy, fz);
          }
          focus = [c.hook.x, Math.max(0, c.hook.y * 0.25), c.hook.z];
          lastCam.current = game.cam;
        } else lastCam.current = "overview";
        if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, 8 * dt); cam.updateProjectionMatrix(); }
        return focus;
      },
      overlay: <CraneOverlay game={game} />,
      scene: (
        <>
          <Terrain world={world} />
          <UrbanScenery site={site} />
          <StreetLife />
          <BuildingMesh site={site} />
          <CraneMesh site={site} hideCab={() => game.cam === "cab" && game.vehicles[game.active].kind === "crane"} />
          <Pallets site={site} />
          <DeliveryTrucks site={site} />
          <HookGuides site={site} world={world} />
          <FuelTank game={game} />
          <GroundMarks machines={game.vehicles.filter((v) => v.kind !== "crane")} heightAt={(x, z) => heightAt(world, x, z)} />
        </>
      ),
      // the crane's own mesh is part of the scene; everything else uses the shared machine models
      vehicle: (v: BaseVehicle, active, lamps) => (v.kind === "crane" ? null : <VehicleMesh v={v as never} active={active} night={lamps} />),
    };
  }, [game, world, site, tmp]);

  return <LevelShell spec={spec} {...props} />;
}

