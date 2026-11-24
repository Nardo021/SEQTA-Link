import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };
/** Local implementation branch; not production deployment configuration. */
export default defineConfig({
  worker: {
    name: "seqta-link-compatibility-spike",
    compatibilityDate: "2026-11-24",
    entrypoint,
    env: {
      DATABASE: bindings.d1({ name: "seqta-link-spike-local-only" }),
      TOKEN_PEPPER: bindings.secret(),
      UID_SECRET: bindings.secret(),
    },
  },
});
