Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
desktopDir = WshShell.SpecialFolders("Desktop")
Set shortcut = WshShell.CreateShortcut(desktopDir & "\TikTok Fix.lnk")
shortcut.TargetPath = "wscript.exe"
shortcut.Arguments = """" & currentDir & "\run_silent.vbs"""
shortcut.WorkingDirectory = currentDir
shortcut.IconLocation = currentDir & "\tiktok.ico,0"
shortcut.Description = "TikTok Fix Desktop"
shortcut.Save
