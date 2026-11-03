import { parseArgs } from "node:util";
import { Agent } from "./agent.js";
import type { McpServerConfig } from "./mcp/client.js";
import { exaServerConfig, githubServerConfig } from "./mcp/config.js";
import { startMcpServers } from "./mcp/manager.js";
import { createModel, PROVIDERS, type ProviderName } from "./provider.js";
import { createUserMessageReader } from "./shared.js";
import { bashDefinition } from "./tools/bash_tool.js";
import { listFilesDefinition } from "./tools/list_files.js";
import { readFileDefinition } from "./tools/read_file.js";

const DEFAULT_MODELS: Record<ProviderName, string> = {
    ollama: "qwen3-vl:4b",
    gemini: "gemini-3-flash-preview",
};

const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
        provider: { type: "string", default: "ollama" },
        model: { type: "string" },
        verbose: { type: "boolean", default: false },
        "github-write": { type: "boolean", default: false },
    },
});

function isProvider(name: string): name is ProviderName {
    return (PROVIDERS as readonly string[]).includes(name);
}

async function main(): Promise<void> {
    // provider
    const providerName = values.provider;

    if (!isProvider(providerName)) {
        console.error(
            `Unknown provider "${providerName}". Choose one of: ${PROVIDERS.join(", ")}`,
        );
        process.exitCode = 1;
        return;
    }

    // model
    const model = createModel(providerName, {
        model: values.model ?? DEFAULT_MODELS[providerName],
        numCtx: 3000,
    });

    const isVerbose = values.verbose;

    if (isVerbose) {
        console.error(
            `[verbose] Using provider ${providerName} with model ${values.model ?? DEFAULT_MODELS[providerName]}.`,
        );
    }

    // mcp
    const log = (message: string): void => {
        if (isVerbose) console.error(`[verbose] ${message}`);
    };

    const mcpConfigs: McpServerConfig[] = [];
    const github = githubServerConfig({ readOnly: !values["github-write"] });

    if (github) {
        mcpConfigs.push(github);
    } else {
        console.error(
            "GITHUB_PERSONAL_ACCESS_TOKEN is not set; skipping Github MCP Server",
        );
    }

    const exa = exaServerConfig();
    if (exa) mcpConfigs.push(exa);
    else console.error("EXA_API_KEY is not set; skipping Exa MCP Server");

    const mcp = await startMcpServers(mcpConfigs, log);
    process.once("SIGINT", () => {
        void mcp.shutdown().finally(() => process.exit(130));
    });

    // agent setup

    const getUserMessage = createUserMessageReader();
    const tools = [
        readFileDefinition,
        listFilesDefinition,
        bashDefinition,
        ...mcp.tools,
    ];

    const agent = new Agent(model, getUserMessage, tools, isVerbose);

    try {
        await agent.run();
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${error}`);
        process.exitCode = 1;
    } finally {
        await mcp.shutdown();
    }
}

main();
