import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

export const WORKSPACE = path.resolve(
    "C:\\Users\\limia\\Desktop\\code\\projects",
);

export const BASH_TIMEOUT_MS = 30_000;

export const geminiApiKey = process.env.GEMINI_API_KEY;

export type GetUserMessage = () => Promise<string | null>;

export function createUserMessageReader(): GetUserMessage {
    const rl = readline.createInterface({ input, output });

    return async () => {
        try {
            return await rl.question("\u001b[94mYou\u001b[0m: ");
        } catch {
            return null;
        }
    };
}

const SKIPPED = new Set([".vscode", "node_modules", ".git", ".env"]);

// matches .env, .env.local, .devenv, etc
const PATTERNS: RegExp[] = [/^\.env(\..+)?$/, /\.(pem|key)$/];

export function isSkipped(relPath: string): boolean {
    const parts = relPath.split(/[\\/]/).filter((part) => part !== "");

    return parts.some(
        (part) => SKIPPED.has(part) || PATTERNS.some((re) => re.test(part)),
    );
}
