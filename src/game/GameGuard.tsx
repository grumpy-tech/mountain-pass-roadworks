// Safety net for the 3D game: if anything throws while it runs, show the real error (so it can be
// reported) instead of a generic "page didn't load", and explain up front when WebGL is unavailable.
import { Component, type ErrorInfo, type ReactNode } from "react";

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

interface Props { children: ReactNode; onBack(): void }
interface State { error: Error | null }

export class GameBoundary extends Component<Props, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error("Game crashed:", error, info.componentStack); }
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const detail = [String(error.message || error), ...(error.stack ?? "").split("\n").slice(1, 7)].join("\n");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 font-mono text-foreground">
        <h1 className="text-2xl font-bold">The game hit an error</h1>
        <p className="max-w-xl text-center text-sm text-muted-foreground">
          Please copy the text below when you report it. Refreshing or going back to the menu usually gets you going again.
        </p>
        <pre role="alert" className="max-h-64 w-full max-w-2xl overflow-auto rounded-md border-2 border-foreground bg-card p-3 text-xs text-card-foreground">{detail}</pre>
        <div className="flex gap-3">
          <button type="button" onClick={() => { this.setState({ error: null }); this.props.onBack(); }} className="rounded-md border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground">Back to menu</button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-md border-2 border-foreground bg-card px-4 py-2 font-bold text-card-foreground">Reload</button>
        </div>
      </main>
    );
  }
}

export function NoWebGL({ onBack }: { onBack(): void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center font-mono text-foreground">
      <h1 className="text-2xl font-bold">3D graphics are not available</h1>
      <p className="max-w-xl text-sm text-muted-foreground">
        Your browser could not start WebGL, which the game needs. Turn on hardware acceleration in the browser settings, update your graphics drivers, or try Chrome, Edge or Firefox.
      </p>
      <button type="button" onClick={onBack} className="rounded-md border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground">Back to menu</button>
    </main>
  );
}
