import { timingSafeEqual } from "node:crypto";
import type { JevDecisionRequest } from "../jev/jev-client.ts";
import { lexicalJudge } from "./harness.ts";

/**
 * A Jev stand-in for development and end-to-end tests. It speaks the real HTTP contract
 * (POST JevDecisionRequest → JevDecisionResponse, bearer-authenticated) and answers with a crude
 * lexical heuristic. It is not Jev and makes no semantic judgment worth trusting; run the app with
 * JEV_PROVIDER=standin so every manifest says so.
 *
 *   JEV_STANDIN_PORT=4500 JEV_STANDIN_KEY=dev-jev-key bun invest/testing/jev-standin.ts
 */
export function startJevStandin(options: { port: number; apiKey: string }) {
	const expected = Buffer.from(`Bearer ${options.apiKey}`);
	return Bun.serve({
		port: options.port,
		hostname: "127.0.0.1",
		async fetch(req) {
			if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
			const given = Buffer.from(req.headers.get("authorization") ?? "");
			if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Unauthorized", { status: 401 });
			let body: JevDecisionRequest;
			try {
				body = (await req.json()) as JevDecisionRequest;
			} catch {
				return new Response("Bad JSON", { status: 400 });
			}
			if (body.kind !== "choice" || !Array.isArray(body.options)) return Response.json({ error: "only choice decisions are supported by the stand-in" }, { status: 422 });
			return Response.json(lexicalJudge(body));
		},
	});
}

if (import.meta.main) {
	const port = Number(process.env.JEV_STANDIN_PORT ?? 4500);
	const apiKey = process.env.JEV_STANDIN_KEY ?? "dev-jev-key";
	startJevStandin({ port, apiKey });
	console.log(`Jev stand-in (lexical heuristic, not Jev) on http://127.0.0.1:${port}/decide`);
}
