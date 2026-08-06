import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output for the Cloudflare Worker — generated, not authored.
    ".open-next/**",
  ]),
  {
    rules: {
      /*
       * `set-state-in-effect` is a performance heuristic, and every place this
       * app trips it is the case effects exist for: reading something that
       * only exists in a browser, after mount — localStorage-backed compare
       * order, service-worker and push support, the upload queue's snapshot,
       * matchMedia. None of it can be read during render, and hoisting it into
       * a state initialiser is exactly the hydration mismatch this codebase
       * has fixed twice. Left on, it fails the build for correct code.
       */
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
