import { execFile } from "node:child_process";
import type { ToolDefinition } from "../provider.js";
import { IGNORE_LIST, WORKSPACE } from "../shared.js";
import { resolveInWorkspace } from "./paths.js";

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_MATCHES = 50;

type CodeSearchInput = {
    pattern: string;
    path?: string;
    fileType?: string;
    caseSensitive: boolean;
};

function parseInput(args: Record<string, unknown>): CodeSearchInput {
    const pattern = args.pattern;
    if (typeof pattern !== "string" || pattern === "") {
        throw new Error("code_search needs a non empty 'pattern' string");
    }

    const path = args.path;
    if (path !== undefined && typeof path !== "string") {
        throw new Error("code_search 'path' must be a string when provided");
    }

    const fileType = args.file_type;
    if (fileType !== undefined && typeof fileType !== "string") {
        throw new Error(
            "code_search 'file_type' must be a string when provided",
        );
    }

    return {
        pattern,
        path: path || undefined,
        fileType: fileType || undefined,
        caseSensitive: args.case_sensitive === true,
    };
}

function runRipgrep(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "rg",
            args,
            {
                cwd: WORKSPACE,
                timeout: SEARCH_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                if (!error) {
                    resolve(stdout);
                    return;
                }

                //ripgrep exits with  when nothing is matched. that's not a failure
                if (error.code === 1) {
                    resolve("");
                    return;
                }

                reject(
                    new Error(`ripgrep failed: ${error.message}\n${stderr}`),
                );
            },
        );
    });
}

async function codeSearchTool(args: Record<string, unknown>): Promise<string> {
    const input = parseInput(args);

    // check the path is inside the workspace but pass ripgrep the original relative path
    if (input.path) {
        resolveInWorkspace(input.path);
    }

    const rgArgs = ["--line-number", "--with-filename", "--color=never"];

    if (!input.caseSensitive) {
        rgArgs.push("--ignore-case");
    }

    if (input.fileType) {
        rgArgs.push("--type", input.fileType);
    }

    for (const glob of IGNORE_LIST) {
        rgArgs.push("--glob", `!${glob}`);
    }

    // "-e" stops a pattern that starts with "-" being read as a flag
    rgArgs.push("-e", input.pattern, "--", input.path ?? ".");

    const stdout = await runRipgrep(rgArgs);
    const lines = stdout.split("\n").filter((line) => line !== "");

    if (lines.length === 0) {
        return "No matches found";
    }

    // keep the output small so it doesn't fill the context window
    if (lines.length > MAX_MATCHES) {
        return `${lines.slice(0, MAX_MATCHES).join("\n")}\n... (showing first ${MAX_MATCHES} of ${lines.length} matches)`;
    }

    return lines.join("\n");
}

export const codeSearchDefinition: ToolDefinition = {
    name: "code_search",
    description: `Search for code patterns using ripgrep (rg).

    Use this to find code patterns, function definitions, variable usage or any text in the codebase.
    You can search by pattern, file type, or directory.`,
    parameters: {
        type: "object",
        required: ["pattern"],
        properties: {
            pattern: {
                type: "string",
                description: "The search pattern or regex to look for.",
            },
            path: {
                type: "string",
                description: "Optional path to search in (file or directory).",
            },
            file_type: {
                type: "string",
                description:
                    "Optional file type to limit the search to such as 'ts', 'js', or 'py'.",
            },
            case_sensitive: {
                type: "boolean",
                description:
                    "Whether the search is case sensitive. Defaults to false.",
            },
        },
    },
    needsApproval: false,
    function: codeSearchTool,
};
