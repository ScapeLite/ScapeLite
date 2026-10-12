' Launches the Scapewatch supervisor (dashboard + watcher) with no visible window.
' The supervisor starts/stops/restarts panel-resize-watcher.js itself; use the
' buttons on http://scapelite.localhost/ instead of killing node.
' Put a shortcut to THIS FILE in your Startup folder (Win+R -> shellstartup
' -> Enter) so it starts automatically at login and quietly waits for the
' game. Check overlay\watcher.log if you ever want to confirm it's working.

Set objShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
nodeExe = "C:\Program Files\nodejs\node.exe"
watcherJs = scriptDir & "\supervisor.js"

objShell.Run """" & nodeExe & """ """ & watcherJs & """", 0, False
