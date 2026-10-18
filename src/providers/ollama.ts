import { randomUUID } from "node:crypto";
import { type Message, Ollama, type Tool } from "ollama";
import type {
    ChatMessage,
    ChatModel,
    ModelReply,
    ProviderSettings,
    ToolSpec,
} from "../provider.js";

function toOllamaMessage(m: ChatMessage): Message {
    switch (m.role) {
        case "system":
        case "user":
            return { role: m.role, content: m.content };

        case "assistant":
            return {
                role: "assistant",
                content: m.content,
                tool_calls:
                    m.toolCalls.length > 0
                        ? m.toolCalls.map((c) => ({
                              function: { name: c.name, arguments: c.args },
                          }))
                        : undefined,
            };

        case "tool":
            // Ollama matches results by message order, so the ID isn't sent.
            return { role: "tool", content: m.content };
    }
}

function toOllamaTool(t: ToolSpec): Tool {
    return {
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Tool["function"]["parameters"],
        },
    };
}

export class OllamaModel implements ChatModel {
    private readonly client = new Ollama();

    constructor(private readonly settings: ProviderSettings) {}

    async complete(
        messages: ChatMessage[],
        tools: ToolSpec[],
    ): Promise<ModelReply> {
        const response = await this.client.chat({
            model: this.settings.model,
            messages: messages.map(toOllamaMessage),
            tools: tools.map(toOllamaTool),
            options: this.settings.numCtx
                ? { num_ctx: this.settings.numCtx }
                : undefined,
        });

        const msg = response.message;

        return {
            text: msg.content,
            toolCalls: (msg.tool_calls ?? []).map((call) => ({
                // Ollama doesn't give tool calls an ID, so we make one for matching results.
                id: randomUUID(),
                name: call.function.name,
                args: call.function.arguments,
            })),
            usage: {
                input: response.prompt_eval_count ?? 0,
                output: response.eval_count ?? 0,
            },
        };
    }
}
