Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\Code\AprTracking\desktop-widget"
WshShell.Run "npm start", 0
Set WshShell = Nothing
