import type {
    ChatMessage,
    ChatModel,
    ModelReply,
    ToolCall,
    ToolDefinition,
    ToolSpec,
} from "./provider.js";
import type { GetUserMessage } from "./shared.js";

const MAX_TOOL_ROUNDS = 10;

export class Agent {
    private conversation: ChatMessage[] = [];
    private readonly toolSpecs: ToolSpec[];

    constructor(
        private readonly model: ChatModel,
        private readonly getUserMessage: GetUserMessage,
        private readonly tools: ToolDefinition[],
        private readonly verbose: boolean,
    ) {
        this.toolSpecs = tools;
    }

    private log(text: string): void {
        if (this.verbose) {
            console.log(`[verbose] ${text}`);
        }
    }

    private async approve(
        name: string,
        args: Record<string, unknown>,
    ): Promise<boolean> {
        console.log(
            `\u001b[93mApprove?\u001b[0m ${name}(${JSON.stringify(args)}) [y/N]`,
        );
        const answer = await this.getUserMessage();
        return answer?.trim().toLowerCase() === "y";
    }

    private async runInference(): Promise<ModelReply> {
        this.log(
            `Sending ${this.conversation.length} messages and ${this.toolSpecs.length} tool(s)`,
        );
        console.log("\u001b[90m(waiting for model...)\u001b[0m");

        const start = performance.now();
        const reply = await this.model.complete(
            this.conversation,
            this.toolSpecs,
        );
        const seconds = ((performance.now() - start) / 1000).toFixed(1);

        const input = reply.usage?.input ?? 0;
        const output = reply.usage?.output ?? 0;
        this.log(
            `Response received after ${seconds}s | tokens in: ${input}, out: ${output}`,
        );

        return reply;
    }

    private async executeTool(call: ToolCall): Promise<string> {
        const name = call.name;
        const args = call.args;

        console.log(
            `\u001b[96mtool\u001b[0m: ${name}(${JSON.stringify(args)})`,
        );
        this.log(
            `Tool use detected: ${name} with input: ${JSON.stringify(args)}`,
        );

        const tool = this.tools.find((t) => t.name === name);

        if (!tool) {
            const error = `tool '${name}' not found`;
            console.log(`\u001b[91merror\u001b[0m: ${error}`);
            return `error: ${error}`;
        }

        if (tool.needsApproval && !(await this.approve(tool.name, args))) {
            const denied =
                "The user denied this action. Do not retry it; ask what they want instead.";
            console.log(`\u001b[91mDenied\u001b[0m: ${name}`);
            return denied;
        }

        this.log(`Executing tool: ${tool.name}`);

        try {
            const result = await tool.function(args);
            console.log(`\u001b[92mresult\u001b[0m: ${result}`);
            this.log(
                `Tool execution successful, result length: ${result.length} chars`,
            );
            return result;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);

            this.log(`Tool execution failed: ${error}`);
            return `error: ${error}`;
        }
    }

    async run(): Promise<void> {
        this.log("Starting chat session with tools enabled");
        console.log("Chat with model (Ctrl + C to quit)");

        while (true) {
            const userInput = await this.getUserMessage();

            if (userInput === null) {
                this.log("User input ended, breaking from the chat loop");
                break;
            }

            if (userInput.trim() === "") {
                this.log("Skipping empty message");
                break;
            }

            this.log(`User input received: ${JSON.stringify(userInput)}`);
            this.conversation.push({ role: "user", content: userInput });

            let reply = await this.runInference();
            this.conversation.push({
                role: "assistant",
                content: reply.text,
                toolCalls: reply.toolCalls,
            });

            // keep going while the model is asking for tools
            for (let round = 1; ; round++) {
                if (reply.text) {
                    console.log(`\u001b[93mModel\u001b[0m: ${reply.text}`);
                }
                if (reply.toolCalls.length === 0) {
                    this.log("No tool calls in reply, turn finished");
                    break;
                }
                if (round > MAX_TOOL_ROUNDS) {
                    console.log(
                        `\u001b[91merror\u001b[0m: stopped after ${MAX_TOOL_ROUNDS} tool rounds`,
                    );
                    break;
                }

                for (const call of reply.toolCalls) {
                    const result = await this.executeTool(call);
                    this.conversation.push({
                        role: "tool",
                        toolCallId: call.id,
                        name: call.name,
                        content: result,
                    });
                }

                this.log(
                    `Sending tool results back to model, conversation length: ${this.conversation.length}`,
                );
                reply = await this.runInference();
                this.conversation.push({
                    role: "assistant",
                    content: reply.text,
                    toolCalls: reply.toolCalls,
                });
            }
        }

        this.log("Chat session ended");
    }
}
