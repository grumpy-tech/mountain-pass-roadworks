import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameBoundary, NoWebGL, webglAvailable } from "./GameGuard";

function Boom(): never { throw new Error("shader exploded"); }

describe("game guard", () => {
  it("shows the real error message instead of a generic page", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GameBoundary onBack={() => {}}><Boom /></GameBoundary>);
    expect(screen.getByRole("alert").textContent).toContain("shader exploded");
    expect(screen.getByText("Back to menu")).toBeTruthy();
  });

  it("renders children when nothing goes wrong", () => {
    render(<GameBoundary onBack={() => {}}><p>fine</p></GameBoundary>);
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("explains missing WebGL (jsdom has none)", () => {
    expect(webglAvailable()).toBe(false);
    render(<NoWebGL onBack={() => {}} />);
    expect(screen.getByText(/hardware acceleration/)).toBeTruthy();
  });
});
