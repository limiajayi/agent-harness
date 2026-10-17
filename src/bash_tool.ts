import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { type Message, Ollama, type Tool, type ToolCall } from "ollama";
import { type GetUserMessage, MODEL, type ToolDefinition } from "./shared.js";
import { bashDefinition } from "./tools/bash_tool.js";
import { listFilesDefinition } from "./tools/list_files.js";
import { readFileDefinition } from "./tools/read_file.js";

const MAX_TOOL_ROUNDS = 10;

function createUserMessageReader(): GetUserMessage {
	const rl = readline.createInterface({ input, output });

	return async () => {
		try {
			return await rl.question("\u001b[94mYou\u001b[0m: ");
		} catch {
			return null;
		}
	};
}

class Agent {
	private conversation: Message[] = [];

	constructor(
		private readonly client: Ollama,
		private readonly getUserMessage: GetUserMessage,
		private readonly tools: ToolDefinition[],
		private readonly verbose: boolean,
	) {}

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

	private async runInference(): Promise<Message> {
		const ollamaTools: Tool[] = this.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));

		this.log(
			`Sending ${this.conversation.length} messages and ${ollamaTools.length} tool(s) to ${MODEL}`,
		);
		console.log("\u001b[90m(waiting for model...)\u001b[0m");

		const start = performance.now();
		const response = await this.client.chat({
			model: MODEL,
			messages: this.conversation,
			tools: ollamaTools,
		});
		const seconds = ((performance.now() - start) / 1000).toFixed(1);

		this.log(`Response received after ${seconds}s`);
		return response.message;
	}

	private async executeTool(call: ToolCall): Promise<string> {
		const name = call.function.name;
		const args = call.function.arguments;

		console.log(`\u001b[96mtool\u001b[0m: ${name}(${JSON.stringify(args)})`);
		this.log(`Tool use detected: ${name} with input: ${JSON.stringify(args)}`);

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
		console.log("Chat with local model (Ctrl + C to quit)");

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

			let message = await this.runInference();
			this.conversation.push(message);

			// keep going while the model is asking for tools
			for (let round = 1; ; round++) {
				if (message.content) {
					console.log(`\u001b[93mModel\u001b[0m: ${message.content}`);
				}

				const toolCalls = message.tool_calls ?? [];
				if (toolCalls.length === 0) {
					this.log("No tool calls in reply, turn finished");
					break;
				}

				if (round > MAX_TOOL_ROUNDS) {
					console.log(
						`\u001b[91merror\u001b[0m: stopped after ${MAX_TOOL_ROUNDS} tool rounds`,
					);
					break;
				}

				this.log(
					`Model asked for ${toolCalls.length} tool call(s) in round ${round}`,
				);

				for (const call of toolCalls) {
					const result = await this.executeTool(call);
					this.conversation.push({ role: "tool", content: result });
				}

				this.log(
					`Sending tool results back to model, conversation length: ${this.conversation.length}`,
				);
				message = await this.runInference();
				this.conversation.push(message);
			}
		}

		this.log("Chat session ended");
	}
}

async function main(): Promise<void> {
	const verbose = process.argv.includes("--verbose");

	const client = new Ollama();
	const getUserMessage = createUserMessageReader();
	const tools = [readFileDefinition, listFilesDefinition, bashDefinition];

	if (verbose) {
		console.error(`[verbose] Initialized ${tools.length} tool(s)`);
	}

	const agent = new Agent(client, getUserMessage, tools, verbose);
	try {
		await agent.run();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Error: ${message}`);
		process.exitCode = 1;
	}
}

main();
