import { readdir } from "node:fs/promises";
import type { ToolDefinition } from "../provider.js";

const SKIPPED_DIRS = [".vscode", "node_modules", ".git"];

/*
 * Recursive walk
 * It visits each folder, records what's inside it, then goes into each subfolder
 * `relDir` is the path relative to the root we started from
 * ("" means the root itself)
 */
async function collectEntries(root: string, relDir: string, files: string[]) {
    const fullDir = relDir === "" ? root : `${root}/${relDir}`;
    const entries = await readdir(fullDir, { withFileTypes: true });

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;

        if (entry.isDirectory()) {
            if (SKIPPED_DIRS.includes(relPath)) {
                continue;
            }
            files.push(`${relPath}/`);
            await collectEntries(root, relPath, files);
        } else {
            files.push(relPath);
        }
    }
}

async function listFilesTool(args: Record<string, unknown>): Promise<string> {
    const path = args.path;

    if (path !== undefined && typeof path !== "string") {
        throw new Error("list_files 'path' must be a string when provided");
    }

    const dir = typeof path === "string" && path !== "" ? path : ".";

    const files: string[] = [];
    await collectEntries(dir, "", files);

    return JSON.stringify(files);
}

export const listFilesDefinition: ToolDefinition = {
    name: "list_files",
    description:
        "List files and directories at a given path. If no path is provided, lists files in the current directory",
    parameters: {
        type: "object",
        required: [],
        properties: {
            path: {
                type: "string",
                description:
                    "Optional relative path to list files from. Defaults to current directory if not provided.",
            },
        },
    },
    needsApproval: false,
    function: listFilesTool,
};
