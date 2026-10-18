# Agent Harness

I'm building an agentic AI harness following [@ghuntley's tutorial](https://github.com/ghuntley/how-to-build-a-coding-agent) on building an agent, except it's in Typescript using Ollama with Qwen3-vl:4b as my chosen model.

## How to Use

### Prerequisites

- Ollama v0.4
- Node v24
- pnpm v12
- Any model that can supports tool use (in this case I've chosen Qwen3-vl:4b)

Run these command in terminal:

```bash
pnpm i
pnpm dev 
```

### Options

Additional, optional flags can be added to this, for example:

```bash
pnpm dev --provider ollama --model qwen3:8b --verbose
pnpm dev --provider gemini --model gemini-4-argon --verbose
```

This is to allow for other, additional providers to be added in the future.

## Getting by limitations

There are a lot of limitations from using a local model as the main model for a harness. The limitations include:

- Context window gets filled quickly which means it gets less accurate with every inference call
- A local model is a lot slower than a model in the cloud
- No separate GPU on a personal device
- The percentage of RAM the Ollama server is using at any given point
- Personal device slowing down

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

### Harness limits

### Measurements
