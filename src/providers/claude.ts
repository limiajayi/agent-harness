import Anthropic from "@anthropic-ai/sdk";
import type {
    ChatMessage,
    ChatModel,
    ModelReply,
    ProviderSettings,
    ToolCall,
    ToolSpec,
} from "../provider.js";

// messages api needs max_tokens on every request
const MAX_OUTPUT_TOKENS = 4096;

function toClaudeMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];

    // claude wants every tool result from one assistant turn in a single user message
    // messages stores each result separately, so we group them here
    let pendingResults: Anthropic.ToolResultBlockParam[] | null = null;

    for (const m of messages) {
        if (m.role === "tool") {
            const block: Anthropic.ToolResultBlockParam = {
                type: "tool_result",
                tool_use_id: m.toolCallId,
                content: m.content,
            };

            if (pendingResults) {
                pendingResults.push(block);
            } else {
                pendingResults = [block];
                out.push({ role: "user", content: pendingResults });
            }
            continue;
        }

        // anything that isn't a tool result ends the current group
        pendingResults = null;

        if (m.role === "user") {
            out.push({ role: "user", content: m.content });
            continue;
        }

        // assistant - text first, then one tool_use block per tool call
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (m.content) {
            blocks.push({ type: "text", text: m.content });
        }

        if (m.role === "assistant") {
            for (const call of m.toolCalls) {
                blocks.push({
                    type: "tool_use",
                    id: call.id,
                    name: call.name,
                    input: call.args,
                });
            }
        }

        // claude rejects empty messages, so skip an assistant turn with nothing in it
        if (blocks.length > 0) {
            out.push({ role: "assistant", content: blocks });
        }
    }

    return out;
}

function toClaudeTool(t: ToolSpec): Anthropic.Tool {
    return {
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool["input_schema"],
    };
}

export class ClaudeModel implements ChatModel {
    private readonly client: Anthropic;

    constructor(private readonly settings: ProviderSettings) {
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error(
                "ANTHROPIC_API_KEY is not set. Add it to your .env file first.",
            );
        }

        this.client = new Anthropic();
    }

    async complete(
        messages: ChatMessage[],
        tools: ToolSpec[],
    ): Promise<ModelReply> {
        const system = messages
            .flatMap((m) => (m.role === "system" ? [m.content] : []))
            .join("\n");

        const response = await this.client.messages.create({
            model: this.settings.model,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: system || undefined,
            messages: toClaudeMessages(
                messages.filter((m) => m.role !== "system"),
            ),
            tools: tools.length ? tools.map(toClaudeTool) : undefined,
        });

        // a reply is a list of blocks. text blocks become text and tool_use becomes ToolCall
        let text = "";
        const toolCalls: ToolCall[] = [];

        for (const block of response.content) {
            if (block.type === "text") {
                text += block.text;
            } else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    args: block.input as Record<string, unknown>,
                });
            }
        }

        return {
            text,
            toolCalls,
            usage: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
            },
        };
    }
}
