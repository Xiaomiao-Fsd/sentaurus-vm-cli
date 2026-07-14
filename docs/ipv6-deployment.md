# IPv6 部署与外部连接

本文针对 `sentaurus-web-agent` 运行在 Windows、CentOS 7 Sentaurus 运行在 VMware VM
中的部署。命令需要在 Web 服务仓库或管理员 PowerShell 中执行。

先在 CLI 仓库的管理员 PowerShell 中配置 SSH PowerShell 入口和固定命令：

```powershell
npm link
.\scripts\install-ssh-entry.ps1
```

该脚本把 Windows OpenSSH 默认 shell 设置为 PowerShell，并让管理员账号同时读取
`C:\ProgramData\ssh\administrators_authorized_keys` 与用户自己的 `.ssh\authorized_keys`。

## 1. 验证主机到 VM 的 SSH

Windows OpenSSH 配置应包含：

```text
Host sentaurus-centos7
  HostName <centos-vm-ip>
  User TCAD2022
  IdentityFile C:\Users\<user>\.ssh\sentaurus_vm_ed25519
```

只做只读探测：

```powershell
ssh -o BatchMode=yes sentaurus-centos7 "hostname; whoami; command -v sde; command -v sdevice"
```

## 2. SSH-only 的 Fastify 监听

编辑 `sentaurus-web-agent/.env`，保留已有 token，不要把真实值写入 Git：

```env
HOST=::1
PORT=5175
AUTH_TOKEN=<at-least-24-random-characters>
SENTAURUS_SSH_TARGET=sentaurus-centos7
```

外部用户先通过 SSH 登录 Windows，再在主机 PowerShell 内运行 `vm-agent`。API 只监听
loopback，`AUTH_TOKEN` 仍保留但由本地主机模式自动读取。

启动并检查监听地址：

```powershell
npm run dev:server
Get-NetTCPConnection -State Listen -LocalPort 5175
Invoke-RestMethod 'http://[::1]:5175/api/health'
```

预期监听地址是 `::1`，健康检查返回 `ok: true`。

长期运行时不要依赖临时终端中的后台子进程。CLI 仓库包含一个系统启动触发并在异常退出后
重启的 Windows S4U 计划任务安装脚本；在管理员 PowerShell 中执行：

```powershell
Set-Location E:\vscode\sentaurus-vm-cli
.\scripts\install-windows-server-task.ps1
Get-ScheduledTask -TaskName 'Sentaurus VM Agent IPv6 API'
```

启动日志写入 `sentaurus-web-agent/.ipv6-server.log`。

## 3. 获取当前公网 IPv6

```powershell
Get-NetIPAddress -AddressFamily IPv6 |
  Where-Object {
    $_.AddressState -eq 'Preferred' -and
    $_.IPAddress -notlike 'fe80:*' -and
    $_.IPAddress -notlike '2001:0:*' -and
    $_.IPAddress -ne '::1'
  } |
  Select-Object InterfaceAlias,IPAddress,PrefixLength
```

优先使用物理 WLAN/Ethernet 接口上的 global unicast 地址，不要把 `fe80::` link-local
或 Teredo 地址当成稳定服务地址。住宅网络的隐私 IPv6 可能变化，生产使用应配置 DNS。

## 4. Windows 防火墙

SSH-only 模式不开放 5175。安装脚本默认会禁用已有 API 入站规则：

```powershell
.\scripts\install-windows-server-task.ps1
```

只需保证 Windows OpenSSH 的 22 端口能从外部 IPv6 访问。仅在已经配置 TLS、明确需要
远程 API 时使用 `.\scripts\install-windows-server-task.ps1 -PublicApi`。

## 5. 外部验收

在另一条网络、另一台有 IPv6 的机器上执行：

```powershell
ssh -6 -l sshdev <host-ipv6>
# 登录后的 Windows PowerShell：
vm-agent /status
vm-agent
```

该验证同时覆盖：公网 IPv6 SSH、Windows PowerShell、loopback API、主机到 VM 的 SSH、
worker 启动和消息回复。

## 6. 可选的 SSH tunnel

`vm-agent` 是推荐方式，不需要 tunnel。若外部脚本必须直接调用 API，可在 SSH 中转发：

```powershell
ssh -N -L 5175:127.0.0.1:5175 <windows-user>@<host-ipv6>
```

另开终端：

```powershell
$env:SENTAURUS_VM_URL = 'http://127.0.0.1:5175'
$env:SENTAURUS_VM_TOKEN = '<从主机安全取得的 AUTH_TOKEN>'
sentaurus-vm doctor
```

若本地 5175 已占用，可改左侧端口，例如 `-L 15175:127.0.0.1:5175`，并将 CLI URL
改成 `http://127.0.0.1:15175`。

## 7. 故障定位

- `health` 失败：检查计划任务、Node 进程、`HOST=::1` 和 5175 loopback 监听。
- 外部 SSH 失败：检查 sshd、TCP 22 防火墙、IPv6 地址和用户公钥。
- HTTP 401：CLI token 与服务端 `AUTH_TOKEN` 不一致。
- `connected=false`：在 Windows 主机直接执行 `ssh sentaurus-centos7`，检查 alias/key/VM IP。
- `workerRunning=false`：执行 `sentaurus-vm connect`，再看 status 中的错误。
- SSH tunnel 能用、直连不能用：应用本身正常，问题位于公网 IPv6 入站路径。
