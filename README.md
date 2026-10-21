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
npm install -g https://github.com/Raalii/claude-revive/tarball/main
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

## Notifications (optionnel)

Plusieurs sessions qui bossent en parallèle ? revive peut t'envoyer une notification Windows quand
l'une d'elles a besoin de toi, avec le nom de son onglet. Un clic sur la notification te ramène
directement dans le bon onglet.

| Notification | Quand |
|---|---|
| ✅ **API a terminé** | Claude a fini de répondre (avec le début de sa réponse) |
| ⏳ **API : 2 tâches en cours** | Claude a fini son tour mais des agents ou commandes tournent encore en arrière-plan ; un ✅ suivra quand ils auront fini |
| ✋ **API attend ta validation** | une permission est demandée, la session est bloquée |

Pas de notification pour l'onglet que tu as sous les yeux. Une seule notification par session :
la suivante remplace la précédente.

Désactivées par défaut, activables à la demande :

```powershell
revive notify on            # activer
revive notify off           # tout couper
revive notify off done      # garder seulement les demandes de validation
revive notify               # voir l'état
revive notify test          # envoyer une notification de test
```

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
# mise à jour
npm install -g https://github.com/Raalii/claude-revive/tarball/main

# désinstallation : retirer les hooks AVANT de supprimer le paquet
revive uninstall
npm uninstall -g claude-revive
```

Paquet supprimé sans `revive uninstall` ? Chaque session Claude affichera une erreur de hook :
réinstalle, lance `revive uninstall`, puis désinstalle.

## Sous le capot

- **Registre** : les hooks `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification` et `SessionEnd` tiennent une fiche
  par session dans `~/.claude-revive/sessions/` (dossier de départ, transcript, PID, raison de
  fin). Rien ne quitte ta machine.
- **Nom et couleur d'onglet** : Windows Terminal n'expose ses réglages d'onglet à aucun programme.
  À chaque message, l'onglet actif est forcément celui de la session : `scripts/capture-tab.ps1`
  lit son nom via UI Automation (l'API des lecteurs d'écran) et sa couleur sur un pixel de
  l'écran. Le hook tourne en `async`, il ne retarde pas tes messages.
- **Notifications** : `Stop` fournit la dernière réponse et la liste des tâches encore en cours,
  `Notification` signale les permissions demandées. Le toast est envoyé par `scripts/notify.ps1`
  sous le nom « Claude Revive » ; le clic ouvre `revive:focus?t=<onglet>`, un protocole déclaré
  dans le registre utilisateur, qui sélectionne l'onglet via UI Automation. `revive uninstall`
  retire ces entrées.
- **Pas de doublon** : une session encore ouverte (fichier `~/.claude/sessions/<pid>.json` +
  processus vivant) n'est jamais proposée.
- **Relance** : `wt -w new new-tab -d <dossier> --title <nom> --tabColor <couleur> claude --resume <id>`
  par session, dans l'ordre d'ouverture.
- Les fiches de plus de 30 jours sont supprimées.

## Licence

MIT
