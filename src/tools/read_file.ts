import { readFile } from "node:fs/promises";
import type { ToolDefinition } from "../shared.js";

async function readFileTool(args: Record<string, unknown>): Promise<string> {
	const path = args.path;
	if (typeof path !== "string") {
		throw new Error("read_file needs a 'path' argument that is a string");
	}

	return readFile(path, { encoding: "utf8" });
}

export const readFileDefinition: ToolDefinition = {
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
	needsApproval: false,
	function: readFileTool,
};
