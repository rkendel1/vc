import { defineConfig } from "appport";

// AppPort contract for Attn Invest. `appport build --config invest/appport.config.ts` writes the
// manifest and the typed client the web app consumes; CI checks they are current.
export default defineConfig({
	entry: "./invest/appport/server.ts",
	outDir: "./invest/appport/generated",
	manifestPath: "./invest/appport/manifest.json",
	dev: { port: 4410, host: "127.0.0.1", cors: [], studio: false },
});
