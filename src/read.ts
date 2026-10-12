import { readFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import type { Message, Ollama, Tool } from "ollama";
import { type GetUserMessage, MODEL } from "./shared.js";

const MAX_TOOL_ROUNDS = 10;

type ToolDefinition = {
	name: string;
	description: string;
	parameters: Tool["function"]["parameters"];
	function: (args: Record<string, unknown>) => Promise<string>;
};

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

async function readFileTool(args: Record<string, unknown>): Promise<string> {
	const path = args.path;
	if (typeof path !== "string") {
		throw new Error("read_file needs a 'path' argument that is a string");
	}

	return readFile(path, { encoding: "utf8" });
}

const readFileDefinition: ToolDefinition = {
	name: "read_file",
	description:
		"Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use with directory names.",
	parameters: {
		type: "object",
		required: ["path"],
		properties: {
			path: {
				type: "string",
				description: "The relative path of a file in the working directory.",
			},
		},
	},
	function: readFileTool,
};

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

	private async runInference(): Promise<Message> {
		const ollamaTools: Tool[] = this.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}
}
