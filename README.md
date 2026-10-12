# Agent Harness

I'm building an agentic AI harness following [@ghuntley's tutorial](https://github.com/ghuntley/how-to-build-a-coding-agent) on building an agent, except it's in Typescript using Ollama with Qwen3-vl:4b as my chosen model.

## How to Use

### Prerequisites

- Ollama
- Node
- pnpm
- A model that can supports tool use (in this case I've chosen Qwen3-vl:4b)

Run this command in terminal:

```bash
pnpm run dev
```

This runs `src/list_files.ts` and gives the user the ability to interact, read files and list files within a given directory.

### Some limitations

- Context window gets filled quickly which means it gets less accurate with every inference call
- A local model is a lot slower than a model in the cloud
