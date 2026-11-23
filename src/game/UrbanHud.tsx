// Crane instrument panel for the Tower Block level (the shell draws everything else).
import type { SiteHud } from "./siteHud";

/** Crane instruments: swing angle, wind, hook height, what is on the hook. Shown while at the controls. */
export function CraneGauges({ h }: { h: SiteHud }) {
  const swing = Math.min(1, h.swing / 15);
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 w-56 rounded-md border-2 border-foreground/80 bg-card/90 p-3 font-mono text-xs text-card-foreground shadow-lg">
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
