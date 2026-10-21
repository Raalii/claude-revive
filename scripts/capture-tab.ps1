# Relève le nom et la couleur de l'onglet actif de la fenêtre Windows Terminal au premier plan.
# Lancé en arrière-plan par le hook UserPromptSubmit : à cet instant, l'onglet actif est
# celui où l'utilisateur vient de valider son prompt, donc celui de la session.
# Aucun programme ne peut lire les réglages d'onglet de WT : le nom passe par UI Automation
# (comme un lecteur d'écran) et la couleur par un pixel de l'écran.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [long]$Hwnd = 0
)
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReviveNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
# Coordonnées physiques : sans ça, UIA et la capture d'écran divergent sur un écran à 125 % / 150 %
[void][ReviveNative]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing

$handle = if ($Hwnd) { [IntPtr]$Hwnd } else { [ReviveNative]::GetForegroundWindow() }
$win = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($win.Current.ClassName -ne 'CASCADIA_HOSTING_WINDOW_CLASS') { exit 0 }

# Recherche ciblée sur l'onglet sélectionné : parcourir tous les onglets coûte une seconde
$cond = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem)),
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty, $true)))
$selected = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $selected) { exit 0 }

# Une seule capture : l'onglet et quelques pixels du terminal juste dessous
$r = $selected.Current.BoundingRectangle
$w = [int]$r.Width; $h = [int]$r.Height + 10
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
$g.Dispose()

# Couleur dominante d'une ligne de pixels (le texte et l'icône y sont minoritaires)
function Get-RowColor([int]$y) {
  $counts = @{}
  for ($x = [int]($w * 0.1); $x -lt [int]($w * 0.9); $x += 2) {
    $p = $bmp.GetPixel($x, $y)
    $hex = '#{0:X2}{1:X2}{2:X2}' -f $p.R, $p.G, $p.B
    $counts[$hex] = 1 + [int]$counts[$hex]
  }
  ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
}
$tabColor = Get-RowColor 5
# Un onglet actif sans couleur prend le fond du terminal : on compare avec la zone juste dessous
$termColor = Get-RowColor ($h - 4)
$bmp.Dispose()

function Get-Distance([string]$a, [string]$b) {
  if (-not $a -or -not $b) { return 999 }
  $d = 0
  foreach ($i in 1, 3, 5) { $d += [Math]::Abs([Convert]::ToInt32($a.Substring($i, 2), 16) - [Convert]::ToInt32($b.Substring($i, 2), 16)) }
  $d
}
$color = if ((Get-Distance $tabColor $termColor) -lt 24) { $null } else { $tabColor }

# On garde les derniers relevés : revive ne retient un nom que s'il revient deux fois de suite,
# pour qu'un relevé fait après un changement d'onglet rapide ne l'écrase pas
$captures = @()
if (Test-Path $Out) {
  try { $captures = @(([System.IO.File]::ReadAllText($Out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).captures) } catch {}
}
$captures += [pscustomobject]@{ title = $selected.Current.Name; color = $color; at = (Get-Date).ToUniversalTime().ToString('o') }
$captures = @($captures | Select-Object -Last 6)
$json = @{ captures = $captures } | ConvertTo-Json -Compress -Depth 4

$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Force $dir) }
$tmp = "$Out.$PID.tmp"
[System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
Move-Item -Force $tmp $Out
