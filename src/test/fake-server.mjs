import { createInterface } from "node:readline";

const reply = (id, result) =>
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));

for await (const line of createInterface({ input: process.stdin })) {
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
        reply(msg.id, {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "fake", version: "0" },
        });
    } else if (msg.method === "tools/list") {
        reply(msg.id, {
            tools: [
                {
                    name: "echo",
                    inputSchema: { type: "object" },
                    annotations: { readOnlyHint: true },
                },
                { name: "write_thing", inputSchema: { type: "object" } },
            ],
        });
    } else if (msg.method === "tools/call") {
        reply(msg.id, {
            content: [
                { type: "text", text: JSON.stringify(msg.params.arguments) },
            ],
        });
    }
}
