' Starts the ScapeLite tray app (icon in the system tray: dashboard, restart, quit) with no visible window.
' It attaches to an already running ScapeLite service or starts one. Put a shortcut to this file in your Startup folder
' (Win+R -> shell:startup) to have it at every login.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run """" & here & "\node_modules\electron\dist\electron.exe"" """ & here & """", 0, False
