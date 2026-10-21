#!/usr/bin/env node
// revive : liste et restaure les sessions Claude Code perdues à la fermeture de Windows Terminal.
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, NOTIFY_KINDS, saveConfig } from "./config.js";
import { registerApp, showToast } from "./notify.js";
import { pruneRecords } from "./registry.js";
import { loadCandidates } from "./sessions.js";
import { buildWtArgs, launchWt, resolveClaude } from "./wt.js";
import { install, uninstall } from "./install.js";
const HELP = `revive : restaure les sessions Claude Code perdues

  revive              choisir les sessions à rouvrir (dernier incident coché)
  revive -y           rouvrir directement les sessions cochées par défaut
  revive -l           lister les sessions restaurables
  revive install      ajouter les hooks dans ~/.claude/settings.json
  revive uninstall    retirer les hooks

Notifications (désactivées par défaut)
  revive notify             état des notifications
  revive notify on|off      activer / couper toutes les notifications
  revive notify off done    couper un seul type : done (fin de réponse)
                            ou permission (validation demandée)
  revive notify test        envoyer une notification de test

Options
  -a, --all           toutes les sessions, pas seulement les dernières 24 h
  -s, --since <h>     fenêtre en heures (défaut 24)
  -n, --dry-run       afficher la commande wt sans la lancer
`;
function ago(date) {
    const min = Math.round((Date.now() - date.getTime()) / 60_000);
    if (min < 1)
        return "à l'instant";
    if (min < 60)
        return `il y a ${min} min`;
    if (min < 24 * 60)
        return `il y a ${Math.round(min / 60)} h`;
    return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
function shortPath(p) {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts.length > 3 ? `…\\${parts.slice(-2).join("\\")}` : p;
}
// Pastille dans la couleur de l'onglet (couleurs 24 bits, gérées par Windows Terminal)
function swatch(color) {
    if (!color || !process.stdout.isTTY)
        return " ";
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    return `\x1b[38;2;${r};${g};${b}m■\x1b[0m`;
}
function label(c) {
    const kind = c.kind === "crash" ? "crash " : "fermée";
    return `${kind}  ${ago(c.at).padEnd(14)}  ${swatch(c.color)} ${c.title.slice(0, 50).padEnd(50)}  ${shortPath(c.rec.cwd)}`;
}
function printList(cands) {
    if (cands.length === 0) {
        console.log("Aucune session à restaurer.");
        return;
    }
    for (const c of cands) {
        const mark = c.preselected ? "●" : "○";
        const missing = c.cwdExists ? "" : "  (dossier introuvable)";
        console.log(`${mark} ${label(c)}  ${c.rec.sessionId.slice(0, 8)}${missing}`);
    }
    console.log("\n● = coché par défaut (dernier incident)");
}
function restore(selected, dryRun) {
    if (selected.length === 0) {
        console.log("Rien de sélectionné.");
        return;
    }
    // L'ordre réel des onglets est inconnu : l'ordre d'ouverture des sessions s'en approche
    const ordered = [...selected].sort((a, b) => a.rec.startedAt.localeCompare(b.rec.startedAt));
    const args = buildWtArgs(ordered.map((c) => ({ cwd: c.rec.cwd, title: c.title, color: c.color, sessionId: c.rec.sessionId })), resolveClaude());
    if (dryRun) {
        console.log(["wt", ...args.map((a) => (/[\s;]/.test(a) ? `"${a}"` : a))].join(" "));
        return;
    }
    launchWt(args);
    console.log(`${selected.length} session(s) rouverte(s) dans une nouvelle fenêtre.`);
}
const KIND_LABELS = {
    done: "fin de réponse",
    permission: "validation ou réponse demandée",
};
function printNotifyStatus(config) {
    console.log(`Notifications : ${config.notify.enabled ? "activées" : "désactivées"}`);
    for (const kind of NOTIFY_KINDS) {
        console.log(`  ${kind.padEnd(11)} ${KIND_LABELS[kind].padEnd(31)} ${config.notify[kind] ? "oui" : "non"}`);
    }
}
function notifyCommand([action, kind]) {
    const config = loadConfig();
    if (action === "test") {
        registerApp();
        showToast({ title: "✅ revive : test", body: "Les notifications fonctionnent.", tag: "revive-test", color: "#3B82F6" });
        console.log("Notification de test envoyée.");
        return;
    }
    if (action === "on" || action === "off") {
        const value = action === "on";
        if (kind) {
            if (!NOTIFY_KINDS.includes(kind)) {
                console.error(`Type inconnu : ${kind} (attendu : ${NOTIFY_KINDS.join(", ")})`);
                process.exitCode = 1;
                return;
            }
            config.notify[kind] = value;
            if (value)
                config.notify.enabled = true; // activer un type sans activer le reste n'aurait pas d'effet
        }
        else {
            config.notify.enabled = value;
        }
        if (config.notify.enabled && !registerApp()) {
            console.error("Impossible d'enregistrer revive auprès de Windows : les notifications risquent de ne pas s'afficher.");
        }
        saveConfig(config);
    }
    else if (action) {
        console.error(`Action inconnue : ${action}\n\n${HELP}`);
        process.exitCode = 1;
        return;
    }
    printNotifyStatus(config);
}
async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            list: { type: "boolean", short: "l" },
            all: { type: "boolean", short: "a" },
            since: { type: "string", short: "s" },
            yes: { type: "boolean", short: "y" },
            "dry-run": { type: "boolean", short: "n" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help)
        return void console.log(HELP);
    if (positionals[0] === "install") {
        const r = install();
        console.log(`Hooks ajoutés dans ${r.settings}\n  script : ${r.script}`);
        if (r.backup)
            console.log(`  sauvegarde : ${r.backup}`);
        return;
    }
    if (positionals[0] === "uninstall") {
        const r = uninstall();
        console.log(`Hooks retirés de ${r.settings}`);
        if (r.backup)
            console.log(`  sauvegarde : ${r.backup}`);
        return;
    }
    if (positionals[0] === "notify")
        return notifyCommand(positionals.slice(1));
    if (positionals.length > 0) {
        console.error(`Commande inconnue : ${positionals[0]}\n\n${HELP}`);
        process.exitCode = 1;
        return;
    }
    pruneRecords(30);
    const sinceHours = values.all ? null : Number(values.since ?? 24);
    const cands = loadCandidates(sinceHours);
    if (values.list)
        return printList(cands);
    if (values.yes)
        return restore(cands.filter((c) => c.preselected), !!values["dry-run"]);
    if (cands.length === 0)
        return void console.log("Aucune session à restaurer.");
    if (!process.stdin.isTTY) {
        console.error("Pas de terminal interactif : utilise revive -l ou revive -y.");
        process.exitCode = 1;
        return;
    }
    const { default: checkbox } = await import("@inquirer/checkbox");
    try {
        const selected = await checkbox({
            message: "Sessions à rouvrir",
            pageSize: 20,
            loop: false,
            choices: cands.map((c) => ({
                name: label(c),
                value: c,
                checked: c.preselected,
                disabled: c.cwdExists ? false : `dossier introuvable : ${path.basename(c.rec.cwd)}`,
            })),
        });
        restore(selected, !!values["dry-run"]);
    }
    catch (err) {
        if (err.name === "ExitPromptError")
            return; // Ctrl+C
        throw err;
    }
}
main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
