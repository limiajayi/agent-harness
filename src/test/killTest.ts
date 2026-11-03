import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Resolve relative to THIS file, not to the folder you ran the command from.
const serverPath = fileURLToPath(new URL("./fake-server.mjs", import.meta.url));

const child = spawn("cmd.exe", ["/c", "node", serverPath], {
    stdio: ["pipe", "ignore", "inherit"], // inherit stderr so startup errors show up
});
child.on("exit", (code) => console.log("cmd.exe exited, code", code));

console.log("cmd.exe pid:", child.pid, "- check now, kill happens in 20s");

setTimeout(() => {
    child.kill();
    console.log("killed cmd.exe, check again (script stays alive 40s more)");
}, 20_000);

// Keep this script, and its end of the stdin pipe, alive after the kill.
// Otherwise an orphaned child sees end-of-file and exits by itself.
setTimeout(() => {}, 60_000);
