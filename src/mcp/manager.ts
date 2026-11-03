import type { ToolDefinition } from "../provider.js";
import { toToolDefinition } from "./adapter.js";
import { type Log, type McpServerConfig, McpStdioClient } from "./client.js";

export type McpHandle = {
    tools: ToolDefinition[];
    shutdown: () => Promise<void>;
};

export async function startMcpServers(
    configs: McpServerConfig[],
    log: Log,
): Promise<McpHandle> {
    const clients: McpStdioClient[] = [];

    const perServer = await Promise.all(
        configs.map(async (config): Promise<ToolDefinition[]> => {
            const client = new McpStdioClient(config, log);
            try {
                if (!/^[a-zA-Z0-9_-]+$/.test(config.name)) {
                    throw new Error(`invalid server name "${config.name}"`);
                }
                client.start();
                await client.initialize();
                const tools = client.supportsTools
                    ? await client.listTools()
                    : [];
                clients.push(client);
                log(
                    `[mcp:${config.name}] ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`,
                );
                return tools.map((t) =>
                    toToolDefinition(client, config.name, t),
                );
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                console.error(
                    `MCP server "${config.name}" skipped: ${message}`,
                );
                await client.close();
                return [];
            }
        }),
    );

    // Backstop: if the process dies without a graceful shutdown, kill children.
    process.once("exit", () => clients.forEach((c) => c.killNow()));

    let shuttingDown: Promise<void> | undefined;
    return {
        tools: perServer.flat(),
        shutdown: () => {
            shuttingDown ??= Promise.allSettled(
                clients.map((c) => c.close()),
            ).then(() => undefined);
            return shuttingDown;
        },
    };
}
