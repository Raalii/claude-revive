// Notifications Windows : enregistrement de l'appli auprès de Windows et envoi d'un toast.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REVIVE_DIR } from "./registry.js";
const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));
export const APP_ID = "ClaudeRevive";
const APP_KEY = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
const PROTOCOL_KEY = "HKCU\\Software\\Classes\\revive";
function reg(args) {
    return spawnSync("reg.exe", args, { stdio: "ignore", windowsHide: true }).status === 0;
}
// Windows n'affiche les toasts que d'une appli qu'il connaît : on déclare "Claude Revive"
// (nom affiché sur la notification) et le protocole revive: qui ramène sur l'onglet au clic.
export function registerApp() {
    const focus = `${SCRIPTS}focus.ps1`;
    return [
        reg(["add", APP_KEY, "/v", "DisplayName", "/d", "Claude Revive", "/f"]),
        reg(["add", PROTOCOL_KEY, "/ve", "/d", "URL:revive", "/f"]),
        reg(["add", PROTOCOL_KEY, "/v", "URL Protocol", "/d", "", "/f"]),
        reg([
            "add", `${PROTOCOL_KEY}\\shell\\open\\command`, "/ve", "/f", "/d",
            `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${focus}" "%1"`,
        ]),
    ].every(Boolean);
}
export function unregisterApp() {
    reg(["delete", APP_KEY, "/f"]);
    reg(["delete", PROTOCOL_KEY, "/f"]);
}
export function focusUri(tabTitle) {
    return `revive:focus?t=${encodeURIComponent(tabTitle)}`;
}
// Les données passent en base64 : un argument ASCII évite les soucis d'encodage et de
// guillemets de PowerShell 5.1 avec les accents et les messages multilignes.
export function showToast(toast) {
    // Pastille générée par notify.ps1 au premier usage d'une couleur, puis réutilisée
    const icon = toast.color && /^#[0-9a-f]{6}$/i.test(toast.color)
        ? path.join(REVIVE_DIR, "icons", `${toast.color.slice(1).toLowerCase()}.png`)
        : undefined;
    const data = Buffer.from(JSON.stringify({ ...toast, icon, appId: APP_ID }), "utf8").toString("base64");
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${SCRIPTS}notify.ps1`, "-Data", data], { stdio: "ignore", windowsHide: true, timeout: 15_000 });
}
// Texte de notification lisible : sans markdown, sur une ligne, tronqué
export function plain(text, max) {
    const clean = text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[`*_#>|]/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
