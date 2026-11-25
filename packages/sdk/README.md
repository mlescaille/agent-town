# @agentlicense/sdk

`licensed(fetch)` presents a signed agent license and a fresh justification to a checkpoint outside the agent.

```sh
npm install @agentlicense/sdk
```

```js
import { licensed } from "@agentlicense/sdk";

const call = licensed(fetch, {
  license,
  agentPrivateKey,
  checkpoint: "http://127.0.0.1:43122",
  why: "Reading the calendar is how the summary is produced.",
});
```

The package is not on the npm registry yet. Until it is published, clone the repository. The runnable example is `examples/sdk-quickstart/main.mjs`. Full notes are in the [SDK reference](https://github.com/mlescaille/agent-town/blob/main/docs/sdk.md).

Node.js 22 or newer. This package is ESM only. It depends on `@agentlicense/core`.
