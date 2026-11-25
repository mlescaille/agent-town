# agentlicense

Command line for [Agent License](https://github.com/mlescaille/agent-town). Issue a signed mandate, inspect the delegation chain, and dry-run a call before it reaches a tool.

```sh
npm install -g agentlicense
agentlicense --help
```

The package is not on the npm registry yet. From a clone:

```sh
pnpm install
pnpm build
pnpm exec agentlicense --help
```

`agentlicense dev` listens on `127.0.0.1` only. It is a prototype, not a production trust service. Command and flag details are generated from `agentlicense --help` in the [CLI reference](https://github.com/mlescaille/agent-town/blob/main/docs/cli.md).

Node.js 22 or newer.
