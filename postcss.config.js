import { fileURLToPath } from "node:url";

export default {
  plugins: {
    // Resolve from this file rather than process.cwd(): the restore drill and the
    // bootstrap e2e test run the dev server from a temporary workspace.
    tailwindcss: { config: fileURLToPath(new URL("./tailwind.config.ts", import.meta.url)) },
    autoprefixer: {},
  },
};
