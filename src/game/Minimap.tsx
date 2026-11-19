// Top-down map of the whole job site: route coloured by progress, landmarks, marked trees, and every machine.
import { useEffect, useRef } from "react";
import { HALF } from "./world";

export interface MapSeg { x1: number; z1: number; x2: number; z2: number; color: string }
export interface MapPin { x: number; z: number; color: string; label: string; r?: number }
/** A tree to be cut: hollow while it is still locked, filled once it can be felled. */
export interface MapTree { x: number; z: number; locked: boolean }
/** Something that moves but is not one of the player's machines (e.g. the NPC tanker): drawn as a square. */
export interface MapMover { x: number; z: number; color: string }
export interface MapInfo { segs: MapSeg[]; pins: MapPin[]; trees?: MapTree[]; movers?: MapMover[] }
export interface MapFrame extends MapInfo { dots: { x: number; z: number; color: string; active: boolean }[] }

const SIZE = 150;
const px = (v: number) => ((v + HALF) / (2 * HALF)) * SIZE;

export default function Minimap({ read }: { read: () => MapFrame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current?.getContext("2d");
      if (!c) return;
      const f = read();
      c.clearRect(0, 0, SIZE, SIZE);
      c.fillStyle = "rgba(24,34,28,0.82)"; c.fillRect(0, 0, SIZE, SIZE);
      c.lineCap = "round"; c.lineWidth = 6;
      for (const s of f.segs) { c.strokeStyle = s.color; c.beginPath(); c.moveTo(px(s.x1), px(s.z1)); c.lineTo(px(s.x2), px(s.z2)); c.stroke(); }
      c.font = "bold 10px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
      for (const p of f.pins) {
        c.fillStyle = p.color; c.beginPath(); c.arc(px(p.x), px(p.z), p.r ?? 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#111"; c.fillText(p.label, px(p.x), px(p.z) + 0.5);
      }
      for (const t of f.trees ?? []) {
        c.beginPath(); c.arc(px(t.x), px(t.z), 2.4, 0, Math.PI * 2);
        if (t.locked) { c.strokeStyle = "#e8d2c4"; c.lineWidth = 1.2; c.stroke(); } else { c.fillStyle = "#ff7a1a"; c.fill(); c.strokeStyle = "#1a1208"; c.lineWidth = 0.8; c.stroke(); }
      }
      for (const m of f.movers ?? []) {
        c.fillStyle = m.color; c.strokeStyle = "#000"; c.lineWidth = 1;
        c.fillRect(px(m.x) - 3.5, px(m.z) - 3.5, 7, 7); c.strokeRect(px(m.x) - 3.5, px(m.z) - 3.5, 7, 7);
      }
      for (const d of f.dots) {
        c.fillStyle = d.color; c.strokeStyle = d.active ? "#fff" : "#000"; c.lineWidth = d.active ? 2.5 : 1;
        c.beginPath(); c.arc(px(d.x), px(d.z), d.active ? 5 : 3.5, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    };
    draw();
    const id = setInterval(draw, 250);
    return () => clearInterval(id);
  }, [read]);
  return <canvas ref={ref} width={SIZE} height={SIZE} className="pointer-events-none rounded-md border-2 border-foreground/80 shadow-lg" aria-label="Map" />;
}
