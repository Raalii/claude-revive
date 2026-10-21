// Relance des sessions dans une nouvelle fenêtre Windows Terminal, un onglet par session.
import { spawn, spawnSync } from "node:child_process";

export interface Tab {
  cwd: string;
  title: string;
  color: string | null;
  sessionId: string;
}

// Lancé depuis une session Claude, revive hérite de ses variables de session : la session
// relancée se croirait enfant et n'écrirait ni transcript ni fichier PID. La liste de ces
// variables change selon les versions, donc on retire tout CLAUDE* sauf la config utile.
// Depuis un terminal neuf (cas normal), l'environnement est transmis tel quel.
const KEEP_IN_CHILD = new Set(["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH"]);

function cleanEnv(): NodeJS.ProcessEnv {
  if (!process.env.CLAUDECODE) return process.env;
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^CLAUDE/i.test(key) || KEEP_IN_CHILD.has(key.toUpperCase()),
    ),
  );
}

// wt lance le programme sans shell : un .exe directement, un shim .cmd (install npm) via cmd
export function resolveClaude(): string[] {
  const out = spawnSync("where.exe", ["claude"], { encoding: "utf8" }).stdout ?? "";
  const paths = out.split(/\r?\n/).filter(Boolean);
  const exe = paths.find((p) => p.toLowerCase().endsWith(".exe"));
  if (exe) return [exe];
  const cmd = paths.find((p) => p.toLowerCase().endsWith(".cmd"));
  if (cmd) return ["cmd.exe", "/c", cmd];
  return ["claude"];
}

export function buildWtArgs(tabs: Tab[], claudeCommand: string[]): string[] {
  const args = ["-w", "new"];
  tabs.forEach((tab, i) => {
    if (i > 0) args.push(";");
    args.push(
      "new-tab",
      "-d", tab.cwd,
      "--title", tabTitle(tab.title),
      "--suppressApplicationTitle",
      ...(tab.color ? ["--tabColor", tab.color] : []),
      ...claudeCommand, "--resume", tab.sessionId,
    );
  });
  return args;
}

// ";" sépare les commandes de wt et les guillemets cassent son parsing
function tabTitle(title: string): string {
  const clean = title.replace(/[;"]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
}

export function launchWt(args: string[]): void {
  spawn("wt", args, { env: cleanEnv(), detached: true, stdio: "ignore" }).unref();
}
