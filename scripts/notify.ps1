# Affiche une notification Windows pour une session Claude Code, sauf si l'utilisateur
# regarde déjà l'onglet de cette session (onglet actif de la fenêtre au premier plan).
# -Data : JSON encodé en base64 { title, body, tag, watch, launch, color, icon, appId }
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [long]$Hwnd = 0 # tests : fenêtre à considérer comme au premier plan
)
$ErrorActionPreference = 'Stop'

$d = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Data)) | ConvertFrom-Json

# Même nettoyage que revive : sans renommage, Claude préfixe le titre d'un indicateur d'activité
function Get-CleanTitle([string]$t) {
  if (-not $t) { return '' }
  # Classe construite par codes : PowerShell 5.1 lit ce fichier sans BOM en ANSI
  $glyphs = '^[' + [char]0x2800 + '-' + [char]0x28FF + [char]0x25CF + '-' + [char]0x25D3 + [char]0x2722 + '-' + [char]0x273D + [char]0x00B7 + '*\s]+'
  ($t -replace $glyphs, '').Trim()
}

if ($d.watch) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReviveFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
'@
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $handle = if ($Hwnd) { [IntPtr]$Hwnd } else { [ReviveFg]::GetForegroundWindow() }
  $win = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($win.Current.ClassName -eq 'CASCADIA_HOSTING_WINDOW_CLASS') {
    $cond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::TabItem)),
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty, $true)))
    $tab = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($tab -and (Get-CleanTitle $tab.Current.Name) -eq (Get-CleanTitle $d.watch)) { exit 0 }
  }
}

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }
$launch = if ($d.launch) { " activationType=`"protocol`" launch=`"$(Esc $d.launch)`"" } else { '' }

# Pastille de la couleur de l'onglet, à gauche du titre ; dessinée une fois par couleur.
# Sans elle (échec, couleur absente), la notification part quand même.
$image = ''
if ($d.icon -and $d.color) {
  try {
    if (-not (Test-Path $d.icon)) {
      Add-Type -AssemblyName System.Drawing
      [void](New-Item -ItemType Directory -Force (Split-Path $d.icon))
      $bmp = New-Object System.Drawing.Bitmap 96, 96
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($d.color))), 2, 2, 92, 92)
      $g.Dispose()
      $tmp = "$($d.icon).$PID.tmp"
      $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      Move-Item -Force $tmp $d.icon
    }
    $image = "<image placement=`"appLogoOverride`" src=`"$(Esc ([Uri]$d.icon).AbsoluteUri)`"/>"
  } catch { $image = '' }
}

$xml = "<toast$launch><visual><binding template=`"ToastGeneric`"><text>$(Esc $d.title)</text><text>$(Esc $d.body)</text>$image</binding></visual></toast>"

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
$toast.Tag = $d.tag
$toast.Group = 'revive'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($d.appId).Show($toast)
