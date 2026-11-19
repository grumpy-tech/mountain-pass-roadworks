// Rain streaks and snowflakes that follow the machine you are driving.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { WeatherKind } from "./shared";

export interface WeatherState { kind: WeatherKind; level: number }

const BOX = 72, TOP = 46, DROPS = 1600;

export function Precipitation({ weather, follow }: { weather: { current: WeatherState }; follow: () => { x: number; y: number; z: number } }) {
  const rain = useRef<THREE.LineSegments>(null!), snow = useRef<THREE.Points>(null!);
  const pts = useMemo(() => {
    const p = new Float32Array(DROPS * 3), seed = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) { p[i * 3] = (Math.random() - 0.5) * BOX; p[i * 3 + 1] = Math.random() * TOP; p[i * 3 + 2] = (Math.random() - 0.5) * BOX; seed[i] = Math.random(); }
    return { p, seed, rainPos: new Float32Array(DROPS * 6), snowPos: new Float32Array(DROPS * 3) };
  }, []);
  const rainGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pts.rainPos, 3)); return g; }, [pts]);
  const snowGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pts.snowPos, 3)); return g; }, [pts]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05), { kind, level } = weather.current, at = follow();
    rain.current.visible = kind === "rain" && level > 0.02;
    snow.current.visible = kind === "snow" && level > 0.02;
    if (kind === "clear" || level <= 0.02) return;
    const n = Math.floor(DROPS * Math.min(1, level)), t = clock.elapsedTime;
    const { p, seed } = pts, half = BOX / 2;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (kind === "rain") { p[k + 1] -= 38 * dt; p[k] -= 4 * dt; } else { p[k + 1] -= (3 + seed[i] * 2) * dt; p[k] += Math.sin(t * 0.8 + seed[i] * 20) * 1.2 * dt; }
      if (p[k + 1] < at.y - 6) p[k + 1] += TOP; // recycle at the top
      else if (p[k + 1] > at.y + TOP) p[k + 1] -= TOP;
      // keep the whole box centred on the machine
      const wx = p[k] - at.x, wz = p[k + 2] - at.z;
      if (wx > half) p[k] -= BOX; else if (wx < -half) p[k] += BOX;
      if (wz > half) p[k + 2] -= BOX; else if (wz < -half) p[k + 2] += BOX;
    }
    if (kind === "rain") {
      const r = pts.rainPos;
      for (let i = 0; i < n; i++) {
        const k = i * 3, j = i * 6;
        r[j] = p[k]; r[j + 1] = p[k + 1]; r[j + 2] = p[k + 2];
        r[j + 3] = p[k] + 0.12; r[j + 4] = p[k + 1] + 1.3; r[j + 5] = p[k + 2];
      }
      rainGeo.setDrawRange(0, n * 2); rainGeo.getAttribute("position").needsUpdate = true;
    } else {
      pts.snowPos.set(p.subarray(0, n * 3)); snowGeo.setDrawRange(0, n); snowGeo.getAttribute("position").needsUpdate = true;
    }
  });

  return (
    <>
      <lineSegments ref={rain} geometry={rainGeo} frustumCulled={false} visible={false}>
        <lineBasicMaterial color="#c4d4e4" transparent opacity={0.5} />
      </lineSegments>
      <points ref={snow} geometry={snowGeo} frustumCulled={false} visible={false}>
        <pointsMaterial color="#ffffff" size={0.4} sizeAttenuation transparent opacity={0.9} />
      </points>
    </>
  );
}
