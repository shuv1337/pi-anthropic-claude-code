# Anthropic Claude Code adapter for upstream Pi

A headless-compatible provider extension, tested with upstream Pi 1.4.0. No fork runtime, new credentials, extra tools, or paid fallback.

For OAuth-shaped Anthropic keys only:

- Use `claude-cli/2.1.321 (external, cli)` and send `X-Claude-Code-Session-Id` when a session ID is supplied, including with caching disabled.
- Replace the exact stock Pi/Shuvpi harness identity sentence with the Claude Code identity.
- Retain the fork's case-insensitive `shuvpi` → `Claude` replacement in initial system text.
- Rewrite standalone `pi` prose in initial system text (including Pi's documentation guidance) to `Claude`, without rewriting Pi path segments, package IDs, URLs, or environment variable names.
- Preserve model/request header overrides, including explicit `null` suppression.

Normal API keys, header-owned gateway auth, other providers, injected clients, user messages, tool results, and native mid-conversation system updates are not rewritten. Upstream still owns authentication/refresh, model discovery, tool-name conversion, betas, streaming, usage, cancellation, and retries. Its Anthropic SDK already appends `beta=true`.

Caller payload hooks run **after** shaping, as in the fork, and can replace the payload. System text containing Shuvpi paths/instructions is also affected by the retained broad replacement. Tokens and payloads are never logged.

## Installation on this machine

`~/.pi/agent/settings.json` explicitly loads:

```json
{
  "extensions": [
    "/home/shuv/repos/pi-anthropic-claude-code/index.ts"
  ]
}
```

Other settings/packages stay unchanged. Run `/reload` in an existing Pi session, or start a new one. Remove only this path to uninstall. The implementation is in this repo, but imports exclusively upstream Pi packages. Keep the source path available or move the package and update the setting.

For other machines, this directory is a local Pi package: `pi install /path/to/anthropic-claude-code`. Do not separately install or bundle copies of host peer packages.

## Programmatic use

Load `index.ts` through `DefaultResourceLoader.additionalExtensionPaths` and bind the session's extensions. Alternatively, import `createClaudeCodeProvider()` into a host and install the provider in its model runtime. Each separately constructed child runtime needs the provider too; installation in the CLI's config is not a global override of standalone Pi AI calls.

Pi 1.4.0's extension loader supports the `providers/all` alias but breaks individual provider subpath imports. The adapter uses `builtinProviders()` from that supported alias and selects Anthropic. Authentication and the catalog are retained, not copied.

## Development

This is a standalone repository extracted from `shuv1337/shuvpi`'s `extensions/anthropic-claude-code` directory. The TypeScript config no longer depends on the parent monorepo.

With peer dependencies and TypeScript / Node types available locally:

```bash
node --test test/adapter.test.ts
tsc --project tsconfig.json
```

`node_modules` is ignored; local host-package links are not published. Tests use fake credentials and intercepted HTTP, including a real SDK session and extension loading. No tests call Anthropic.

Extraction verification against the installed Pi 1.5.1 failed before tests ran: `@earendil-works/pi-ai` no longer exports `Type`, which the test imports. The prior Pi 1.4.0 verification described above is historical, not a claim of compatibility with 1.5.1. The adapter implementation is unchanged; upgrading the tests and verifying current-host compatibility remain follow-up work.

The user-agent version deliberately matches the fork and tested upstream version. Recheck it and the captured-request tests when upgrading Pi.

**Request compatibility is not a guarantee of subscription billing or account acceptance.** No live account/billing validation has been performed.
