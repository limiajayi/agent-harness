# Agent Harness

I'm building an agentic AI harness following [@ghuntley's tutorial](https://github.com/ghuntley/how-to-build-a-coding-agent) on building an agent, except it's in TypeScript and works with more than one model provider (Ollama with Qwen3-vl:4b locally, or Gemini in the cloud). On top of the tutorial's core loop I've added an MCP client, so the agent can use tools from MCP servers (currently GitHub and Exa web search) exactly like its built-in tools.

<img src="./demos/demo.gif" alt="Demo of the agent harness in action" />

[![Architecture diagram of limiajayi/agent-harness](https://gitdiagram.com/limiajayi/agent-harness/diagram.png)](https://gitdiagram.com/limiajayi/agent-harness?utm_source=readme&utm_medium=picture)

## Project layout

```text
agent-harness/
├── .env                      # secrets (never committed)
├── package.json
├── docker/
│   └── exa/
│       └── Dockerfile        # image for the Exa MCP server (pinned, non-root)
└── src/
    ├── index.ts              # entry point: parses flags, builds the tool list, starts MCP servers, runs the agent
    ├── agent.ts              # Agent class: chat loop, tool execution, approval prompts
    ├── provider.ts           # provider-neutral types (ToolSpec, ChatMessage, ...) and the createModel() factory
    ├── shared.ts             # user input reader, workspace paths, timeouts, ignore list
    ├── providers/
    │   ├── ollama.ts         # ChatModel for Ollama (only file that imports the Ollama SDK)
    │   ├── gemini.ts         # ChatModel for Gemini (only file that imports the Gemini SDK)
    │   └── PROVIDERS.md      # notes on providers
    ├── tools/
    │   ├── read_file.ts      # local tool
    │   ├── list_files.ts     # local tool
    │   └── bash_tool.ts      # local tool (always asks for approval)
    ├── mcp/
    │   ├── client.ts         # JSON-RPC 2.0 over stdio, MCP handshake, tools/list
    │   ├── adapter.ts        # turns an MCP tool into a ToolDefinition
    │   ├── config.ts         # how to launch each server (GitHub, Exa) and which env vars each gets
    │   └── manager.ts        # starts servers, collects their tools, shuts them down
    └── test/                 # fake MCP server and process-kill experiments
```

## Running it

### Prerequisites

- Node v24
- pnpm v12
- Docker (running) for the MCP servers
- Ollama v0.4 and a tool-capable model (default `qwen3-vl:4b`), if using the local provider
- A Gemini API key, if using the Gemini provider
- A GitHub fine-grained personal access token, for the GitHub server
- An Exa API key, for the Exa server

Each MCP server is optional. If its key is missing, it's skipped with a message.

### Secrets

Create a `.env` file in the project root (don't commit it):

```bash
GEMINI_API_KEY=...
GITHUB_PERSONAL_ACCESS_TOKEN=...
EXA_API_KEY=...
# Windows only: path prefix used to find the workspace and Git Bash (see shared.ts and bash_tool.ts)
MAIN_PATH=...
```

For the GitHub token, use a **fine-grained** token limited to the repositories you want, with read-only permissions (for example, read access to code and metadata). Tools for issues or pull requests need the matching read permission, otherwise they return an error. Never use a broader token than you need.

### Setup

```bash
pnpm i

# GitHub MCP server image (pinned)
docker pull ghcr.io/github/github-mcp-server:v2.0.3

# Exa MCP server image (built locally from docker/exa)
docker build -t exa-mcp:3.4.3 docker/exa
```

### Run

```bash
pnpm dev
```

End the conversation with CTRL + C. A quick `docker ps` check in terminal should show no containers running after the conversation has ended.

### Options

Additional, optional flags can be added to this, for example:

```bash
pnpm dev --provider ollama --model qwen3:8b --verbose
pnpm dev --provider gemini --model gemini-3-flash-preview --verbose
pnpm dev --provider gemini --github-write   # also expose GitHub write tools (each still asks for approval)
```

This is to allow for other, additional providers to be added in the future.

With `--verbose` you'll see the MCP handshake (`initialized: ...`), the tool list for each server, and every JSON-RPC message in both directions.

## How a turn works

```text
you ──► Agent (agent.ts) ──► ChatModel (Ollama | Gemini)
            │
            ▼
      ToolDefinition[]
      ├─ local tools:  read_file, list_files, bash
      └─ MCP tools:    github__*, exa__*
                │
                ▼
         McpStdioClient ──(JSON-RPC over stdin/stdout)──► docker run -i ... (GitHub server / Exa server)
```

1. `index.ts` builds one list of `ToolDefinition`s: the local tools plus whatever the MCP servers advertise.
2. `Agent` sends the conversation and the tool list to the model.
3. If the model asks for tools, `Agent` runs each one. Tools with `needsApproval: true` ask `y/N` first.
4. Results go back to the model, up to `MAX_TOOL_ROUNDS` (10) per turn.

The agent doesn't know which tools are local and which are MCP. That's the point of the adapter.

## MCP support

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) is a convention on top of JSON-RPC 2.0 for letting an AI app use tools hosted by other programs. My harness is the **client**; the GitHub and Exa servers are the **servers**. The model never talks to MCP. It only asks the harness to run a tool.

- **Transport:** stdio. The client starts the server as a child process and exchanges one JSON message per line over stdin/stdout.
- **Protocol revision implemented:** `2025-11-25`. The flow is `initialize` -> `notifications/initialized` -> `tools/list`. The newest revision (`2026-07-28`) removes this handshake in favour of a stateless design, which hasn't been implemented.
- **Connected servers:**
  - **GitHub** (official `github/github-mcp-server` image): read-only by default, 27 tools.
  - **Exa** (`exa-mcp-server`): web search and page fetching, run from my own pinned image.
- **Tool names** are prefixed with the server name (`github__get_commit`, `exa__web_search_exa`) so they can't collide with local tools or with each other.
- **If a server fails to start** (missing key, Docker not running, timeout), it logs a clear error and is skipped. The agent still starts with the other tools.

## Architectural decisions

| Decision | Why |
|---|---|
| **Hand-written MCP client instead of the official SDK** | Wanted to understand the protocol (request ids, notifications, the handshake) before hiding it behind a library. The cost is transport is maintained manually |
| **stdio transport, not HTTP** | It's the simplest transport, needs no network or auth layer, and works for local containers. Hosted (remote) MCP servers need a second transport that hasn't been built in yet |
| **Agent and providers untouched** | The only integration point is `index.ts` building the tool list. MCP is purely additive, so it can't break the core loop. |
| **`ToolDefinition` adapter** | An MCP tool is converted into the same shape as `read_file`, so the agent's approval, logging and error handling apply to it with no changes. |
| **Approval derived from MCP annotations** | A tool only skips the approval prompt if the server marks it `readOnlyHint: true`. Missing annotations, `readOnlyHint: false` and `destructiveHint: true` all ask first. Annotations are hints from the server, not guarantees, so unknown tools default to asking. |
| **GitHub is read-only by default** | The server runs with `GITHUB_READ_ONLY=1`, so write tools don't even exist. Enabling them needs a deliberate `--github-write` flag. |
| **Only the env vars each server needs** | Each child process gets a short allowlist (`PATH` and a few OS basics) plus its own secret, not all of `process.env`. Exa never sees the GitHub token, and the other way round. |
| **Secrets never logged** | Anything a server prints that contains a configured secret is redacted before it reaches the verbose log. Docker forwards the token with `-e NAME` (no value), so it never appears in a command line. |
| **Servers run in containers** | See below. |
| **Pinned versions** | The GitHub image and the Exa package are pinned to exact versions so an update can't silently change what runs on my machine. |
| **Output cap** | Tool results are cut at 20,000 characters (`adapter.ts`) so one huge file or page can't flood the context window or the provider. |
| **Windows launcher handling** | `npx`/`npm`/`pnpm` are `.cmd` files on Windows and can't be spawned directly. `client.ts` launches them through `cmd.exe /c`. `shell: true` with an args array is deprecated on Node 24 because arguments aren't escaped. |

### Why the MCP servers run in containers

A local MCP server is someone else's code (plus all its dependencies) running with my user permissions. Running it with plain `npx` would give it access to my files, including `.env`.

- **GitHub:** the official image is used as-is. The server only sees what's passed in it.
- **Exa:** I build a small image (`docker/exa/Dockerfile`) from `node:24-slim` with `exa-mcp-server` installed at a pinned version using `--ignore-scripts`, running as the non-root `node` user. It's started with `--cap-drop ALL` and `no-new-privileges`. It has outbound network access (it has to reach Exa) but no access to my filesystem.
- A practical bonus: starting Exa through `npx` from inside this repo failed, because npm refused to run in a project whose `package.json` requires pnpm (`devEngines.packageManager`). A container doesn't read the project's config at all.

A container is not a perfect sandbox. It limits what the server can see, but it doesn't stop prompt injection (see below).

## Why it's provider independent

Everything model-specific lives behind one interface in `provider.ts`:

```ts
interface ChatModel {
    complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply>;
}
```

- **Local models are limited.** A small model on a laptop has a tiny context window, is slow and tends to forget (see "Getting by limitations" below). Being able to switch to a hosted model with `--provider gemini` means getting past that without rewriting the harness.
- **Hosted free tiers run out.** Hosted models mean rate and quota limits. With a common interface I can fall back to Ollama with one flag.
- **Providers disagree on details.** Gemini needs thought signatures echoed back unchanged (stored in `ToolCall.raw`) and has its own rules about tool names. Ollama doesn't. Keeping those quirks inside `src/providers/` means the agent, the tools and the MCP client never need to know.
- **Only `providers/` imports an SDK.** Nothing outside it imports `ollama` or `@google/genai`, so adding another provider is one new file plus a case in `createModel`.
- **MCP is provider-independent too.** The client only produces `ToolDefinition`s, so the same GitHub and Exa tools work with any provider.

## How this deviates from the tutorial

- **TypeScript instead of Go**, running on Node with `tsx`.
- **Multiple providers** behind a `ChatModel` interface instead of one hard-wired model.
- **Approval gate** (`y/N`) on tools that can change things. A denial is returned to the model as text, not thrown, so the model can adapt instead of crashing the loop.
- **Errors as text:** tool failures come back to the model as `error: ...`. Nothing throws out of the loop.
- **Secrets from `.env`** (loaded with Node's `--env-file-if-exists`), never hardcoded.
- **An MCP client**, which lets the agent use external tools without writing each one by hand.

## Privacy and safety

- **Tool output goes to the model provider.** With a hosted provider like Gemini, anything a tool returns (GitHub file contents, issue text, search results) is sent to that provider. Use Ollama if that matters.
- **Tool results are untrusted data, not instructions.** A GitHub issue or a web page can contain text written to manipulate the model (prompt injection). The defences are the approval gate on anything that can write, GitHub's read-only default, and a minimally scoped token.
- **The ignore list only covers local file tools.** `isSkipped` in `shared.ts` blocks things like `.env`, `.git` and key files for `read_file`/`list_files`, but it doesn't apply to MCP tools.
- **`bash` always asks for approval** and currently runs on the host, not in a container (see open issues).

## Getting by limitations

There are a lot of limitations from using a local model as the main model for a harness. The limitations include:

- Context window gets filled quickly which means it gets less accurate with every inference call.
- A local model is a lot slower than a hosted model.
- No separate GPU on a personal device.
- The percentage of RAM the Ollama server is using at any given point.
- Personal device slows down.

MCP makes the context problem worse: every tool's schema is sent on every request (GitHub alone adds 27), so keep the connected tool list small when using a local model.

Here are some ways to curb those limitations:

### Ollama settings

Passing parameters like `think: false` and `num_ctx: 1000` means the harness is manageable device wise but then it tends to forget things as conversation length grows. If a response grows quicker than `num_ctx`, Ollama cuts off the response.

```typescript
const response = await this.client.chat({
        model: MODEL,
        messages: this.conversation,
        think: false,
        tools: ollamaTools,
        options: {
            num_ctx: NUM_CTX,
        },
    });
```

### Changing provider

The local model limits can be bypassed by using a different provider (ChatGPT, Claude, Gemini, etc) that is hosted online and has better software. The harness already has in built ways to anticipate for different providers within `provider.ts` and `src/providers`

Basically going from local, open model to online, hosted model. This option can get expensive quickly.
