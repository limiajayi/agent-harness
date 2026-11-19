import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../provider.js";
import { isSkipped } from "../shared.js";
import { resolveInWorkspace } from "./paths.js";

type EditFileInput = {
    path: string;
    oldStr: string;
    newStr: string;
};

function parseInput(args: Record<string, unknown>): EditFileInput {
    const { path: filePath, old_str: oldStr, new_str: newStr } = args;

    if (typeof filePath !== "string" || filePath === "") {
        throw new Error("edit_file needs a non-empty 'path' string");
    }

    if (typeof oldStr !== "string" || typeof newStr !== "string") {
        throw new Error("edit_file needs 'old_str' and 'new_str' as strings");
    }

    if (oldStr === newStr) {
        throw new Error("old_str and new_str must be different");
    }

    return { path: filePath, oldStr, newStr };
}

function replaceUnique(
    content: string,
    oldStr: string,
    newStr: string,
): string {
    const count = content.split(oldStr).length - 1;

    if (count === 0) {
        throw new Error("old_str not found in file");
    }

    if (count > 1) {
        throw new Error(`old_str found ${count} times in file, must be unique`);
    }

    return content.replace(oldStr, () => newStr);
}

async function createNewFile(
    fullPath: string,
    relPath: string,
    content: string,
): Promise<string> {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    return `Successfully created file ${relPath}`;
}

async function editFileTool(args: Record<string, unknown>): Promise<string> {
    const input = parseInput(args);

    // two guards before touching the disk: no secrets and nothing outside the workspace
    if (isSkipped(input.path)) {
        throw new Error(
            `'${input.path}' is on the ignore list and can't be edited`,
        );
    }

    const fullPath = resolveInWorkspace(input.path);

    let content: string;

    try {
        content = await readFile(fullPath, "utf-8");
    } catch (error) {
        // An empty old_str on a missing file means "create this file"
        const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
        if (notFound && input.oldStr === "") {
            return createNewFile(fullPath, input.path, input.newStr);
        }
        throw error;
    }

    // An empty old_str on an existing file means "append"
    const updated =
        input.oldStr === ""
            ? content + input.newStr
            : replaceUnique(content, input.oldStr, input.newStr);

    await writeFile(fullPath, updated, "utf-8");
    return "OK";
}

export const editFileDefinition: ToolDefinition = {
    name: "edit_file",
    description: `Make edits to a text file.
    
    Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be
    different from each other.

    If the file specified with path doesn't exist, it will be created.`,
    parameters: {
        type: "object",
        required: ["path", "old_str", "new_str"],
        properties: {
            path: {
                type: "string",
                description: "The path to the file.",
            },
            old_str: {
                type: "string",
                description:
                    "Text to search for. Must match exactly and must appear exactly once in the file.",
            },
            new_str: {
                type: "string",
                description: "Text to replace old_str with",
            },
        },
    },
    needsApproval: true,
    function: editFileTool,
};
