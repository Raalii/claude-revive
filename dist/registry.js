// Registre des sessions : un fichier JSON par session dans ~/.claude-revive/sessions.
// Un fichier par session parce que fermer une fenêtre déclenche tous les SessionEnd
// à la même milliseconde : un fichier unique se ferait écraser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const REVIVE_DIR = path.join(os.homedir(), ".claude-revive");
export const SESSIONS_DIR = path.join(REVIVE_DIR, "sessions");
// Relevés du nom et de la couleur d'onglet, écrits par scripts/capture-tab.ps1
export const TABS_DIR = path.join(REVIVE_DIR, "tabs");
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
export function recordPath(sessionId) {
    return path.join(SESSIONS_DIR, `${sessionId}.json`);
}
export function tabPath(sessionId) {
    return path.join(TABS_DIR, `${sessionId}.json`);
}
export function readRecord(sessionId) {
    try {
        return JSON.parse(fs.readFileSync(recordPath(sessionId), "utf8"));
    }
    catch {
        return undefined;
    }
}
export function writeRecord(rec) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const file = recordPath(rec.sessionId);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
    // rename = remplacement atomique : un lecteur ne voit jamais un fichier à moitié écrit.
    // Sous Windows il peut échouer si le fichier est ouvert ailleurs, d'où les essais.
    for (let attempt = 0;; attempt++) {
        try {
            fs.renameSync(tmp, file);
            return;
        }
        catch (err) {
            if (attempt >= 4) {
                fs.rmSync(tmp, { force: true });
                throw err;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
    }
}
export function listRecords() {
    let names = [];
    try {
        names = fs.readdirSync(SESSIONS_DIR).filter((n) => n.endsWith(".json"));
    }
    catch {
        return [];
    }
    const records = [];
    for (const name of names) {
        try {
            records.push(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name), "utf8")));
        }
        catch {
            // fichier illisible : on l'ignore plutôt que de bloquer revive
        }
    }
    return records;
}
export function pruneRecords(maxAgeDays) {
    const limit = Date.now() - maxAgeDays * 86_400_000;
    let removed = 0;
    for (const rec of listRecords()) {
        if (Date.parse(rec.lastActivity) < limit) {
            fs.rmSync(recordPath(rec.sessionId), { force: true });
            fs.rmSync(tabPath(rec.sessionId), { force: true });
            removed++;
        }
    }
    return removed;
}
