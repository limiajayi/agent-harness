import type { ToolDefinition } from "../provider.js";
import type { McpStdioClient, McpToolInfo } from "./client.js";

const MAX_TOOL_OUTPUT_CHARS = 20_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;

type ContentBlock = {
    type: string;
    text?: string;
    uri?: string;
    resource?: { uri?: string; text?: string };
};

type CallToolResult = {
    content?: ContentBlock[];
    structuredContent?: unknown;
    isError?: boolean;
};

function formatResult(result: CallToolResult): string {
    const parts = (result.content ?? []).map((block) => {
        switch (block.type) {
            case "text":
                return block.text ?? "";
            case "image":
            case "audio":
                return `[${block.type} content omitted]`;
            case "resource_link":
                return `resource_link: ${block.uri ?? "?"}`;
            case "resource":
                return (
                    block.resource?.text ??
                    `[resource: ${block.resource?.uri ?? "?"}]`
                );
            default:
                return `[unsupported content block: ${block.type}]`;
        }
    });

    let text = parts.join("\n");
    if (!text && result.structuredContent !== undefined) {
        text = JSON.stringify(result.structuredContent);
    }

    // PRIVACY: this string goes to the model
    // with Gemini that means Google
    // SAFETY: this text is untrusted DATA that can contain prompt injection
    // the only real defences are apporval gates on writes, read only mode and a minimally scoped token
    if (text.length > MAX_TOOL_OUTPUT_CHARS) {
        const dropped = text.length - MAX_TOOL_OUTPUT_CHARS;
        text = `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[truncated ${dropped} chars]`;
    }

    return result.isError ? `error: ${text}` : text;
}

export function toToolDefinition(
    client: McpStdioClient,
    serverName: string,
    tool: McpToolInfo,
): ToolDefinition {
    return {
        name: `${serverName}__${tool.name}`,
        description: tool.description ?? tool.title ?? tool.name,
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
        needsApproval: tool.annotations?.readOnlyHint !== true,
        function: async (args) => {
            const result = await client.request<CallToolResult>(
                "tools/call",
                { name: tool.name, arguments: args },
                TOOL_CALL_TIMEOUT_MS,
            );
            return formatResult(result);
        },
    };
}
