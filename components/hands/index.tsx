"use client";

// SSR-safe entry point: `import HandsScene from "@/components/hands"`.
// The three.js bundle is only loaded in the browser, on demand.

import dynamic from "next/dynamic";
import type { HandsSceneProps } from "./HandsScene";

export type { HandsSceneProps, HandsCamera } from "./HandsScene";

const HandsScene = dynamic<HandsSceneProps>(() => import("./HandsScene"), {
  ssr: false,
  loading: () => (
    <div
      data-testid="hands-scene"
      data-hands-status="loading"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 8,
        font: "500 12px var(--font-sans, system-ui, sans-serif)",
        color: "var(--sub, #7d8896)",
      }}
    >
      loading hands…
    </div>
  ),
});

export default HandsScene;
export { HandsScene };
