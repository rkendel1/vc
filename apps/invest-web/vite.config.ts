import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://localhost:${process.env.INVEST_PORT ?? 3100}`;

export default defineConfig({
	plugins: [react()],
	server: {
		port: Number(process.env.INVEST_WEB_PORT ?? 5174),
		proxy: { "/appport": server, "/files": server },
	},
	build: { sourcemap: false },
});
