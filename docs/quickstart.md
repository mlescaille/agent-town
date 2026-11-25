---
title: Quickstart
description: Install Agent License, create keys, and issue a signed agent credential you can inspect and check.
---

# Quickstart

These commands issue a license, show who it names, and dry-run one call. They run on your machine. Nothing listens on a public address.

You need Node.js 22 or newer and pnpm 9. The packages are not on the npm registry yet. Names reserved for publish are `agentlicense`, `@agentlicense/sdk`, and `@agentlicense/core`.

## Install from a clone

```sh
git clone https://github.com/mlescaille/agent-town.git
cd agent-town
pnpm install
pnpm build
pnpm exec agentlicense --help
```

`pnpm install` builds the packages. The repository is private until its owner makes it public, so the clone works for people who already have access. After a publish, the same CLI is `npm install -g agentlicense`.

`npm install github:mlescaille/agent-town` installs this repository as a package and builds it, once npm can read the repository. The command name is still `agentlicense`.

## Keys

```sh
pnpm exec agentlicense keys init
```

That writes Ed25519 keys for an issuer, a log, `user:alice`, and two agents (`planner` and `researcher`) under `.agent-license/`. The directory is local and is not committed.

## Issue a user_goal license

The user key signs the request. The issuer key signs the license. The compact JWS is printed on stdout.

```sh
pnpm exec agentlicense issue \
  --user alice \
  --agent planner \
  --mandate user_goal \
  --goal "Summarize the primary calendar" \
  --actions calendar.read,calendar.create \
  --locations calendar:primary \
  --budget 10 \
  --ttl 3600 > license.jwt
```

## Inspect

```sh
pnpm exec agentlicense inspect "$(cat license.jwt)"
```

`inspect` prints the agent id, the user, the mandate, the scope, and the delegation chain. With the key directory in place it also checks the issuer signature.

## Check a call

This asks the Cedar policy without starting the services and without writing the log.

```sh
pnpm exec agentlicense check \
  --license "$(cat license.jwt)" \
  --action calendar.read \
  --location calendar:primary \
  --why "Reading today's events is how the summary gets its facts."
```

A call outside the license is denied:

```sh
pnpm exec agentlicense check \
  --license "$(cat license.jwt)" \
  --action mail.send \
  --location mail:outbox \
  --why "Sending mail is outside the calendar summary."
```

## Hand a narrower license to a sub-agent

Scope, budget, and expiry can shrink. They cannot grow, and the mandate type stays the same.

```sh
pnpm exec agentlicense attenuate \
  --parent "$(cat license.jwt)" \
  --agent researcher \
  --actions calendar.read \
  --locations calendar:primary \
  --budget 3 \
  --ttl 600 > child.jwt
```

```sh
pnpm exec agentlicense inspect "$(cat child.jwt)"
```

```sh
pnpm exec agentlicense check \
  --license "$(cat child.jwt)" \
  --action calendar.read \
  --location calendar:primary \
  --why "The sub-agent only reads the calendar it was given."
```

## The other two mandates

`direct_request` names one action and one location. The checkpoint allows only that pair.

```sh
pnpm exec agentlicense issue \
  --user alice \
  --agent planner \
  --mandate direct_request \
  --action calendar.read \
  --location calendar:primary \
  --budget 1 \
  --ttl 600 > direct.jwt
```

`agent_initiated` is the agent acting on its own, inside a fixed read-only ceiling.

```sh
pnpm exec agentlicense issue \
  --user alice \
  --agent planner \
  --mandate agent_initiated \
  --actions clock.read,catalog.list,memory.read \
  --locations clock:local,catalog:public,memory:self \
  --budget 5 \
  --ttl 600 > initiated.jwt
```

## Verify the log

`check` does not append decisions. `log verify` with no server replays the files under `.agent-license/log/`. Right after `keys init` that log is empty, and an empty log still verifies.

```sh
pnpm exec agentlicense log verify
```

To append decisions, start the stack with `agentlicense dev` and then verify the URL. That is covered in [Running a checkpoint](checkpoint.md).
