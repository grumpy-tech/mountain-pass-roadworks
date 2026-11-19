// Draws the work camp laid out by camp.ts. Windows glow and floodlights come on when it gets dark.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Camp, CampProp } from "./camp";
import { Glass, mat, useEnv } from "./parts";

/** A flat sign face with text, drawn to a canvas texture. */
export function Label({ text, w, h, bg = "#f4c20d", fg = "#1a1a1a", size = 64 }: { text: string; w: number; h: number; bg?: string; fg?: string; size?: number }) {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 512; c.height = Math.round(512 * (h / w));
    const x = c.getContext("2d")!;
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = fg; x.font = `bold ${size}px monospace`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, c.width / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, [text, w, h, bg, fg, size]);
  return <mesh><planeGeometry args={[w, h]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>;
}

function Window({ p, s, lit }: { p: [number, number, number]; s: [number, number, number]; lit: boolean }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={lit ? "#ffe3a0" : "#05070a"} emissive="#ffcf6b" emissiveIntensity={lit ? 1.6 : 0} metalness={lit ? 0 : 0.7} roughness={0.15} />
    </mesh>
  );
}

function Wheels({ x, z, r = 0.38 }: { x: number; z: number[]; r?: number }) {
  return <>{z.flatMap((zz) => [-x, x].map((xx) => (
    <mesh key={`${xx}${zz}`} position={[xx, r, zz]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[r, r, 0.3, 8]} />{mat("#1c1c1c")}</mesh>
  )))}</>;
}

function Cabin({ p, lit, big }: { p: CampProp; lit: boolean; big: boolean }) {
  const L = big ? 8 : 6.4, W = big ? 3.4 : 3;
  const n = big ? 3 : 2;
  return (
    <>
      <mesh position={[0, 1.5, 0]} castShadow receiveShadow><boxGeometry args={[W, 2.6, L]} />{mat(p.color ?? "#d8d4c4")}</mesh>
      <mesh position={[0, 2.85, 0]} castShadow><boxGeometry args={[W + 0.3, 0.2, L + 0.3]} />{mat("#5c6670")}</mesh>
      <mesh position={[0, 0.2, 0]}><boxGeometry args={[W + 0.1, 0.4, L + 0.1]} />{mat("#4a4a4a")}</mesh>
      {Array.from({ length: n }, (_, i) => <Window key={i} p={[-W / 2 - 0.02, 1.7, (i - (n - 1) / 2) * (L / (n + 0.4)) + 0.8]} s={[0.05, 0.9, 1.1]} lit={lit} />)}
      <mesh position={[-W / 2 - 0.02, 1.2, -L / 2 + 0.9]}><boxGeometry args={[0.06, 2, 0.9]} />{mat("#7a5a3a")}</mesh>
      <mesh position={[-W / 2 - 0.5, 0.2, -L / 2 + 0.9]}><boxGeometry args={[1, 0.3, 1.2]} />{mat("#555")}</mesh>
      <mesh position={[0.4, 3.1, 1]}><boxGeometry args={[1, 0.4, 0.9]} />{mat("#b8bcc2")}</mesh>
    </>
  );
}

function Car({ p, kind }: { p: CampProp; kind: "car" | "pickup" | "van" }) {
  const c = p.color ?? "#888";
  if (kind === "van") return (
    <>
      <mesh position={[0, 1.05, 0]} castShadow><boxGeometry args={[2, 1.7, 4.6]} />{mat(c)}</mesh>
      <Glass p={[0, 1.5, 2.31]} s={[1.7, 0.6, 0.05]} /><Glass p={[1.01, 1.5, 1.2]} s={[0.04, 0.55, 1.4]} /><Glass p={[-1.01, 1.5, 1.2]} s={[0.04, 0.55, 1.4]} />
      <Wheels x={1} z={[-1.5, 1.5]} r={0.4} />
    </>
  );
  if (kind === "pickup") return (
    <>
      <mesh position={[0, 0.8, -0.2]} castShadow><boxGeometry args={[1.9, 0.7, 4.4]} />{mat(c)}</mesh>
      <mesh position={[0, 1.4, 0.9]} castShadow><boxGeometry args={[1.8, 0.7, 1.7]} />{mat(c)}</mesh>
      <Glass p={[0, 1.45, 1.76]} s={[1.5, 0.5, 0.05]} /><Glass p={[0.91, 1.45, 0.9]} s={[0.04, 0.45, 1.2]} /><Glass p={[-0.91, 1.45, 0.9]} s={[0.04, 0.45, 1.2]} />
      <mesh position={[0, 1.25, -1.3]}><boxGeometry args={[1.7, 0.1, 1.9]} />{mat("#333")}</mesh>
      <Wheels x={0.95} z={[-1.3, 1.3]} />
    </>
  );
  return (
    <>
      <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[1.8, 0.6, 4.2]} />{mat(c)}</mesh>
      <mesh position={[0, 1.25, -0.1]} castShadow><boxGeometry args={[1.6, 0.55, 2.1]} />{mat(c)}</mesh>
      <Glass p={[0, 1.27, 0.97]} s={[1.4, 0.45, 0.05]} /><Glass p={[0, 1.27, -1.17]} s={[1.4, 0.45, 0.05]} />
      <Glass p={[0.81, 1.27, -0.1]} s={[0.04, 0.42, 1.8]} /><Glass p={[-0.81, 1.27, -0.1]} s={[0.04, 0.42, 1.8]} />
      <Wheels x={0.9} z={[-1.3, 1.3]} />
    </>
  );
}

function Flag() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => { ref.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25; });
  return (
    <>
      <mesh position={[0, 3.5, 0]} castShadow><cylinderGeometry args={[0.08, 0.1, 7, 6]} />{mat("#c9ced3")}</mesh>
      <group position={[0, 6.2, 0]}><mesh ref={ref} position={[0.8, 0, 0]}><boxGeometry args={[1.6, 0.9, 0.04]} />{mat("#d4382c")}</mesh></group>
    </>
  );
}

function Light({ lit }: { lit: boolean }) {
  return (
    <>
      <mesh position={[0, 3.5, 0]} castShadow><cylinderGeometry args={[0.1, 0.14, 7, 6]} />{mat("#4a4f55")}</mesh>
      <mesh position={[0, 7.1, 0.3]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[1.4, 0.3, 0.7]} />
        <meshStandardMaterial color={lit ? "#fff4d0" : "#777"} emissive="#fff0c0" emissiveIntensity={lit ? 2.5 : 0} />
      </mesh>
      <pointLight position={[0, 6.5, 0]} intensity={lit ? 700 : 0} distance={30} decay={2} color="#ffe9b8" />
    </>
  );
}

function Tank() {
  return (
    <>
      <mesh position={[0, 1.5, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.95, 0.95, 3.2, 10]} />{mat("#c8392b")}</mesh>
      <mesh position={[0, 1.5, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.97, 0.97, 0.5, 10]} />{mat("#f2f2f2")}</mesh>
      {[-1.1, 1.1].map((z) => <mesh key={z} position={[0, 0.5, z]} castShadow><boxGeometry args={[1.6, 1, 0.25]} />{mat("#4a4a4a")}</mesh>)}
      <mesh position={[-1.5, 0.8, 1.3]} castShadow><boxGeometry args={[0.5, 1.6, 0.5]} />{mat("#e8b322")}</mesh>
      <mesh position={[-1.5, 1.3, 1.05]}><boxGeometry args={[0.3, 0.3, 0.05]} />{mat("#111")}</mesh>
    </>
  );
}

function Prop({ p, lit, hy }: { p: CampProp; lit: boolean; hy: (x: number, z: number) => number }) {
  const y = hy(p.x, p.z);
  return (
    <group position={[p.x, y, p.z]} rotation={[0, p.rot, 0]}>
      {(p.kind === "cabin" || p.kind === "office") && <Cabin p={p} lit={lit} big={p.kind === "office"} />}
      {(p.kind === "car" || p.kind === "pickup" || p.kind === "van") && <Car p={p} kind={p.kind} />}
      {p.kind === "toilet" && (
        <>
          <mesh position={[0, 1.2, 0]} castShadow><boxGeometry args={[1.3, 2.4, 1.3]} />{mat("#2f7bbf")}</mesh>
          <mesh position={[0, 2.5, 0]}><boxGeometry args={[1.4, 0.15, 1.4]} />{mat("#e9eef2")}</mesh>
          <mesh position={[0, 1.1, 0.66]}><boxGeometry args={[0.8, 1.8, 0.05]} />{mat("#e9eef2")}</mesh>
          <mesh position={[0, 1.7, 0.7]}><boxGeometry args={[0.2, 0.2, 0.03]} />{mat("#d4382c")}</mesh>
        </>
      )}
      {p.kind === "tank" && <Tank />}
      {p.kind === "flag" && <Flag />}
      {p.kind === "light" && <Light lit={lit} />}
      {p.kind === "crate" && <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[1.2, 1.2, 1.2]} />{mat("#8a6a3a")}</mesh>}
      {p.kind === "cone" && (
        <>
          <mesh position={[0, 0.35, 0]} castShadow><coneGeometry args={[0.3, 0.7, 6]} />{mat("#ff6a1a")}</mesh>
          <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.2, 0.22, 0.12, 6]} />{mat("#f5f5f5")}</mesh>
        </>
      )}
      {p.kind === "fence" && (
        <>
          <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.15, 1.4, 0.15]} />{mat("#7a5a3a")}</mesh>
          {[0.5, 1.1].map((h) => <mesh key={h} position={[0, h, 2]}><boxGeometry args={[0.08, 0.1, 4]} />{mat("#9a7a52")}</mesh>)}
        </>
      )}
      {p.kind === "sign" && (
        <>
          {[-1.4, 1.4].map((x) => <mesh key={x} position={[x, 1.2, 0]} castShadow><boxGeometry args={[0.15, 2.4, 0.15]} />{mat("#5a4630")}</mesh>)}
          <group position={[0, 1.9, 0.1]}><Label text={p.label ?? "WORK ZONE"} w={3.4} h={1.1} size={56} /></group>
          <group position={[0, 1.9, -0.1]} rotation={[0, Math.PI, 0]}><mesh><planeGeometry args={[3.4, 1.1]} />{mat("#444")}</mesh></group>
        </>
      )}
    </group>
  );
}

export default function CampScene({ camp, hy }: { camp: Camp; hy: (x: number, z: number) => number }) {
  const { lamps } = useEnv();
  return <>{camp.props.map((p, i) => <Prop key={i} p={p} lit={lamps} hy={hy} />)}</>;
}
