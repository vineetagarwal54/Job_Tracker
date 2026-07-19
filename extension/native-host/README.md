# JobTrack Native Messaging host

The packaged JobTrack executable is the native host. On Windows, register it
for the unpacked extension with:

```powershell
.\scripts\register-native-host.ps1 -ExecutablePath "C:\Path\To\JobTrack.exe" -ExtensionId "YOUR_EXTENSION_ID"
```

The host returns only the profile marked `isDefault` and never exposes the
app-data file. The extension does not submit applications.
