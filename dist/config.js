// Réglages de revive dans ~/.claude-revive/config.json. Les notifications sont désactivées
// par défaut : chacun les active quand il en a besoin (revive notify on).
import fs from "node:fs";
import path from "node:path";
import { REVIVE_DIR } from "./registry.js";
const CONFIG = path.join(REVIVE_DIR, "config.json");
export const NOTIFY_KINDS = ["done", "permission"];
const DEFAULTS = { notify: { enabled: false, done: true, permission: true } };
export function loadConfig() {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
        return { notify: { ...DEFAULTS.notify, ...saved.notify } };
    }
    catch {
        return structuredClone(DEFAULTS);
    }
}
export function saveConfig(config) {
    fs.mkdirSync(REVIVE_DIR, { recursive: true });
    fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + "\n");
}
