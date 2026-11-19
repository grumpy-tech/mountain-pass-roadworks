import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

export const PAINT: Record<string, string> = {
  dozer: "#e8b322", excavator: "#d9902a", truck: "#c8392b", paver: "#e06b24",
  feller: "#2f7d3a", skidder: "#d9a21f", logtruck: "#2c5f9e",
};

export const mat = (c: string) => <meshStandardMaterial color={c} flatShading />;

export function Tracks() {
  return (
    <>
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 0.35, 0]} castShadow><boxGeometry args={[0.55, 0.7, 3.2]} />{mat("#2a2a2a")}</mesh>
      ))}
    </>
  );
}

export function Wheels() {
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

export const glass = <meshStandardMaterial color="#05070a" metalness={0.75} roughness={0.1} />;

/** Blacked-out window pane. */
export function Glass({ p, s }: { p: [number, number, number]; s: [number, number, number] }) {
  return <mesh position={p}><boxGeometry args={s} />{glass}</mesh>;
}

/** Light that glows only while its machine is the one being driven. */
export function Lamp({ p, s, on, color }: { p: [number, number, number]; s: [number, number, number]; on: boolean; color: string }) {
  return (
    <mesh position={p}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={on ? color : "#3a3a3a"} emissive={color} emissiveIntensity={on ? 2.2 : 0} />
    </mesh>
  );
}

/** Amber roof beacon: spins and flashes while the machine is active. */
export function Beacon({ p, on }: { p: [number, number, number]; on: boolean }) {
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

export function Stack({ p, h = 0.9 }: { p: [number, number, number]; h?: number }) {
  return (
    <mesh position={p} castShadow>
      <cylinderGeometry args={[0.07, 0.09, h, 6]} /><meshStandardMaterial color="#b8bcc2" metalness={0.8} roughness={0.25} flatShading />
    </mesh>
  );
}


export function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-foreground/40 bg-muted px-1.5 py-0.5 font-mono text-xs font-bold text-foreground">{children}</kbd>;
}


/** Headlight beam: a real spotlight, so night driving lights up the ground ahead. Lamp count stays constant (intensity 0 when off). */
export function HeadSpot({ p, on }: { p: [number, number, number]; on: boolean }) {
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
      <primitive object={target} position={[p[0], p[1] - 1.2, p[2] + 14]} />
      <spotLight position={p} target={target} intensity={on ? 420 : 0} distance={46} angle={0.6} penumbra={0.7} color="#fff1cf" />
    </>
  );
}
