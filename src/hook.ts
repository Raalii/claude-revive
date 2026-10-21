// Hook Claude Code (SessionStart, UserPromptSubmit, Stop, Notification, SessionEnd) : met à
// jour la fiche de la session dans le registre et envoie les notifications si elles sont
// activées. Ne doit jamais rien écrire sur stdout (SessionStart injecterait la sortie dans
// le contexte) ni faire échouer la session.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type NotifyConfig } from "./config.js";
import { focusUri, plain, showToast, type Toast } from "./notify.js";
import { CLAUDE_DIR, readRecord, tabPath, writeRecord, type SessionRecord } from "./registry.js";
import { sessionTitle, tabCapture } from "./sessions.js";

const CAPTURE_SCRIPT = fileURLToPath(new URL("../scripts/capture-tab.ps1", import.meta.url));

// Abonnement aux commentaires d'un artifact publié : ouvert sans fin, ce n'est pas du travail
// en cours (une session qui a publié n'enverrait sinon jamais de ✅)
const ARTIFACT_WATCH = /^live updates for artifact /;

interface BackgroundTask {
  type?: string; // libellé Claude : shell, subagent, monitor, workflow...
  description?: string;
}

interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  source?: string;
  reason?: string;
  prompt?: string;
  last_assistant_message?: string; // Stop
  background_tasks?: BackgroundTask[]; // Stop : tâches encore en cours (running / pending)
  notification_type?: string; // Notification : permission_prompt, elicitation_dialog, idle_prompt...
  message?: string; // Notification
}

// input.cwd suit les déplacements de la session dans un sous-dossier ; le fichier PID de
// Claude garde le dossier de départ, le seul où --resume retrouve la session.
function startDir(): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "sessions", `${process.ppid}.json`), "utf8")).cwd;
  } catch {
    return undefined;
  }
}

// Le prompt vient d'être validé : l'onglet actif est celui de la session. Le relevé prend
// une demi-seconde ; le hook UserPromptSubmit est déclaré async pour ne pas retarder le prompt.
// (Un PowerShell détaché ne marche pas : sans console, il quitte sans exécuter le script.)
function captureTab(sessionId: string): void {
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", CAPTURE_SCRIPT, "-Out", tabPath(sessionId)],
    { stdio: "ignore", windowsHide: true, timeout: 10_000 },
  );
}

function buildToast(input: HookInput, rec: SessionRecord, notify: NotifyConfig): Toast | undefined {
  const tab = tabCapture(rec.sessionId);
  const name = tab?.title || sessionTitle(rec);
  const base = { tag: rec.sessionId, watch: name, launch: rec.wtSession ? focusUri(name) : undefined };

  if (input.hook_event_name === "Stop" && notify.done) {
    // Claude a fini son tour mais des agents ou commandes tournent encore : il reprendra
    // la main quand ils auront fini, et un nouveau Stop suivra
    const tasks = (input.background_tasks ?? []).filter(
      (t) => !(t.type === "monitor" && ARTIFACT_WATCH.test(t.description ?? "")),
    );
    if (tasks.length > 0) {
      const n = tasks.length;
      return {
        ...base,
        title: `⏳ ${name} : ${n} tâche${n > 1 ? "s" : ""} en cours`,
        body: plain(tasks.map((t) => t.description || t.type || "").join(" · "), 180),
      };
    }
    return {
      ...base,
      title: `✅ ${name} a terminé`,
      body: plain(input.last_assistant_message ?? "", 180),
      color: tab?.color || undefined,
    };
  }

  if (input.hook_event_name === "Notification" && notify.permission) {
    if (input.notification_type === "permission_prompt") {
      return { ...base, title: `✋ ${name} attend ta validation`, body: plain(input.message ?? "", 180) };
    }
    if (input.notification_type === "elicitation_dialog") {
      return { ...base, title: `❓ ${name} attend une réponse`, body: plain(input.message ?? "", 180) };
    }
  }
  return undefined;
}

function notifyIfWanted(input: HookInput, rec: SessionRecord): void {
  if (input.hook_event_name !== "Stop" && input.hook_event_name !== "Notification") return;
  if (rec.entrypoint && rec.entrypoint !== "cli") return; // claude -p, SDK
  const { notify } = loadConfig();
  if (!notify.enabled) return;
  const toast = buildToast(input, rec, notify);
  if (toast) showToast(toast);
}

function handle(input: HookInput): void {
  const id = input.session_id;
  if (!id) return;

  const now = new Date().toISOString();
  const prev = readRecord(id);
  const rec: SessionRecord = {
    sessionId: id,
    cwd: prev?.cwd ?? startDir() ?? input.cwd ?? process.cwd(),
    transcriptPath: input.transcript_path ?? prev?.transcriptPath ?? "",
    pid: process.ppid, // le hook est lancé directement par claude.exe
    wtSession: process.env.WT_SESSION ?? null,
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
    startedAt: prev?.startedAt ?? now,
    lastActivity: now,
    lastPrompt: prev?.lastPrompt,
    status: "active",
  };

  if (input.hook_event_name === "UserPromptSubmit") {
    if (input.prompt && !input.prompt.startsWith("/")) rec.lastPrompt = input.prompt.slice(0, 200);
    if (rec.wtSession && (!rec.entrypoint || rec.entrypoint === "cli")) captureTab(id);
  }
  if (input.hook_event_name === "SessionEnd") {
    rec.status = "ended";
    rec.endedAt = now;
    rec.endReason = input.reason ?? "other";
  }

  writeRecord(rec);
  notifyIfWanted(input, rec);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    handle(JSON.parse(raw.replace(/^﻿/, "")));
  } catch (err) {
    process.stderr.write(`claude-revive: ${(err as Error).message}\n`);
  }
  process.exitCode = 0;
});
