---
title: Documentation
description: Install Agent License, issue a signed agent credential, and check which agent is calling an API.
---

# Documentation

Agent License is a prototype of agent identity and delegated authority. An issuer signs a license that names the agent, the user it acts for, and what it may do. A checkpoint outside the agent checks that credential on every call.

| Page | What it covers |
| --- | --- |
| [Quickstart](quickstart.md) | Install, keys, issue, inspect, check, log |
| [Concepts](concepts.md) | License, mandates, delegation, checkpoint, policy, log |
| [CLI](cli.md) | Every `agentlicense` command and flag |
| [SDK](sdk.md) | `licensed(fetch)` and the core API |
| [Checkpoint](checkpoint.md) | Run the local issuer, checkpoint, PDP, and log |
| [FAQ](faq.md) | What is real today, including open pull request #1 |

The byte-level rules are in [spec/LICENSE-FORMAT.md](https://github.com/mlescaille/agent-town/blob/main/spec/LICENSE-FORMAT.md). Limits of this prototype are in [ROADMAP.md](https://github.com/mlescaille/agent-town/blob/main/ROADMAP.md).
