import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export const PROTOCOL_VERSION = "2025-11-25";

const ACCEPTED_VERSIONS = ["2025-11-25", "2025-06-18"];

export type Log = (message: string) => void;

export type McpServerConfig = {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    secrets: string[];
    requestTimeoutMs?: number;
    cwd?: string;
};

export type McpToolInfo = {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

type InitializeResult = {
    protocolVersion: string;
    capabilities?: { tools?: unknown };
    serverInfo?: { name?: string; version?: string };
};

type Pending = {
    method: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

// Windows: npx/npm/pnpm are .cmd launchers and can't be spawned directly.
// `shell: true` with an args array is deprecated on Node 24 (args aren't
// escaped), so we spawn cmd.exe explicitly, as the Node docs show.
// Keep shell-special characters (& | > ^ %) out of configured args.
function resolveLaunch(
    command: string,
    args: string[],
): { command: string; args: string[] } {
    const isScript =
        /\.(cmd|bat)$/i.test(command) || /^(npx|npm|pnpm|yarn)$/i.test(command);
    if (process.platform === "win32" && isScript) {
        return { command: "cmd.exe", args: ["/c", command, ...args] };
    }
    return { command, args };
}

export class McpStdioClient {
    private child?: ChildProcessByStdio<Writable, Readable, Readable>;
    private exited: Promise<void> = Promise.resolve();
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private stdoutBuffer = "";
    private dead = false;
    private _supportsTools = false;

    constructor(
        private readonly config: McpServerConfig,
        private readonly log: Log,
    ) {}

    get supportsTools(): boolean {
        return this._supportsTools;
    }

    // json rpc plumbing

    private onStdout(chunk: string): void {
        // a chunk can hold half a message or several, buffer and split on \n
        this.stdoutBuffer += chunk;
        for (;;) {
            const index = this.stdoutBuffer.indexOf("\n");
            if (index < 0) break;
            const line = this.stdoutBuffer.slice(0, index).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
            if (line) this.handleLine(line);
        }
    }

    private handleResponse(msg: Record<string, unknown>): void {
        const pending = this.pending.get(msg.id as number);
        if (!pending) {
            this.log(
                `[mcp:${this.config.name}] response for unknown id ${String(msg.id)}`,
            );
            return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(msg.id as number);

        if (msg.error) {
            const err = msg.error as { code?: number; message?: string };
            pending.reject(
                new Error(
                    `${pending.method} failed (${err.code}): ${err.message}`,
                ),
            );
        } else {
            pending.resolve(msg.result);
        }
    }

    private handleLine(line: string): void {
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
            this.log(
                `[mcp:${this.config.name}] ignored non-JSON stdout: ${this.redact(line).slice(0, 200)}`,
            );
            return;
        }

        const hasId = "id" in msg;
        const isResponse = hasId && ("result" in msg || "error" in msg);

        if (isResponse) {
            this.handleResponse(msg);
        } else if (typeof msg.method === "string" && hasId) {
            // if the server asks us something, always answer
            if (msg.method === "ping") {
                this.send({ id: msg.id, result: {} });
            } else {
                this.send({
                    id: msg.id,
                    error: { code: -32601, message: "Method not found" },
                });
            }
        } else if (typeof msg.method === "string") {
            this.log(`[mcp:${this.config.name}] notification: ${msg.method}`);
        }
    }

    private send(message: Record<string, unknown>): void {
        if (!this.child || this.dead) return;
        this.child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`,
        );
    }

    request<T = unknown>(
        method: string,
        params?: Record<string, unknown>,
        timeoutMs: number = this.config.requestTimeoutMs ?? 30_000,
    ): Promise<T> {
        if (this.dead) {
            return Promise.reject(
                new Error(`MCP server "${this.config.name}" is not running`),
            );
        }
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out after ${timeoutMs}ms`));
                //tell the server to stop working on it (not allowed for initialize)
                if (method !== "initialize") {
                    this.send({
                        method: "notifications/cancelled",
                        params: { requestId: id, reason: "timeout" },
                    });
                }
            }, timeoutMs);

            this.pending.set(id, {
                method,
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            this.send({ id, method, ...(params ? { params } : {}) });
        });
    }

    notify(method: string, params?: Record<string, unknown>): void {
        this.send({ method, ...(params ? { params } : {}) });
    }

    // mcp lifecycle

    async initialize(): Promise<void> {
        const result = await this.request<InitializeResult>("initialize", {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {}, // me to server: baby i have no capabilities
            clientInfo: { name: "agent-harness", version: "1.0.0" },
        });

        if (!ACCEPTED_VERSIONS.includes(result.protocolVersion)) {
            throw new Error(
                `server wants protocol version ${result.protocolVersion}; this client implements ${ACCEPTED_VERSIONS.join(" / ")}`,
            );
        }

        this._supportsTools = result.capabilities?.tools !== undefined;
        this.log(
            `[mcp:${this.config.name}] initialized: ${result.serverInfo?.name ?? "?"} ${result.serverInfo?.version ?? ""} (protocol ${result.protocolVersion})`,
        );

        // required: tells the server normal operation may begin.
        this.notify("notifications/initialized");
    }

    async listTools(): Promise<McpToolInfo[]> {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;

        do {
            const page = await this.request<{
                tools: McpToolInfo[];
                nextCursor?: string;
            }>("tools/list", cursor ? { cursor } : undefined);
            tools.push(...page.tools);
            cursor = page.nextCursor; // pagination, like ?page= in REST
        } while (cursor);
        return tools;
    }

    // process management

    /** Synchronous last resort for process.on("exit"). */
    killNow(): void {
        this.child?.kill();
    }

    private async waitForExit(ms: number): Promise<boolean> {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), ms);
        });
        const result = await Promise.race([
            this.exited.then(() => true),
            timeout,
        ]);
        clearTimeout(timer);
        return result;
    }

    private markDead(error: Error): void {
        this.dead = true;
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(error);
        }
        this.pending.clear();
    }

    private redact(text: string): string {
        let out = text;
        for (const secret of this.config.secrets) {
            if (secret) out = out.split(secret).join("[redacted]");
        }
        return out;
    }

    start(): void {
        const { command, args, env } = this.config;
        const launch = resolveLaunch(command, args);
        const child = spawn(launch.command, launch.args, {
            env,
            cwd: this.config.cwd,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        this.child = child;

        this.exited = new Promise<void>((resolve) => {
            child.once("exit", (code, signal) => {
                this.markDead(
                    new Error(`server exited (code ${code}, signal ${signal})`),
                );
                resolve();
            });

            // fires when the command can't be spawned at all
            child.once("error", (err) => {
                this.markDead(new Error(`could not start: ${err.message}`));
                resolve();
            });
        });

        // without this, writing to a dead child would crash the process
        child.stdin.on("error", (err) =>
            this.log(`[mcp:${this.config.name}] stdin error: ${err.message}`),
        );

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => this.onStdout(chunk));

        // stderr is free-form logging by the server, never protocol data
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            for (const line of chunk.split(/\r?\n/)) {
                if (line.trim()) {
                    this.log(`[mcp:${this.config.name}] ${this.redact(line)}`);
                }
            }
        });
    }

    /** Graceful shutdown: close stdin then SIGTERM, then SIGKILL */
    async close(): Promise<void> {
        const child = this.child;
        if (!child || this.dead) return;
        child.stdin.end(); // stdio shutdown starts by closing stdin

        if (await this.waitForExit(2000)) return;
        child.kill("SIGTERM");

        if (await this.waitForExit(2000)) return;
        child.kill("SIGKILL");

        await this.waitForExit(1000);
    }
}
