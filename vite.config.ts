import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "1" ? "/casksight/" : "/",
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
