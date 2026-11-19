// HUD pieces for the construction-site level: sampled from game state ~8x/s by Game.tsx.
import { Star } from "lucide-react";
import type { SiteHud } from "./siteHud";

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Row({ label, value, done }: { label: string; value: string; done?: boolean }) {
  return (
    <li className="flex justify-between">
      <span className={done ? "text-muted-foreground line-through" : ""}>{label}</span>
      <span>{value}</span>
    </li>
  );
}

export function UrbanTasks({ h }: { h: SiteHud }) {
  return (
    <>
      <ul className="mt-3 space-y-1">
        <Row label="Foundation dug" value={`${h.dug}/${h.total}`} done={h.dug >= h.total} />
        <Row label="Spoil hauled out" value={`${h.hauled}/${h.total}`} done={h.hauled >= h.total} />
        <Row label="Floors poured" value={`${h.floors}/${h.floorsTotal}`} done={h.floors >= h.floorsTotal} />
        <Row label="Rooftop plant" value={h.roof ? "done" : "—"} done={h.roof} />
      </ul>
      <div className="mt-2 h-2 bg-muted">
        <div className="h-2 bg-primary" style={{ width: `${((h.hauled / h.total) * 0.15 + (h.floors / h.floorsTotal) * 0.8 + (h.roof ? 0.05 : 0)) * 100}%` }} />
      </div>
      {h.stage >= 2 && <div className="mt-2 text-xs">Next load: <b>{h.next}</b></div>}
      <div className="mt-2 grid grid-cols-3 gap-x-2 text-xs text-muted-foreground">
        <span>Time {fmt(h.time)}</span>
        <span className={h.damage > 3 ? "text-destructive" : ""}>Damage {h.damage}</span>
        <span className={h.traffic > 20 ? "text-destructive" : ""}>Street {Math.floor(h.traffic)}s</span>
      </div>
    </>
  );
}

/** Crane instruments: swing angle, wind, hook height, what is on the hook. Shown while at the controls. */
export function CraneGauges({ h }: { h: SiteHud }) {
  const swing = Math.min(1, h.swing / 15);
  return (
    <div className="pointer-events-none absolute right-4 top-4 w-56 rounded-md border-2 border-foreground/80 bg-card/90 p-3 font-mono text-xs text-card-foreground shadow-lg">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Crane · {h.cam === "cab" ? "cab view" : "overview"}</div>
      <div className="mt-1 text-sm font-bold">{h.load}</div>
      <div className="mt-2 flex justify-between"><span>Hook height</span><span>{Math.max(0, h.hookH).toFixed(1)} m</span></div>
      <div className="flex justify-between"><span>Radius</span><span>{h.trolley.toFixed(1)} m</span></div>
      <div className="mt-1 flex justify-between"><span>Swing</span><span>{h.swing.toFixed(1)}°</span></div>
      <div className="mt-1 h-1.5 bg-muted"><div className={`h-1.5 ${swing > 0.6 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${swing * 100}%` }} /></div>
      <div className="mt-2 flex items-center justify-between">
        <span>Wind</span>
        <span className="flex items-center gap-2">
          {h.wind.toFixed(2)} m/s²
          <span className="inline-block w-4 text-center text-base leading-none" style={{ transform: `rotate(${h.windDir}deg)` }}>→</span>
        </span>
      </div>
    </div>
  );
}

export function UrbanControls({ h }: { h: SiteHud }) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 max-w-xl rounded-md bg-card/85 px-4 py-3 font-mono text-xs text-card-foreground">
      {h.inCrane ? (
        <>
          <b>A/D</b> slew · <b>W/S</b> trolley out/in · <b>↑/↓</b> hoist · <b>Space</b> hook / release · <b>C</b> camera · <b>wheel</b> zoom · <b>E</b> climb down
          <div className="mt-1 text-muted-foreground">
            Swing is real: start and stop smoothly, and ease the load down before you let go. Drops over 1 m hurt, over 3.5 m wreck the load, and nothing may land on the pavement.
          </div>
        </>
      ) : (
        <>
          <b>W/S</b> drive · <b>A/D</b> steer · <b>Space</b> work (hold) · <b>E</b> hop into a machine or the crane (get close) · <b>R</b> recover
          <div className="mt-1 text-muted-foreground">
            Excavator digs the pit and loads the dump truck · Truck hauls spoil to the pad outside the west gate · The crane lifts every delivery onto the building.
          </div>
        </>
      )}
    </div>
  );
}

const Criterion = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
  <li className="flex items-center justify-between gap-6">
    <span className="flex items-center gap-2"><Star className={`h-4 w-4 ${ok ? "fill-primary text-primary" : "text-muted-foreground"}`} />{label}</span>
    <span className="text-muted-foreground">{detail}</span>
  </li>
);

export function UrbanResults({ h, onExit }: { h: SiteHud; onExit: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
      <div className="rounded-md border-2 border-foreground bg-card p-8 font-mono">
        <div className="text-center text-2xl font-bold">Topped out!</div>
        <div className="mt-1 text-center text-muted-foreground">{h.stars.total}/3 stars</div>
        <ul className="mt-4 space-y-2 text-sm">
          <Criterion ok={h.stars.time} label="Efficiency" detail={`${fmt(h.time)}`} />
          <Criterion ok={h.stars.safe} label="Safety" detail={`${h.damage} damage · ${h.exposure.toFixed(0)}s over pavement`} />
          <Criterion ok={h.stars.traffic} label="Traffic" detail={`${Math.floor(h.traffic)}s street blocked`} />
        </ul>
        <button className="pointer-events-auto mt-6 w-full rounded-md border-2 border-foreground px-4 py-2 text-sm font-bold hover:bg-muted" onClick={onExit}>Back to levels</button>
      </div>
    </div>
  );
}
