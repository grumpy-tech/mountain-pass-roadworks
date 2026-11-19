// Draws the dashes from groundMarks.ts as flat dark strips just above the ground, fading out with age.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GroundMarks as Marks, MARK_CAP, MARK_LEN, type MarkSource } from "./groundMarks";

const WIDTH = 0.5;

export default function GroundMarks({ machines, heightAt }: { machines: MarkSource[]; heightAt: (x: number, z: number) => number }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const marks = useMemo(() => new Marks(), []);
  const o = useMemo(() => { const d = new THREE.Object3D(); d.rotation.order = "YXZ"; return d; }, []);
  const clock = useRef({ now: 0, shown: 0, fade: 0 });
  const geo = useMemo(() => { const g = new THREE.PlaneGeometry(WIDTH, MARK_LEN); g.rotateX(-Math.PI / 2); return g; }, []);

  useEffect(() => { // start with every dash collapsed to nothing
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MARK_CAP; i++) mesh.current.setMatrixAt(i, z);
    mesh.current.instanceMatrix.needsUpdate = true;
  }, []);

  const place = (k: number, vigor: number) => {
    const x = marks.x[k], z = marks.z[k], h = marks.heading[k], f = Math.sin(h) * MARK_LEN / 2, c = Math.cos(h) * MARK_LEN / 2;
    const hf = heightAt(x + f, z + c), hb = heightAt(x - f, z - c);
    o.position.set(x, (hf + hb) / 2 + 0.07, z);
    o.rotation.set(Math.atan2(hb - hf, MARK_LEN), h, 0);
    o.scale.set(vigor, 1, vigor > 0 ? 1 : 0);
    o.updateMatrix(); mesh.current.setMatrixAt(k, o.matrix);
  };

  useFrame((_, dt) => {
    const c = clock.current;
    c.now += Math.min(dt, 0.05);
    marks.update(machines, c.now);
    let dirty = false;
    for (; c.shown < marks.head; c.shown++) { place(c.shown % MARK_CAP, 1); dirty = true; } // new dashes (only the newest MARK_CAP exist)
    c.fade += dt;
    if (c.fade > 0.5) { // every so often, shrink the old ones away
      c.fade = 0;
      for (let k = 0; k < MARK_CAP; k++) if (marks.born[k] > -1e8) { const v = marks.vigor(k, c.now); if (v < 1) { place(k, v); dirty = true; } }
    }
    if (dirty) mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geo, undefined, MARK_CAP]} frustumCulled={false}>
      <meshStandardMaterial color="#2c2218" roughness={1} transparent opacity={0.5} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </instancedMesh>
  );
}
