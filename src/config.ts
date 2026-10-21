// Réglages de revive dans ~/.claude-revive/config.json. Les notifications sont désactivées
// par défaut : chacun les active quand il en a besoin (revive notify on).
import fs from "node:fs";
import path from "node:path";
import { REVIVE_DIR } from "./registry.js";

const CONFIG = path.join(REVIVE_DIR, "config.json");

export interface NotifyConfig {
  enabled: boolean;
  done: boolean; // fin de réponse (avec ou sans tâches encore en cours)
  permission: boolean; // session bloquée sur une validation ou une question
}

export interface Config {
  notify: NotifyConfig;
}

export const NOTIFY_KINDS = ["done", "permission"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

const DEFAULTS: Config = { notify: { enabled: false, done: true, permission: true } };

export function loadConfig(): Config {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    return { notify: { ...DEFAULTS.notify, ...saved.notify } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(REVIVE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + "\n");
}
