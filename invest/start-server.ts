import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "./bootstrap.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createInvestHttpServer } from "./http.ts";
import { createLogger } from "./logger.ts";

const webDist = join(fileURLToPath(new URL(".", import.meta.url)), "../apps/invest-web/dist");

async function main() {
	let loaded;
	try {
		loaded = loadConfig();
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(`Configuration error: ${error.message}`);
			process.exit(2);
		}
		throw error;
	}
	const { config, warnings } = loaded;
	const logger = createLogger(config.logLevel);
	for (const w of warnings) logger.warn(w);
	const runtime = await bootstrap(config, logger);
	const server = createInvestHttpServer(runtime, { webDist, logger });
	server.listen(config.port, () => logger.info("Attn Invest listening", { url: `http://localhost:${config.port}`, appport: `http://localhost:${config.port}/appport` }));
	const shutdown = async () => {
		logger.info("Shutting down");
		server.close();
		await runtime.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((error) => {
	console.error("Failed to start Attn Invest:", error instanceof Error ? error.message : error);
	process.exit(1);
});
