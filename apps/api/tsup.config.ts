import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them; keep npm packages external.
  noExternal: [/^@whizchool\//],
});
