import { execFile } from "node:child_process";
import { ToolDefinition } from "../provider.js";
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
