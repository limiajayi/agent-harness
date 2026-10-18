import { OllamaModel } from "./providers/ollama.js";

export type ToolSpec = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};

export type ToolCall = {
    id: string;
    name: string;
    args: Record<string, unknown>;
};

export type ChatMessage =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content: string; toolCalls: ToolCall[] }
    | { role: "tool"; toolCallId: string; name: string; content: string };

export type ModelReply = {
    text: string;
    toolCalls: ToolCall[];
    usage?: { input: number; output: number };
};

export interface ChatModel {
    complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelReply>;
}

export const PROVIDERS = ["ollama", "gemini"];

export type ProviderName = (typeof PROVIDERS)[number];

export type ProviderSettings = {
    model: string;
    numCtx?: number;
};

export function createModel(
    provider: ProviderName,
    settings: ProviderSettings,
): ChatModel {
    switch (provider) {
        case "ollama":
            return new OllamaModel(settings);
        default:
            throw new Error(`Unknown provider: ${provider as string}`);
    }
}
