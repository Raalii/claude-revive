# claude-revive

> Ton terminal vient de se fermer avec 8 sessions Claude Code dedans ? Une commande, tout revient.

Tu bosses avec plein d'onglets Claude Code dans Windows Terminal, chacun dans son projet, renommés
et colorés pour t'y retrouver. Le terminal se ferme (fausse manip, crash, mise à jour Windows…)
et tout est perdu : retrouver les ID de session, se replacer dans le bon dossier, relancer, renommer,
recolorer…

`revive` rouvre tout d'un coup : **chaque session dans son onglet, dans son dossier, avec son nom
et sa couleur.**

```
PS> revive
? Sessions à rouvrir
❯◉ fermée  il y a 2 min    ■ API           …\projets\api
 ◉ fermée  il y a 2 min    ■ FRONT         …\projets\front
 ◉ fermée  il y a 2 min    ■ MOBILE        …\projets\mobile-app
 ◉ crash   il y a 5 min    ■ INFRA         …\projets\infra
 ◯ fermée  il y a 11 h       Notes de cours …\cours\reseau

4 session(s) rouverte(s) dans une nouvelle fenêtre.
```

## Installation

Il te faut Windows 10/11 avec Windows Terminal, Node.js 20+ et Claude Code à jour (`claude update`).

```powershell
npm install -g github:Raalii/claude-revive
revive install
```

`revive install` ajoute trois hooks dans `~/.claude/settings.json` (sauvegarde faite avant, le
reste du fichier n'est pas touché). Les sessions déjà ouvertes sont prises en compte à leur
prochain message.

## Utilisation

Après une fermeture ou un crash, ouvre un terminal :

```powershell
revive
```

Les sessions du dernier incident sont cochées. `Espace` pour cocher/décocher, `Entrée` pour tout
rouvrir dans une nouvelle fenêtre.

| Commande | Effet |
|---|---|
| `revive` | choisir les sessions à rouvrir |
| `revive -y` | rouvrir direct les sessions cochées par défaut |
| `revive -l` | juste lister |
| `revive -n` | afficher la commande `wt` sans la lancer |
| `revive -a` / `revive -s 72` | chercher plus loin que 24 h |

## Ce qui revient (et ce qui ne revient pas)

✅ Les sessions fermées par la croix (onglet ou fenêtre) et celles tuées par un crash.

✅ Le **nom et la couleur** que tu as donnés à l'onglet dans Windows Terminal. Ils sont relevés à
chaque message ; un changement est pris en compte au bout de deux messages dans l'onglet. Sans
relevé, c'est le nom donné avec `/rename`, sinon le titre généré par Claude.

✅ Toute la conversation, quelle que soit sa taille (`claude --resume`).

❌ Les sessions quittées volontairement (`/exit`, `/clear`), les `claude -p`, celles encore ouvertes.

❌ La réponse en cours au moment de la fermeture et ce qui tournait en arrière-plan (commandes,
subagents) : `--resume` récupère la conversation, pas les processus.

## Mise à jour / désinstallation

```powershell
npm install -g github:Raalii/claude-revive   # mise à jour

revive uninstall                             # retire les hooks (à faire AVANT…)
npm uninstall -g claude-revive               # …de supprimer le paquet
```

Paquet supprimé sans `revive uninstall` ? Chaque session Claude affichera une erreur de hook :
réinstalle, lance `revive uninstall`, puis désinstalle.

## Sous le capot

- **Registre** : les hooks `SessionStart`, `UserPromptSubmit` et `SessionEnd` tiennent une fiche
  par session dans `~/.claude-revive/sessions/` (dossier de départ, transcript, PID, raison de
  fin). Rien ne quitte ta machine.
- **Nom et couleur d'onglet** : Windows Terminal n'expose ses réglages d'onglet à aucun programme.
  À chaque message, l'onglet actif est forcément celui de la session : `scripts/capture-tab.ps1`
  lit son nom via UI Automation (l'API des lecteurs d'écran) et sa couleur sur un pixel de
  l'écran. Le hook tourne en `async`, il ne retarde pas tes messages.
- **Pas de doublon** : une session encore ouverte (fichier `~/.claude/sessions/<pid>.json` +
  processus vivant) n'est jamais proposée.
- **Relance** : `wt -w new new-tab -d <dossier> --title <nom> --tabColor <couleur> claude --resume <id>`
  par session, dans l'ordre d'ouverture.
- Les fiches de plus de 30 jours sont supprimées.

## Licence

MIT
