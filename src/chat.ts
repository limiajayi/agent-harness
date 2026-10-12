import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { type Message, Ollama } from "ollama";
import { type GetUserMessage, MODEL } from "./shared.js";

/*
 * Reads one line from the terminal.
 * Returns null when input ends
 */
const createUserMessageReader = (): GetUserMessage => {
	const rl = readline.createInterface({ input, output });

	return async () => {
		try {
			return await rl.question("\u001b[94mYou\u001b[0m: ");
		} catch {
			return null;
		}
	};
};

class Agent {
	private conversation: Message[] = [];

	constructor(
		private readonly client: Ollama,
		private readonly getUserMessage: GetUserMessage,
		private readonly verbose: boolean,
	) {}

	private log(text: string): void {
		if (this.verbose) {
			console.error(`[verbose] ${text}`);
		}
	}

	private async runInference(): Promise<Message> {
		this.log(`Making API call to Ollama with model: ${MODEL}`);

		const response = await this.client.chat({
			model: MODEL,
			messages: this.conversation,
		});

		this.log("API call successful, response received");
		return response.message;
	}

	async run(): Promise<void> {
		this.log("Starting chat session");
		console.log("Chat with a local model (Ctrl + C to quit)");

		while (true) {
			const userInput = await this.getUserMessage();

			if (userInput === null) {
				this.log("User input ended, breaking from chat loop");
				break;
			}

			if (userInput.trim() === "") {
				this.log("Skipping empty message");
				break;
			}

			this.log(`User input received: ${JSON.stringify(userInput)}`);

			this.conversation.push({ role: "user", content: userInput });

			this.log(
				`Sending message to model, conversation length: ${this.conversation.length}`,
			);

			const message = await this.runInference();
			this.conversation.push(message);

			if (message.content) {
				console.log(`\u001b[93mModel\u001b[0m: ${message.content}`);
			}
		}

		this.log("Chat session ended");
	}
}

async function main(): Promise<void> {
	// ollama runs locally and listens on http://127.0.0.1:11434 by default
	const verbose = process.argv.includes("--verbose");
	const client = new Ollama();
	const getUserMessage = createUserMessageReader();

	const agent = new Agent(client, getUserMessage, verbose);

	try {
		await agent.run();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exitCode = 1;
	}
}

main();
