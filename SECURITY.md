# Security Policy

Do not report or commit API tokens, SSH private keys, VM-local LLM credentials, license data,
or simulation inputs/results that are not intended for publication.

The CLI intentionally has no arbitrary shell or SSH execution command. It calls the authenticated
Sentaurus Web Agent API, which in turn uses its fixed SSH bridge and the VM worker allowlist.

Plain HTTP does not protect bearer tokens from network observers. Use TLS or an SSH tunnel outside
a trusted network. Rotate `AUTH_TOKEN` immediately if it may have been disclosed.

Report security issues privately to the repository owner through GitHub rather than opening a
public issue containing exploit details or credentials.
