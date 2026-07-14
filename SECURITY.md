# Security Policy

Do not report or commit API tokens, SSH private keys, VM-local LLM credentials, license data,
or simulation inputs/results that are not intended for publication.

The CLI intentionally has no arbitrary shell or SSH execution command. It calls the authenticated
Sentaurus Web Agent API, which in turn uses its fixed SSH bridge and the VM worker allowlist.
Model updates are also allowlisted: only the five compiled model IDs are accepted, and the VM `.env`
is updated atomically without returning its API base or key.

In the recommended `vm-agent` host-local mode, users authenticate to Windows with OpenSSH. The CLI
then reads the API token from the host-local Web Agent `.env`; the token is not copied to the remote
client, placed in command history, or printed. Fastify should bind to `::1` in this mode.

Plain HTTP does not protect bearer tokens from network observers. Use TLS or an SSH tunnel outside
a trusted network. Do not expose port 5175 publicly in SSH-only mode, and rotate `AUTH_TOKEN`
immediately if it may have been disclosed.

Report security issues privately to the repository owner through GitHub rather than opening a
public issue containing exploit details or credentials.
