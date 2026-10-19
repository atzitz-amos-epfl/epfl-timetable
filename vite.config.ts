import { defineConfig } from "vite";

// Relative asset paths: the built site is served from a sub-folder on GitHub Pages
// (https://atzitz-amos-epfl.github.io/epfl-timetable/dist/), not from the domain root.
export default defineConfig({
  base: "./",
});
