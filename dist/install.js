// Ajout / retrait des hooks dans ~/.claude/settings.json, sans toucher au reste du fichier.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unregisterApp } from "./notify.js";
import { CLAUDE_DIR } from "./registry.js";
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "SessionEnd"];
// Relevé d'onglet et notifications prennent une demi-seconde : en arrière-plan pour ne
// retarder ni le prompt ni la session. SessionStart et SessionEnd restent synchrones :
// à la fermeture de la fenêtre, un hook en arrière-plan serait coupé.
const ASYNC_EVENTS = new Set(["UserPromptSubmit", "Stop", "Notification"]);
export function hookScriptPath() {
    return fileURLToPath(new URL("./hook.js", import.meta.url)).replace(/\\/g, "/");
}
function isOurs(group) {
    return !!group.hooks?.some((h) => h.args?.some((a) => /claude-revive|[\\/]dist[\\/]hook\.js$/.test(a)));
}
function readSettings() {
    if (!fs.existsSync(SETTINGS))
        return {};
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8").replace(/^﻿/, ""));
}
function writeSettings(settings) {
    let backup = null;
    if (fs.existsSync(SETTINGS)) {
        backup = `${SETTINGS}.revive-backup-${Date.now()}`;
        fs.copyFileSync(SETTINGS, backup);
    }
    const text = JSON.stringify(settings, null, 2) + "\n";
    JSON.parse(text); // garde-fou : un settings.json invalide désactive toute la config
    fs.writeFileSync(SETTINGS, text);
    return backup;
}
function withoutOurs(settings) {
    const hooks = { ...(settings.hooks ?? {}) };
    for (const event of EVENTS) {
        if (!hooks[event])
            continue;
        hooks[event] = hooks[event].filter((g) => !isOurs(g));
        if (hooks[event].length === 0)
            delete hooks[event];
    }
    const next = { ...settings, hooks };
    if (Object.keys(hooks).length === 0)
        delete next.hooks;
    return next;
}
export function install() {
    const script = hookScriptPath();
    const settings = withoutOurs(readSettings());
    const hooks = { ...(settings.hooks ?? {}) };
    for (const event of EVENTS) {
        const command = { type: "command", command: "node", args: [script], timeout: 15 };
        if (ASYNC_EVENTS.has(event))
            command.async = true;
        hooks[event] = [...(hooks[event] ?? []), { hooks: [command] }];
    }
    const backup = writeSettings({ ...settings, hooks });
    return { settings: SETTINGS, backup, script };
}
export function uninstall() {
    unregisterApp();
    const backup = writeSettings(withoutOurs(readSettings()));
    return { settings: SETTINGS, backup };
}
