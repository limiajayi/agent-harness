import type { McpServerConfig } from "./client.js";

// vars the child needs to run. docker on windows needs more
const BASE_ENV_KEYS =
    process.platform === "win32"
        ? [
              "PATH",
              "SystemRoot",
              "USERPROFILE",
              "APPDATA",
              "LOCALAPPDATA",
              "TEMP",
              "TMP",
              "ProgramData",
              "ComSpec",
              "DOCKER_HOST",
              "DOCKER_CONTEXT",
              "DOCKER_CONFIG",
          ]
        : [
              "PATH",
              "HOME",
              "TMPDIR",
              "DOCKER_HOST",
              "DOCKER_CONTEXT",
              "DOCKER_CONFIG",
          ];

function pickEnv(keys: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of keys) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
    }
    return env;
}

// github config
const GITHUB_IMAGE = "ghcr.io/github/github-mcp-server:v2.0.3";

export type GithubOptions = {
    /** Default true. read-only mode removes write tools from the server */
    readOnly: boolean;
    /** eg ["repos", "issues"]. fewer toolsets = fewer tool schemas */
    toolsets?: string[];
};

export function githubServerConfig(
    opts: GithubOptions,
): McpServerConfig | undefined {
    const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) return undefined;

    const args = [
        "run",
        "-i",
        "--rm",
        // no value: docker copies from ITS environment
        // token never appears in command line or in logs
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
    ];
    if (opts.readOnly) args.push("-e", "GITHUB_READ_ONLY=1");
    if (opts.toolsets?.length) {
        args.push("-e", `GITHUB_TOOLSETS=${opts.toolsets.join(",")}`);
    }
    args.push(GITHUB_IMAGE);

    return {
        name: "github",
        command: "docker", // docker.exe is a real executable: no shell needed
        args,
        env: { ...pickEnv(BASE_ENV_KEYS), GITHUB_PERSONAL_ACCESS_TOKEN: token },
        secrets: [token],
        requestTimeoutMs: 10_000,
    };
}

// exa config

export function exaServerConfig(): McpServerConfig | undefined {
    const key = process.env.EXA_API_KEY;
    if (!key) return undefined;

    const args = [
        "run",
        "-i",
        "--rm",
        "-e",
        "EXA_API_KEY",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "exa-mcp:3.4.3",
    ];

    return {
        name: "exa",
        command: "docker",
        args,
        env: { ...pickEnv(BASE_ENV_KEYS), EXA_API_KEY: key },
        secrets: [key],
        requestTimeoutMs: 90_000,
    };
}
