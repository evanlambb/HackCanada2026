import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: ["@babylonjs/core", "@babylonjs/loaders"],
  },
});
