import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

type CredentialRequest =
  | { operation: 'read' | 'delete'; target: string }
  | { operation: 'write'; target: string; value: string }

// Use Windows' own credential APIs. The request travels over stdin, never through
// the command line. The encoded PowerShell command contains only this static code.
const command = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class MeetingCredentials {
    private const uint Generic = 1;
    private const uint LocalMachine = 2;
    private const int NotFound = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct Credential {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    private static extern bool CredWriteW(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    private static extern bool CredDeleteW(string target, uint type, uint flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);

    public static string Read(string target) {
        IntPtr pointer;
        if (!CredReadW(target, Generic, 0, out pointer)) {
            int error = Marshal.GetLastWin32Error();
            if (error == NotFound) return null;
            throw new Win32Exception(error);
        }
        try {
            var stored = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            byte[] bytes = new byte[stored.CredentialBlobSize];
            Marshal.Copy(stored.CredentialBlob, bytes, 0, bytes.Length);
            try { return Encoding.UTF8.GetString(bytes); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        } finally { CredFree(pointer); }
    }

    public static void Write(string target, string value) {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try {
            var credential = new Credential {
                Type = Generic, TargetName = target, UserName = "Agent Meeting",
                CredentialBlobSize = (uint)bytes.Length, CredentialBlob = handle.AddrOfPinnedObject(),
                Persist = LocalMachine
            };
            if (!CredWriteW(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!String.Equals(Read(target), value, StringComparison.Ordinal)) throw new InvalidOperationException();
        } finally {
            Array.Clear(bytes, 0, bytes.Length);
            handle.Free();
        }
    }

    public static void Delete(string target) {
        if (!CredDeleteW(target, Generic, 0)) {
            int error = Marshal.GetLastWin32Error();
            if (error != NotFound) throw new Win32Exception(error);
        }
    }
}
"@
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))
$results = foreach ($request in (ConvertFrom-Json $inputJson)) {
    try {
        switch ($request.operation) {
            'read'   { @{ ok = $true; value = [MeetingCredentials]::Read($request.target) } }
            'write'  { [MeetingCredentials]::Write($request.target, $request.value); @{ ok = $true } }
            'delete' { [MeetingCredentials]::Delete($request.target); @{ ok = $true } }
        }
    } catch { @{ ok = $false } }
}
[Console]::Write((ConvertTo-Json -InputObject @($results) -Compress))
`, 'utf16le').toString('base64')

interface CredentialResult {
  ok: boolean
  value?: string | null
}

export class WindowsCredentials {
  private readonly prefix: string

  constructor(profile: string) {
    const account = createHash('sha256').update(profile.toLowerCase()).digest('hex').slice(0, 20)
    this.prefix = 'AgentMeeting/' + account + '/'
  }

  target(ref: string): string {
    return this.prefix + ref
  }

  async apply(requests: CredentialRequest[]): Promise<CredentialResult[]> {
    if (!requests.length) return []
    if (process.platform !== 'win32') throw new Error('当前系统无法使用 Windows 凭据管理器。')
    const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return new Promise((resolve, reject) => {
      const fail = (): void => reject(new Error('无法访问 Windows 凭据管理器。'))
      const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      })
      let output = ''
      const timeout = setTimeout(() => { child.kill(); fail() }, 15000)
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk })
      child.on('error', () => { clearTimeout(timeout); fail() })
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code !== 0) return fail()
        try {
          const results = JSON.parse(output) as CredentialResult[]
          if (!Array.isArray(results) || results.length !== requests.length) return fail()
          resolve(results)
        } catch { fail() }
      })
      child.stdin.on('error', fail)
      child.stdin.end(Buffer.from(JSON.stringify(requests), 'utf8').toString('base64') + '\n')
    })
  }
}

