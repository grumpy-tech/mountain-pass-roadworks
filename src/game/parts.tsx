import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useRef, type ReactNode } from "react";
import type * as THREE from "three";

export const PAINT: Record<string, string> = {
  dozer: "#e8b322", excavator: "#d9902a", truck: "#c8392b", paver: "#e06b24",
  feller: "#2f7d3a", grader: "#9ac02f", skidder: "#d9a21f", logtruck: "#2c5f9e",
};

export const mat = (c: string) => <meshStandardMaterial color={c} flatShading />;

const TREAD_LEN = 3.2;

/** Tracked undercarriage: tread cleats slide along the top as the machine moves. */
export function Tracks({ v }: { v?: { speed: number } }) {
  const cleats = useRef<(THREE.Group | null)[]>([]);
  const off = useRef(0);
  useFrame((_, dt) => {
    off.current += (v?.speed ?? 0) * dt;
    cleats.current.forEach((g, i) => {
      if (g) g.position.z = ((((i % 8) / 8) * TREAD_LEN + off.current) % TREAD_LEN + TREAD_LEN) % TREAD_LEN - TREAD_LEN / 2;
    });
  });
  return (
    <>
      {[-0.95, 0.95].map((x, side) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.35, 0]} castShadow><boxGeometry args={[0.55, 0.7, TREAD_LEN]} />{mat("#2a2a2a")}</mesh>
          {Array.from({ length: 8 }, (_, i) => (
            <group key={i} ref={(el) => { cleats.current[side * 8 + i] = el; }}>
              <mesh position={[0, 0.72, 0]}><boxGeometry args={[0.6, 0.05, 0.16]} />{mat("#5a5a5a")}</mesh>
            </group>
          ))}
        </group>
      ))}
    </>
  );
}

/** Wheels that turn with the ground speed. A pale bar across each tyre makes the spin visible. */
export function Wheels({ v, zs = [-1.3, 0, 1.4], x = 1.05, r = 0.5, width = 0.45 }: { v?: { speed: number }; zs?: number[]; x?: number; r?: number; width?: number }) {
  const wheels = useRef<(THREE.Group | null)[]>([]);
  useFrame((_, dt) => { for (const w of wheels.current) if (w) w.rotation.x += ((v?.speed ?? 0) * dt) / r; });
  return (
    <>
      {[-x, x].flatMap((xx) => zs.map((z) => (
        <group key={`${xx}${z}`} position={[xx, r, z]} ref={(el) => { wheels.current.push(el); }}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[r, r, width, 9]} />{mat("#222")}</mesh>
          <mesh><boxGeometry args={[width + 0.02, r * 1.7, 0.12]} />{mat("#5f5f5f")}</mesh>
        </group>
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


/** Lighting state the shell publishes inside the canvas: are the lamps on (dark enough)? */
export const EnvCtx = createContext({ lamps: false });
export const useEnv = () => useContext(EnvCtx);
