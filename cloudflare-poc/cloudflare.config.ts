import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

/** Isolated, non-production, no routes or secrets. No remote D1 resource exists yet. */
export default defineConfig({
  worker: {
    name: "seqta-link-compatibility-spike",
    compatibilityDate: "2026-11-24",
    entrypoint,
    env: {
      DATABASE: bindings.d1({ name: "seqta-link-spike-local-only" }),
    },
  },
});
