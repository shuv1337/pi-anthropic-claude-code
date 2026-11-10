import type { Api, Model, Provider, ProviderHeaders, StreamOptions } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
// Matches the fork and upstream Pi 1.4.0. Keep this in sync when upgrading the host.
const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.321 (external, cli)";
const PI_IDENTITY = "You are an expert coding assistant operating inside pi, a coding agent harness.";
const SHUVPI_IDENTITY = "You are an expert coding assistant operating inside shuvpi, a coding agent harness.";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeOAuthOptions<T extends StreamOptions>(model: Model<Api>, options: T | undefined): T | undefined {
	// Header-owned Bearer auth is not OAuth mode in upstream. Injected clients own their shaping.
	if (
		model.provider !== "anthropic" ||
		model.api !== "anthropic-messages" ||
		!options?.apiKey?.includes("sk-ant-oat") ||
		("client" in options && options.client)
	) {
		return options;
	}

	const headers: ProviderHeaders = {
		"user-agent": CLAUDE_CODE_USER_AGENT,
		...(options.sessionId ? { "x-claude-code-session-id": options.sessionId } : {}),
	};
	// Preserve model < request precedence, including explicit null suppression and mixed casing.
	for (const source of [model.headers, options.headers]) {
		for (const [name, value] of Object.entries(source ?? {})) {
			headers[name.toLowerCase()] = value;
		}
	}

	return {
		...options,
		headers,
		onPayload: async (payload: unknown, requestModel: Model<Api>) => {
			// Only the top-level initial system text is rewritten, never conversation/tool content.
			// Upstream owns the first Claude Code identity block, tool casing, betas and streaming.
			const shaped =
				isRecord(payload) && Array.isArray(payload.system)
					? {
							...payload,
							system: payload.system.map((block: unknown) =>
								isRecord(block) && block.type === "text" && typeof block.text === "string"
									? {
											...block,
											text: block.text
												.replace(PI_IDENTITY, CLAUDE_CODE_IDENTITY)
												.replace(SHUVPI_IDENTITY, CLAUDE_CODE_IDENTITY)
												.replace(/shuvpi/gi, "Claude")
												// Pi prose also occurs in the built-in documentation section. Keep paths/package IDs usable.
												.replace(/(?<![\w./\\@-])pi(?![\w/\\@-]|\.[\w])/gi, "Claude"),
										}
									: block,
							),
						}
					: payload;
			// As in the fork, caller hooks see the shaped payload and may explicitly replace it.
			return (await options.onPayload?.(shaped, requestModel)) ?? shaped;
		},
	};
}

export function createClaudeCodeProvider(provider?: Provider): Provider {
	// Pi 1.4.0 aliases providers/all, but not individual provider subpaths, in its extension loader.
	const upstream = provider ?? builtinProviders().find((candidate) => candidate.id === "anthropic");
	if (!upstream) throw new Error("The upstream Anthropic provider is unavailable");
	return {
		...upstream,
		stream: (model, context, options) => upstream.stream(model, context, shapeOAuthOptions(model, options)),
		streamSimple: (model, context, options) =>
			upstream.streamSimple(model, context, shapeOAuthOptions(model, options)),
	};
}

export default function anthropicClaudeCode(pi: ExtensionAPI): void {
	pi.registerProvider(createClaudeCodeProvider());
}
