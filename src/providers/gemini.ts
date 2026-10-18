import { randomUUID } from "node:crypto";
import {
    type Content,
    type FunctionDeclaration,
    GoogleGenAI,
    type Part,
} from "@google/genai";
import type {
    ChatMessage,
    ChatModel,
    ModelReply,
    ProviderSettings,
    ToolCall,
    ToolSpec,
} from "../provider.js";
import { geminiApiKey } from "../shared.js";

function toFunctionDeclaration(t: ToolSpec): FunctionDeclaration {
    return {
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
    };
}

function toGeminiContent(m: ChatMessage): Content {
    switch (m.role) {
        case "user":
            return { role: "user", parts: [{ text: m.content }] };
        case "assistant": {
            const parts: Part[] = [];
            if (m.content) {
                parts.push({ text: m.content });
            }
            for (const call of m.toolCalls) {
                parts.push(
                    (call.raw as Part | undefined) ?? {
                        functionCall: {
                            id: call.id,
                            name: call.name,
                            args: call.args,
                        },
                    },
                );
            }
            return { role: "model", parts };
        }
        case "tool":
            return {
                role: "user",
                parts: [
                    {
                        functionResponse: {
                            id: m.toolCallId,
                            name: m.name,
                            response: { output: m.content },
                        },
                    },
                ],
            };
        case "system":
            throw new Error("system message are handled separately");
    }
}

export class GeminiModel implements ChatModel {
    private readonly client: GoogleGenAI;

    constructor(private readonly settings: ProviderSettings) {
        console.log(process.env.GEMINI_API_KEY);
        if (!geminiApiKey) {
            throw new Error(
                "GEMINI_API_KEY is not set. Add it to your environment first.",
            );
        }
        this.client = new GoogleGenAI({ apiKey: geminiApiKey });
    }

    async complete(
        messages: ChatMessage[],
        tools: ToolSpec[],
    ): Promise<ModelReply> {
        // gemini takes the system prompt as it's own setting
        const systemText = messages
            .flatMap((m) => (m.role === "system" ? [m.content] : []))
            .join("\n");

        const contents = messages
            .filter((m) => m.role !== "system")
            .map(toGeminiContent);

        const response = await this.client.models.generateContent({
            model: this.settings.model,
            contents,
            config: {
                systemInstruction: systemText || undefined,
                tools: tools.length
                    ? [
                          {
                              functionDeclarations: tools.map(
                                  toFunctionDeclaration,
                              ),
                          },
                      ]
                    : undefined,
            },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];

        const text = parts.map((p) => p.text ?? "").join("");

        const toolCalls: ToolCall[] = parts.flatMap((part) => {
            if (!part.functionCall) return [];
            return [
                {
                    id: part.functionCall.id ?? randomUUID(),
                    name: part.functionCall.name ?? "",
                    args: part.functionCall.args ?? {},
                    raw: part,
                },
            ];
        });

        return {
            text,
            toolCalls,
            usage: {
                input: response.usageMetadata?.promptTokenCount ?? 0,
                output: response.usageMetadata?.candidatesTokenCount ?? 0,
            },
        };
    }
}
