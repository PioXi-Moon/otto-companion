import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const POWERSHELL = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

const PROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$text = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($text)
$encrypted = [Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($encrypted))
`.trim();

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$base64 = [Console]::In.ReadToEnd().Trim()
$encrypted = [Convert]::FromBase64String($base64)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $encrypted,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`.trim();

function runPowerShell(script, input) {
  return execFileSync(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    }
  );
}

export function secureStorageAvailable() {
  return process.platform === "win32" && fs.existsSync(POWERSHELL);
}

export function encryptString(clear) {
  if (!secureStorageAvailable()) throw new Error("Windows DPAPI 不可用");
  const base64 = runPowerShell(PROTECT_SCRIPT, clear).trim();
  return Buffer.from(base64, "ascii");
}

export function decryptString(encrypted) {
  if (!secureStorageAvailable()) throw new Error("Windows DPAPI 不可用");
  return runPowerShell(UNPROTECT_SCRIPT, encrypted.toString("ascii"));
}
