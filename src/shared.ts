import type { Tool } from "ollama";

export const MODEL = "qwen3-vl:4b";
export const NUM_CTX = 1000;

export type GetUserMessage = () => Promise<string | null>;

export type ToolDefinition = {
	name: string;
	description: string;
	parameters: Tool["function"]["parameters"];
	needsApproval: boolean;
	function: (args: Record<string, unknown>) => Promise<string>;
};
