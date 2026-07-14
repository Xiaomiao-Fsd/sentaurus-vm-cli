# IPv6 部署与外部连接

本文针对 `sentaurus-web-agent` 运行在 Windows、CentOS 7 Sentaurus 运行在 VMware VM
中的部署。命令需要在 Web 服务仓库或管理员 PowerShell 中执行。

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

## 2. 让 Fastify 监听 IPv6

编辑 `sentaurus-web-agent/.env`，保留已有 token，不要把真实值写入 Git：

```env
HOST=::
PORT=5175
AUTH_TOKEN=<at-least-24-random-characters>
SENTAURUS_SSH_TARGET=sentaurus-centos7
```

CLI 不受 CORS 限制。若还要从 IPv6 地址打开 Web UI，应把 `CORS_ORIGIN` 设置成实际
Web UI origin，例如 `http://[<host-ipv6>]:5174`。

启动并检查监听地址：

```powershell
npm run dev:server
Get-NetTCPConnection -State Listen -LocalPort 5175
Invoke-RestMethod 'http://[::1]:5175/api/health'
```

预期监听地址是 `::`，健康检查返回 `ok: true`。

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

直接开放 API 端口时，在管理员 PowerShell 中执行：

```powershell
New-NetFirewallRule -DisplayName 'Sentaurus VM Agent API 5175' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5175 -Profile Any
```

若只使用 SSH tunnel，不需要开放 5175；只需保证 Windows OpenSSH 的 22 端口能从外部
IPv6 访问。长期部署建议删除宽泛的 5175 规则或用 `-RemoteAddress` 限制来源。

## 5. 外部验收

在另一条网络、另一台有 IPv6 的机器上执行：

```powershell
curl.exe -g "http://[<host-ipv6>]:5175/api/health"

$env:SENTAURUS_VM_URL = 'http://[<host-ipv6>]:5175'
$env:SENTAURUS_VM_TOKEN = '<AUTH_TOKEN>'
sentaurus-vm doctor --json
sentaurus-vm connect --json
sentaurus-vm chat '/status'
```

`doctor` 成功需要同时证明：HTTP 健康、token 认证、Windows 到 VM 的 SSH、worker 运行，
以及 Sentaurus tools 可发现。仅本机访问 `[::1]` 不能证明公网入站有效。

## 6. 推荐的 SSH tunnel

公网不应长期传输明文 bearer token。外部机器执行：

```powershell
ssh -N -L 5175:127.0.0.1:5175 <windows-user>@<host-ipv6>
```

另开终端：

```powershell
$env:SENTAURUS_VM_URL = 'http://127.0.0.1:5175'
$env:SENTAURUS_VM_TOKEN = '<AUTH_TOKEN>'
sentaurus-vm doctor
```

若本地 5175 已占用，可改左侧端口，例如 `-L 15175:127.0.0.1:5175`，并将 CLI URL
改成 `http://127.0.0.1:15175`。

## 7. 故障定位

- `health` 失败：检查 Node 进程、`HOST=::` 和 5175 监听。
- 本机 IPv6 成功、外部失败：检查 Windows 防火墙、路由器 IPv6 入站策略和运营商过滤。
- HTTP 401：CLI token 与服务端 `AUTH_TOKEN` 不一致。
- `connected=false`：在 Windows 主机直接执行 `ssh sentaurus-centos7`，检查 alias/key/VM IP。
- `workerRunning=false`：执行 `sentaurus-vm connect`，再看 status 中的错误。
- SSH tunnel 能用、直连不能用：应用本身正常，问题位于公网 IPv6 入站路径。
