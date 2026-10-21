// Sélection des sessions restaurables à partir du registre.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CLAUDE_DIR, listRecords, tabPath } from "./registry.js";
// Les sessions fermées en même temps (croix de la fenêtre) finissent à la même milliseconde ;
// une minute de marge suffit à regrouper un même incident.
const INCIDENT_WINDOW_MS = 60_000;
export function loadCandidates(sinceHours) {
    const live = liveSessions();
    const since = sinceHours === null ? 0 : Date.now() - sinceHours * 3_600_000;
    const candidates = [];
    for (const rec of listRecords()) {
        if (rec.entrypoint && rec.entrypoint !== "cli")
            continue; // claude -p, SDK
        // Une fin volontaire (/exit, /clear, logout...) n'est pas à restaurer ; "other" = onglet ou fenêtre fermé
        if (rec.status === "ended" && rec.endReason !== "other")
            continue;
        // Statut ignoré : une session déjà rouverte ne repasse dans le registre qu'à son premier hook
        if (live.sessionIds.has(rec.sessionId) || live.pidsWithoutFile.has(rec.pid))
            continue;
        let transcriptMtime;
        try {
            const st = fs.statSync(rec.transcriptPath);
            if (st.size === 0)
                continue;
            transcriptMtime = st.mtimeMs;
        }
        catch {
            continue; // sans transcript, --resume n'a rien à reprendre
        }
        const at = rec.status === "ended" && rec.endedAt
            ? new Date(rec.endedAt)
            : new Date(Math.max(Date.parse(rec.lastActivity), transcriptMtime));
        if (at.getTime() < since)
            continue;
        rec.cwd = resumeDir(rec);
        const tab = tabCapture(rec.sessionId);
        candidates.push({
            rec,
            title: tab?.title || sessionTitle(rec),
            color: tab?.color ?? null,
            kind: rec.status === "ended" ? "fermée" : "crash",
            at,
            cwdExists: fs.existsSync(rec.cwd),
            preselected: false,
        });
    }
    // Coché par défaut : le dernier groupe de sessions fermées ensemble, plus les crashs
    const closedTimes = candidates.filter((c) => c.kind === "fermée").map((c) => c.at.getTime());
    const lastClose = closedTimes.length ? Math.max(...closedTimes) : 0;
    for (const c of candidates) {
        c.preselected =
            c.cwdExists && (c.kind === "crash" || lastClose - c.at.getTime() <= INCIDENT_WINDOW_MS);
    }
    return candidates.sort((a, b) => Number(b.preselected) - Number(a.preselected) || b.at.getTime() - a.at.getTime());
}
// Claude range le transcript dans projects/<dossier de départ, non alphanumériques -> "-">.
// Si la fiche pointe vers un sous-dossier, on remonte jusqu'au dossier qui correspond.
function resumeDir(rec) {
    const projectName = path.basename(path.dirname(rec.transcriptPath));
    for (let dir = rec.cwd;; dir = path.dirname(dir)) {
        if (dir.replace(/[^a-zA-Z0-9]/g, "-") === projectName)
            return dir;
        if (path.dirname(dir) === dir)
            return rec.cwd;
    }
}
// Sessions ouvertes en ce moment, d'après ~/.claude/sessions/<pid>.json. Ce fichier survit
// à un kill brutal, d'où le croisement avec les processus claude réellement lancés.
// Proposer une session ouverte ouvrirait un doublon qui écrit dans le même transcript.
function liveSessions() {
    const sessionIds = new Set();
    const pidsWithoutFile = new Set();
    for (const pid of runningClaudePids()) {
        try {
            const pidFile = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "sessions", `${pid}.json`), "utf8"));
            sessionIds.add(pidFile.sessionId);
        }
        catch {
            pidsWithoutFile.add(pid); // dans le doute, la session de ce PID est considérée ouverte
        }
    }
    return { sessionIds, pidsWithoutFile };
}
function runningClaudePids() {
    const out = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout ?? "";
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line);
        if (m && /claude/i.test(m[1]))
            pids.add(Number(m[2]));
    }
    return pids;
}
// Nom et couleur relevés sur l'onglet Windows Terminal. On retient le relevé le plus récent
// qui revient deux fois de suite : un relevé isolé peut venir d'un autre onglet si
// l'utilisateur a changé d'onglet juste après avoir validé son prompt.
export function tabCapture(sessionId) {
    let captures;
    try {
        captures = JSON.parse(fs.readFileSync(tabPath(sessionId), "utf8").replace(/^﻿/, "")).captures ?? [];
    }
    catch {
        return undefined;
    }
    const same = (a, b) => a.title === b.title && a.color === b.color;
    let chosen = captures.length === 1 ? captures[0] : undefined;
    for (let i = captures.length - 1; i > 0 && !chosen; i--) {
        if (same(captures[i], captures[i - 1]))
            chosen = captures[i];
    }
    if (!chosen)
        return undefined;
    // Sans renommage, l'onglet affiche le titre posé par Claude, précédé d'un indicateur d'activité
    const title = chosen.title.replace(/^[⠀-⣿●-◓✢-✽·*\s]+/u, "").trim();
    return { title, color: chosen.color };
}
// Titre : /rename en priorité, puis le titre généré par Claude, puis le dernier prompt.
export function sessionTitle(rec) {
    let text = "";
    try {
        text = fs.readFileSync(rec.transcriptPath, "utf8");
    }
    catch {
        // transcript illisible : on retombe sur les infos du registre
    }
    const custom = lastEntry(text, "custom-title")?.customTitle;
    const ai = lastEntry(text, "ai-title")?.aiTitle;
    const title = custom || ai || rec.lastPrompt || path.basename(rec.cwd);
    return title.replace(/\s+/g, " ").trim();
}
// Dernière ligne du transcript dont le type vaut `type`. On remonte depuis la fin et on
// vérifie le champ type, car le texte peut apparaître dans le contenu d'un message.
function lastEntry(text, type) {
    const needle = `"${type}"`;
    let end = text.length;
    while (end > 0) {
        const i = text.lastIndexOf(needle, end - 1);
        if (i < 0)
            return undefined;
        const start = text.lastIndexOf("\n", i) + 1;
        const stop = text.indexOf("\n", i);
        try {
            const entry = JSON.parse(text.slice(start, stop < 0 ? undefined : stop));
            if (entry.type === type)
                return entry;
        }
        catch {
            // ligne tronquée ou non JSON
        }
        end = start - 1;
    }
    return undefined;
}
