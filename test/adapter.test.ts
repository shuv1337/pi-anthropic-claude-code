import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AnthropicOptions,
	type Model,
	normalizeContext,
	type ProviderHeaders,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createClaudeCodeProvider } from "../index.ts";

const CLAUDE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const PI_IDENTITY = "You are an expert coding assistant operating inside pi, a coding agent harness.";
const SHUVPI_IDENTITY = "You are an expert coding assistant operating inside shuvpi, a coding agent harness.";
const PI_15_IDENTITY = "You are a coding assistant running inside pi, a coding agent harness.";
const PROMPT = `${PI_IDENTITY}\n${SHUVPI_IDENTITY}\nSHUVPI/path pi/pip π 😀`;
const model: Model<"anthropic-messages"> = {
	id: "claude-test",
	name: "Test",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 4096,
};
const context = normalizeContext({
	systemPrompt: PROMPT,
	messages: [{ role: "user", content: "Do not rewrite shuvpi here", timestamp: 0 }],
	tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }],
});

interface Payload {
	system: Array<{ type: string; text: string; cache_control?: unknown }>;
	messages: Array<{ role: string; content: unknown }>;
	tools?: Array<{ name: string }>;
	metadata?: unknown;
}
interface Capture {
	url: URL;
	headers: Headers;
	body: Payload;
}

function createCaptureFetch() {
	const captures: Capture[] = [];
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		captures.push({ url: new URL(request.url), headers: request.headers, body: (await request.json()) as Payload });
		const events = [
			{
				type: "message_start",
				message: { id: "msg_test", model: "claude-test", usage: { input_tokens: 2, output_tokens: 0 } },
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" },
		];
		return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream", "x-test": "response" },
		});
	};
	return { fetch, captures };
}

for (const method of ["stream", "streamSimple"] as const) {
	test(`${method}: OAuth shaping preserves upstream streaming, identity, tools, usage and hooks`, async () => {
		const { fetch, captures } = createCaptureFetch();
		let payloadCalls = 0;
		let responseCalls = 0;
		let streamEvents = 0;
		const result = await createClaudeCodeProvider()
			[method](model, context, {
				apiKey: "sk-ant-oat-fake",
				sessionId: "session-test",
				cacheRetention: "none",
				fetch,
				onPayload: (payload) => {
					payloadCalls++;
					assert.equal((payload as Payload).system[1].text.includes("SHUVPI"), false);
					return { ...(payload as Payload), metadata: { user_id: "hook-value" } };
				},
				onResponse: (response) => {
					responseCalls++;
					assert.equal(response.headers["x-test"], "response");
				},
				onProviderStreamEvent: () => {
					streamEvents++;
				},
			})
			.result();
		assert.equal(result.stopReason, "stop");
		assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);
		assert.equal(result.usage.totalTokens, 3);
		assert.equal(payloadCalls, 1);
		assert.equal(responseCalls, 1);
		assert.equal(streamEvents, 6);
		assert.equal(captures.length, 1);
		const { url, headers, body } = captures[0];
		assert.equal(url.searchParams.get("beta"), "true");
		assert.equal(headers.get("user-agent"), "claude-cli/2.1.321 (external, cli)");
		assert.equal(headers.get("x-claude-code-session-id"), "session-test");
		assert.equal(headers.get("authorization"), "Bearer sk-ant-oat-fake");
		assert.equal(body.system[0].text, CLAUDE_IDENTITY);
		assert.equal(body.system[1].text, `${CLAUDE_IDENTITY}\n${CLAUDE_IDENTITY}\nClaude/path pi/pip π 😀`);
		assert.equal(body.system[1].cache_control, undefined);
		assert.equal(body.tools?.[0].name, "Read");
		assert.ok(JSON.stringify(body.messages).includes("Do not rewrite shuvpi here"));
		assert.deepEqual(body.metadata, { user_id: "hook-value" });
	});
}

test("rewrites remaining Pi prose like the fork without corrupting upstream paths or packages", async () => {
	const systemPrompt = [
		PI_IDENTITY,
		"Pi documentation: read when asked about pi itself. When working on PI topics, use pi.",
		"Paths: /home/me/.pi/agent /repos/pi/file.ts pi/docs ../pi Windows C:\\pi\\docs",
		"Packages: @earendil-works/pi-ai pi-coding-agent; URLs: https://pi.dev pi.dev",
		"Unrelated: pip pipeline API PI_CODING_AGENT_DIR π",
	].join("\n");
	const transcript = normalizeContext({
		systemPrompt,
		messages: [{ role: "user", content: "Pi documentation pi", timestamp: 0 }],
	});
	for (const apiKey of ["sk-ant-oat-fake", "sk-ant-api-fake"]) {
		const { fetch, captures } = createCaptureFetch();
		await createClaudeCodeProvider().streamSimple(model, transcript, { apiKey, fetch }).result();
		const prompt = captures[0].body.system.at(-1)!.text;
		if (apiKey === "sk-ant-api-fake") {
			assert.equal(prompt, systemPrompt);
			continue;
		}
		assert.ok(prompt.startsWith(CLAUDE_IDENTITY));
		assert.ok(
			prompt.includes(
				"Claude documentation: read when asked about Claude itself. When working on Claude topics, use Claude.",
			),
		);
		for (const line of systemPrompt.split("\n").slice(2)) assert.ok(prompt.includes(line));
		assert.ok(JSON.stringify(captures[0].body.messages).includes("Pi documentation pi"));
		assert.deepEqual(captures[0].body.system.at(-1)!.cache_control, { type: "ephemeral" });
	}
});

test("retains upstream auth and model catalog", () => {
	const upstream = builtinProviders().find((provider) => provider.id === "anthropic")!;
	const wrapped = createClaudeCodeProvider(upstream);
	assert.equal(wrapped.id, "anthropic");
	assert.equal(wrapped.auth, upstream.auth);
	assert.equal(wrapped.getModels, upstream.getModels);
	assert.deepEqual(wrapped.getModels(), upstream.getModels());
});

for (const auth of [{ apiKey: "sk-ant-api-fake" }, { headers: { Authorization: "Bearer gateway-fake" } }]) {
	test(`does not shape ${"apiKey" in auth ? "API-key" : "header-owned Bearer"} requests`, async () => {
		const { fetch, captures } = createCaptureFetch();
		const result = await createClaudeCodeProvider()
			.streamSimple(model, context, { ...auth, fetch })
			.result();
		assert.equal(result.stopReason, "stop");
		assert.equal(captures[0].body.system[0].text, PROMPT);
		assert.equal(captures[0].body.tools?.[0].name, "read");
		assert.equal(captures[0].headers.get("x-claude-code-session-id"), null);
		assert.notEqual(captures[0].headers.get("user-agent"), "claude-cli/2.1.321 (external, cli)");
	});
}

const headerOverrides: ProviderHeaders[] = [
	{ "User-Agent": "caller", "X-Claude-Code-Session-Id": "caller-session" },
	{ "USER-AGENT": null, "X-CLAUDE-CODE-SESSION-ID": null },
];
for (const headers of headerOverrides) {
	test(`request headers override model/defaults including ${headers["User-Agent"] ? "mixed casing" : "null"}`, async () => {
		const { fetch, captures } = createCaptureFetch();
		await createClaudeCodeProvider()
			.streamSimple(
				{ ...model, headers: { "user-agent": "model", "x-claude-code-session-id": "model-session" } },
				context,
				{ apiKey: "sk-ant-oat-fake", sessionId: "session-test", headers, fetch },
			)
			.result();
		assert.equal(captures[0].headers.get("user-agent"), headers["User-Agent"] ?? null);
		assert.equal(captures[0].headers.get("x-claude-code-session-id"), headers["X-Claude-Code-Session-Id"] ?? null);
	});
}

test("model overrides are retained and no session header is invented", async () => {
	const { fetch, captures } = createCaptureFetch();
	await createClaudeCodeProvider()
		.streamSimple({ ...model, headers: { "User-Agent": "model-client" } }, context, {
			apiKey: "sk-ant-oat-fake",
			fetch,
		})
		.result();
	assert.equal(captures[0].headers.get("user-agent"), "model-client");
	assert.equal(captures[0].headers.get("x-claude-code-session-id"), null);
});

test("does not mutate caller options or the transcript", async () => {
	const { fetch } = createCaptureFetch();
	const headers = Object.freeze({ "x-custom": "value" });
	const options = Object.freeze({ apiKey: "sk-ant-oat-fake", headers, fetch });
	const original = structuredClone(context);
	await createClaudeCodeProvider().streamSimple(model, context, options).result();
	assert.deepEqual(context, original);
	assert.deepEqual(options.headers, { "x-custom": "value" });
});

test("native mid-conversation system updates are not broadly rewritten", async () => {
	const { fetch, captures } = createCaptureFetch();
	const transcript = structuredClone(context);
	transcript.messages.push({ role: "system", content: [{ type: "text", text: "shuvpi later" }], timestamp: 1 });
	await createClaudeCodeProvider()
		.streamSimple({ ...model, compat: { supportsMidConvoSystemMessages: true } }, transcript, {
			apiKey: "sk-ant-oat-fake",
			fetch,
		})
		.result();
	assert.ok(JSON.stringify(captures[0].body.messages).includes("shuvpi later"));
});

test("delegates unrelated providers and injected clients without altering their options", async () => {
	const upstream = builtinProviders().find((provider) => provider.id === "anthropic")!;
	const seen: unknown[] = [];
	const wrapped = createClaudeCodeProvider({
		...upstream,
		stream: (model, context, options) => {
			seen.push(options);
			return upstream.stream(model, context, options);
		},
		streamSimple: (model, context, options) => {
			seen.push(options);
			return upstream.streamSimple(model, context, options);
		},
	});
	const { fetch } = createCaptureFetch();
	const options: SimpleStreamOptions = { apiKey: "sk-ant-oat-fake", fetch };
	await wrapped.streamSimple({ ...model, provider: "github-copilot" }, context, options).result();
	assert.equal(seen[0], options);
	// A pre-built client must not be treated as OAuth just because apiKey is also supplied.
	const clientOptions: AnthropicOptions = { apiKey: "sk-ant-oat-fake", client: {} as AnthropicOptions["client"] };
	await wrapped.stream(model, context, clientOptions).result();
	assert.equal(seen[1], clientOptions);
});

test("forwards cancellation without sending an HTTP request", async () => {
	const controller = new AbortController();
	controller.abort();
	const { fetch, captures } = createCaptureFetch();
	const result = await createClaudeCodeProvider()
		.streamSimple(model, context, {
			apiKey: "sk-ant-oat-fake",
			signal: controller.signal,
			fetch,
		})
		.result();
	assert.equal(result.stopReason, "aborted");
	assert.equal(captures.length, 0);
});

test("loads the installed extension through a real SDK session without real credentials or network", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-anthropic-adapter-"));
	const settingsManager = SettingsManager.inMemory({
		packages: [],
		extensions: [],
		compaction: { enabled: false },
		cacheWarming: "off",
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: directory,
		agentDir: directory,
		settingsManager,
		additionalExtensionPaths: [join(dirname(fileURLToPath(import.meta.url)), "../index.ts")],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	const originalFetch = globalThis.fetch;
	const { fetch, captures } = createCaptureFetch();
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		// Guard every HTTP request, including accidental provider calls during setup.
		globalThis.fetch = fetch;
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		assert.equal(resourceLoader.getExtensions().extensions.length, 1);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(directory, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(directory, "models-store.json"),
			refreshOnCreate: false,
			allowModelNetwork: false,
		});
		await modelRuntime.setRuntimeApiKey("anthropic", "sk-ant-oat-fake");
		({ session } = await createAgentSession({
			cwd: directory,
			agentDir: directory,
			resourceLoader,
			settingsManager,
			modelRuntime,
			model,
			thinkingLevel: "off",
			tools: [],
			sessionManager: SessionManager.inMemory(directory),
		}));
		await session.bindExtensions({});
		await session.prompt("Hello");
		assert.equal(session.getLastAssistantText(), "ok");
		assert.equal(captures.length, 1);
		assert.equal(captures[0].headers.get("user-agent"), "claude-cli/2.1.321 (external, cli)");
		assert.equal(captures[0].headers.get("x-claude-code-session-id"), session.sessionManager.getSessionId());
		assert.ok(captures[0].body.system.every((block) => !block.text.includes(PI_IDENTITY)));
		assert.ok(captures[0].body.system.every((block) => !block.text.includes(PI_15_IDENTITY)));
		assert.ok(!captures[0].body.system.some((block) => block.text.includes("running inside Claude")));
		const sentPrompt = captures[0].body.system.map((block) => block.text).join("\n");
		assert.ok(sentPrompt.includes("Claude documentation"));
		assert.ok(sentPrompt.includes(`${CLAUDE_IDENTITY} Help users inspect files`));
		assert.ok(sentPrompt.includes("When reading Claude docs"));
		assert.ok(!sentPrompt.includes("Pi documentation"));
		assert.ok(sentPrompt.includes("@earendil-works/pi-coding-agent"));
		assert.ok(sentPrompt.includes(`<cwd>\n${directory}\n</cwd>`));
	} finally {
		session?.dispose();
		globalThis.fetch = originalFetch;
		await rm(directory, { recursive: true, force: true });
	}
});
