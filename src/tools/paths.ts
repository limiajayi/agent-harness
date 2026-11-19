import path from "node:path";
import { WORKSPACE } from "../shared.js";

/**
 * Turns a path the model asked for into a full path inside the workspace
 * Throws if the result points outside the workspace folder
 * @param {string} requested - The requested path
 * @returns {string} The full path in the workspace
 */
export function resolveInWorkspace(requested: string): string {
    const fullPath = path.resolve(WORKSPACE, requested);
    const rel = path.relative(WORKSPACE, fullPath);

    const escapes =
        rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

    if (escapes) {
        throw new Error(
            `${requested} is outside the workspace and can't be used`,
        );
    }

    return fullPath;
}
