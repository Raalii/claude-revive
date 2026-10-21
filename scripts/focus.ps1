# Ouvert au clic sur une notification (protocole revive:focus?t=<nom d'onglet>) :
# met au premier plan la fenêtre Windows Terminal qui contient l'onglet et le sélectionne.
param([string]$Uri)
$ErrorActionPreference = 'Stop'

if ($Uri -notmatch '[?&]t=([^&]*)') { exit 0 }
$wanted = [Uri]::UnescapeDataString($Matches[1])

function Get-CleanTitle([string]$t) {
  if (-not $t) { return '' }
  # Classe construite par codes : PowerShell 5.1 lit ce fichier sans BOM en ANSI
  $glyphs = '^[' + [char]0x2800 + '-' + [char]0x28FF + [char]0x25CF + '-' + [char]0x25D3 + [char]0x2722 + '-' + [char]0x273D + [char]0x00B7 + '*\s]+'
  ($t -replace $glyphs, '').Trim()
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReviveWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$winCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$tabCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::TabItem)

foreach ($win in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)) {
  foreach ($tab in $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)) {
    if ((Get-CleanTitle $tab.Current.Name) -ne (Get-CleanTitle $wanted)) { continue }
    $hwnd = [IntPtr]$win.Current.NativeWindowHandle
    if ([ReviveWin]::IsIconic($hwnd)) { [void][ReviveWin]::ShowWindow($hwnd, 9) } # SW_RESTORE
    # Windows refuse le premier plan à un processus d'arrière-plan ; un appui simulé sur Alt
    # (sans effet visible) lève ce verrou
    [ReviveWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [ReviveWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][ReviveWin]::SetForegroundWindow($hwnd)
    $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    exit 0
  }
}
