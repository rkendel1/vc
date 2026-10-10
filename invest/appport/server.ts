import { type AppPortServer, createApplication, createServer, permissionAuthorizer } from "@appport/sdk";
import { type AuthBoundryAuthority, createInvestAuthenticate } from "../auth/authboundry-adapter.ts";
import type { InvestmentService } from "../service.ts";
import { investCapabilities } from "./capabilities.ts";

export const INVEST_APPLICATION_ID = "com.rkendel1.attn.invest";
export const INVEST_APPLICATION_VERSION = "0.1.0";
const DEFAULT_MAX_UPLOAD = 20 * 1024 * 1024;

export function investApplication(service?: InvestmentService, maxUploadBytes = DEFAULT_MAX_UPLOAD) {
	return createApplication({
		application: {
			id: INVEST_APPLICATION_ID,
			name: "Attn Invest",
			version: INVEST_APPLICATION_VERSION,
			description: "Jev for Investment Evaluation: versioned theses, traceable evidence, bounded Jev judgments and auditable human decisions.",
		},
		capabilities: investCapabilities({ maxUploadBytes }),
		authorizer: permissionAuthorizer(),
		services: { invest: service },
		mode: "production",
	});
}

/** Base64 inflates uploads by 4/3; leave room for the envelope around them. */
export function envelopeLimit(maxUploadBytes: number): number {
	return Math.ceil((maxUploadBytes * 4) / 3) + 256 * 1024;
}

export function createInvestAppPortServer(options: { service: InvestmentService; authority: AuthBoundryAuthority; maxUploadBytes: number }): AppPortServer {
	return createServer({
		application: investApplication(options.service, options.maxUploadBytes),
		authenticate: createInvestAuthenticate(options.authority, INVEST_APPLICATION_ID),
		maxEnvelopeBytes: envelopeLimit(options.maxUploadBytes),
	});
}

/** Used by `appport build --config invest/appport.config.ts` to generate the manifest and client. Serves nothing. */
export const server = createServer({ application: investApplication() });
