import { expect, it } from "bun:test";
import { getTelemetryClient } from "@feltdb/core";
import { createHarness } from "../testing/harness.ts";

it("opening the store switches FeltDB's outbound adoption telemetry off", async () => {
	const h = await createHarness();
	try {
		expect(process.env.FELTDB_TELEMETRY).toBe("0");
		expect((getTelemetryClient() as unknown as { enabled: boolean }).enabled).toBe(false);
	} finally {
		await h.close();
	}
});
