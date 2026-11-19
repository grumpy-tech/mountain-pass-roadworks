import { createFileRoute } from "@tanstack/react-router";
import Game from "@/game/Game";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pass Builder — Mountain Road Construction Game" },
      { name: "description", content: "Clear rocks, grade dirt and pave a winding road through a low-poly mountain pass." },
      { property: "og:title", content: "Pass Builder — Mountain Road Construction Game" },
      { property: "og:description", content: "Clear rocks, grade dirt and pave a winding road through a low-poly mountain pass." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Game,
});
