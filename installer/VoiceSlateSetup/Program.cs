using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;

internal static class Program
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("VOICE_SLATE_PAYLOAD_V1");

    private static int Main()
    {
        try
        {
            Console.WriteLine("VoiceSlate Local STT Setup");
            string installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VoiceSlate"
            );
            string tempZip = Path.Combine(Path.GetTempPath(), "VoiceSlate-runtime-" + Guid.NewGuid().ToString("N") + ".zip");

            StopInstalledProcesses(installDir);
            ExtractPayload(tempZip);
            ReplaceInstall(installDir, tempZip);
            SeedSettings(installDir);
            CreateShortcuts(installDir);
            StartLauncher(installDir);

            Console.WriteLine("Install complete: " + installDir);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Install failed:");
            Console.Error.WriteLine(ex);
            Console.WriteLine("Press Enter to exit.");
            Console.ReadLine();
            return 1;
        }
    }

    private static void ExtractPayload(string tempZip)
    {
        string exePath = Process.GetCurrentProcess().MainModule != null
            ? Process.GetCurrentProcess().MainModule.FileName
            : Assembly.GetExecutingAssembly().Location;
        using (FileStream input = File.OpenRead(exePath))
        {
            if (input.Length < Magic.Length + sizeof(long))
            {
                throw new InvalidOperationException("Installer payload marker is missing.");
            }

            input.Seek(-Magic.Length, SeekOrigin.End);
            byte[] magic = ReadBytes(input, Magic.Length);
            if (!BytesEqual(magic, Magic))
            {
                throw new InvalidOperationException("Installer payload marker is invalid.");
            }

            input.Seek(-(Magic.Length + sizeof(long)), SeekOrigin.End);
            long payloadLength = BitConverter.ToInt64(ReadBytes(input, sizeof(long)), 0);
            if (payloadLength <= 0 || payloadLength > input.Length)
            {
                throw new InvalidOperationException("Installer payload length is invalid.");
            }

            long payloadStart = input.Length - Magic.Length - sizeof(long) - payloadLength;
            input.Seek(payloadStart, SeekOrigin.Begin);
            using (FileStream output = File.Create(tempZip))
            {
                CopyBytes(input, output, payloadLength);
            }
        }
    }

    private static void ReplaceInstall(string installDir, string tempZip)
    {
        try
        {
            if (Directory.Exists(installDir))
            {
                Retry(delegate { Directory.Delete(installDir, true); });
            }
            Directory.CreateDirectory(installDir);
            ZipFile.ExtractToDirectory(tempZip, installDir);
        }
        finally
        {
            TryDeleteFile(tempZip);
        }

        string launcher = Path.Combine(installDir, "launch-voiceslate-local.vbs");
        string appExe = Path.Combine(installDir, "voiceslate.exe");
        string backend = Path.Combine(installDir, "resources", "backend", "server.mjs");
        string commandModel = Path.Combine(installDir, "local-stt", "models", "models--Systran--faster-whisper-tiny");
        if (!File.Exists(launcher) || !File.Exists(appExe) || !File.Exists(backend) || !Directory.Exists(commandModel))
        {
            throw new InvalidOperationException("Install verification failed. Runtime files are incomplete.");
        }
    }

    private static void SeedSettings(string installDir)
    {
        string defaultsDir = Path.Combine(installDir, "defaults");
        string appSettingsDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "com.voiceslate.app"
        );
        Directory.CreateDirectory(appSettingsDir);
        CopyDefaultIfMissing(
            Path.Combine(defaultsDir, "settings.json"),
            Path.Combine(appSettingsDir, "settings.json")
        );
        CopyDefaultIfMissing(
            Path.Combine(defaultsDir, "settings.json.managed-llm.json"),
            Path.Combine(appSettingsDir, "settings.json.managed-llm.json")
        );
    }

    private static void CopyDefaultIfMissing(string source, string destination)
    {
        if (File.Exists(source) && !File.Exists(destination))
        {
            File.Copy(source, destination);
        }
    }

    private static void StopInstalledProcesses(string installDir)
    {
        HashSet<string> targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        targets.Add(Path.Combine(installDir, "voiceslate.exe"));
        targets.Add(Path.Combine(installDir, "resources", "node-runtime", "node.exe"));
        targets.Add(Path.Combine(installDir, "local-stt", "venv", "Scripts", "python.exe"));

        foreach (Process process in Process.GetProcesses())
        {
            try
            {
                string path = process.MainModule != null ? process.MainModule.FileName : null;
                if (path != null && targets.Contains(path))
                {
                    process.Kill();
                    process.WaitForExit(5000);
                }
            }
            catch
            {
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static void CreateShortcuts(string installDir)
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft",
            "Windows",
            "Start Menu",
            "Programs"
        );
        Directory.CreateDirectory(startMenu);

        string launcher = Path.Combine(installDir, "launch-voiceslate-local.vbs");
        string appExe = Path.Combine(installDir, "voiceslate.exe");
        string wscript = Path.Combine(Environment.SystemDirectory, "wscript.exe");
        CreateShortcut(Path.Combine(desktop, "VoiceSlate.lnk"), wscript, "\"" + launcher + "\"", installDir, appExe + ",0");
        CreateShortcut(Path.Combine(startMenu, "VoiceSlate.lnk"), wscript, "\"" + launcher + "\"", installDir, appExe + ",0");
    }

    private static void CreateShortcut(
        string shortcutPath,
        string targetPath,
        string arguments,
        string workingDirectory,
        string iconLocation
    )
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new InvalidOperationException("WScript.Shell is not available.");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = targetPath;
        shortcut.Arguments = arguments;
        shortcut.WorkingDirectory = workingDirectory;
        shortcut.IconLocation = iconLocation;
        shortcut.Save();
    }

    private static void StartLauncher(string installDir)
    {
        string launcher = Path.Combine(installDir, "launch-voiceslate-local.vbs");
        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = Path.Combine(Environment.SystemDirectory, "wscript.exe");
        startInfo.Arguments = "\"" + launcher + "\"";
        startInfo.WorkingDirectory = installDir;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        Process.Start(startInfo);
    }

    private static byte[] ReadBytes(Stream input, int count)
    {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = input.Read(buffer, offset, count - offset);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
        return buffer;
    }

    private static bool BytesEqual(byte[] left, byte[] right)
    {
        if (left.Length != right.Length) return false;
        for (int i = 0; i < left.Length; i++)
        {
            if (left[i] != right[i]) return false;
        }
        return true;
    }

    private static void CopyBytes(Stream input, Stream output, long bytes)
    {
        byte[] buffer = new byte[1024 * 1024];
        while (bytes > 0)
        {
            int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, bytes));
            if (read <= 0) throw new EndOfStreamException();
            output.Write(buffer, 0, read);
            bytes -= read;
        }
    }

    private static void Retry(Action action)
    {
        Exception last = null;
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                action();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                Thread.Sleep(500);
            }
        }
        throw last ?? new IOException("Operation failed.");
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
        }
    }
}
