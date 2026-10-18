import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";

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
