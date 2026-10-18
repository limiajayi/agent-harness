import { execFile } from "node:child_process";
import type { ToolDefinition } from "../provider.js";
import { BASH_TIMEOUT_MS, WORKSPACE } from "../shared.js";

function runCommand(
    shell: string,
    command: string,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(
            shell,
            ["-c", command],
            {
                cwd: WORKSPACE,
                env: { ...process.env, HOME: WORKSPACE },
                timeout: BASH_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
                encoding: "utf8",
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                    return;
                }
                resolve({ stdout, stderr });
            },
        );
    });
}

function resolveBashPath(): string {
    if (process.platform === "win32") {
        return "C:\\Users\\Public\\Desktop\\Git Bash.lnk";
    }
    if (process.env.BASH_PATH) {
        return process.env.BASH_PATH;
    }
    return "bash";
}

async function bashTool(args: Record<string, unknown>): Promise<string> {
    const command = args.command;

    if (typeof command !== "string") {
        throw new Error("bash needs a 'command' argument that is a string");
    }

    const shell = resolveBashPath();

    try {
        const { stdout, stderr } = await runCommand(shell, command);
        return `${stdout}${stderr}`.trim();
    } catch (err) {
        const error = err as {
            message?: string;
            stdout?: string;
            stderr?: string;
        };
        const message = error.message ?? String(err);
        const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
        return `Command failed with error: ${message}\nOutput: ${out}`;
    }
}

export const bashDefinition: ToolDefinition = {
    name: "bash",
    description:
        "Execute a bash command and return its output. Use this to run shell commands.",
    parameters: {
        type: "object",
        required: ["command"],
        properties: {
            command: {
                type: "string",
                description: "The bash command to execute",
            },
        },
    },
    needsApproval: true,
    function: bashTool,
};
