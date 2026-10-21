// Hook Claude Code (SessionStart, UserPromptSubmit, SessionEnd) : met à jour la fiche
// de la session dans le registre. Ne doit jamais rien écrire sur stdout (SessionStart
// injecterait la sortie dans le contexte) ni faire échouer la session.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_DIR, readRecord, tabPath, writeRecord } from "./registry.js";
const CAPTURE_SCRIPT = fileURLToPath(new URL("../scripts/capture-tab.ps1", import.meta.url));
// input.cwd suit les déplacements de la session dans un sous-dossier ; le fichier PID de
// Claude garde le dossier de départ, le seul où --resume retrouve la session.
function startDir() {
    try {
        return JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "sessions", `${process.ppid}.json`), "utf8")).cwd;
    }
    catch {
        return undefined;
    }
}
// Le prompt vient d'être validé : l'onglet actif est celui de la session. Le relevé prend
// une demi-seconde ; le hook UserPromptSubmit est déclaré async pour ne pas retarder le prompt.
// (Un PowerShell détaché ne marche pas : sans console, il quitte sans exécuter le script.)
function captureTab(sessionId) {
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", CAPTURE_SCRIPT, "-Out", tabPath(sessionId)], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
}
function handle(input) {
    const id = input.session_id;
    if (!id)
        return;
    const now = new Date().toISOString();
    const prev = readRecord(id);
    const rec = {
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
        if (input.prompt && !input.prompt.startsWith("/"))
            rec.lastPrompt = input.prompt.slice(0, 200);
        if (rec.wtSession && (!rec.entrypoint || rec.entrypoint === "cli"))
            captureTab(id);
    }
    if (input.hook_event_name === "SessionEnd") {
        rec.status = "ended";
        rec.endedAt = now;
        rec.endReason = input.reason ?? "other";
    }
    writeRecord(rec);
}
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
    try {
        handle(JSON.parse(raw.replace(/^﻿/, "")));
    }
    catch (err) {
        process.stderr.write(`claude-revive: ${err.message}\n`);
    }
    process.exitCode = 0;
});
