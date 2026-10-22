# Infinite Generation Two for Pi

A native [Pi](https://github.com/earendil-works/pi) extension that loads the repository's original Infinite Generation Two system prompt, exposes its profile as a tool, and displays a lightweight response-status indicator.

**Version 0.3.0 targets Pi, not DeepSeek Harness.** It preserves `prompts/infinite-gen-2.md` byte-for-byte from upstream version 0.2.3. The prompt itself has not been translated or rewritten.

## Requirements

- Node.js **22.19 or newer**.
- `@earendil-works/pi-coding-agent` **0.99.1 or a compatible newer version**. The SDK tests target 0.99.1; offline CLI loading was also checked with 1.4.0.
- A model already configured in Pi. This extension does not supply a DeepSeek connection or credentials.

The prompt was originally written for DeepSeek. Loading it with another model does not establish equivalent behavior. The status indicator is a text-matching heuristic, not proof that a prompt changes a model's behavior. The extension does not change tool permissions or approval decisions.

## Install

Install the package from this fork:

```bash
pi install git:github.com/FidesTherese/dsh-infinite-gen-2
```

Restart Pi, or run `/reload` in an existing session. Start a new conversation when comparing enabled and disabled behavior: disabling the extension does not remove instructions or tool output already present in conversation history.

For installation scoped to the current project:

```bash
pi install --local git:github.com/FidesTherese/dsh-infinite-gen-2
```

Pi asks for project trust before loading project-local packages.

### Try a local checkout

```bash
git clone https://github.com/FidesTherese/dsh-infinite-gen-2.git
cd dsh-infinite-gen-2
pi -e .
```

You can also load the entry point directly with `pi -e ./index.ts`. Pi loads TypeScript extensions without a separate build. For a persistent local installation, run `pi install .` from the checkout. Keep the complete package together: the entry point needs `src/` and `prompts/`.

Pi supplies the host and TypeBox peer dependencies for managed installations. Run `npm ci --ignore-scripts` if you want the pinned development dependencies in a local checkout.

## Use the extension

The prompt is enabled when a session starts unless you pass the startup flag:

```bash
pi --infinite-gen2-off
```

When trying a checkout without installation:

```bash
pi -e . --infinite-gen2-off
```

Use the following commands inside Pi:

| Command | Result |
| --- | --- |
| `/infinite-gen2` | Show current status. |
| `/infinite-gen2 status` | Show current status without changing it. |
| `/infinite-gen2 on` | Enable prompt injection and response monitoring for subsequent runs. |
| `/infinite-gen2 off` | Disable injection and monitoring for subsequent runs. |

Toggles are session-local. New, resumed, forked, and reloaded sessions use the startup flag again. A toggle does not retract a system prompt already sent during a running request.

### Inspect the bundled profile

Ask Pi to call **`infinite_gen2_profile`**, a read-only tool with no parameters. It returns:

- The exact bundled system prompt and its SHA-256 fingerprint.
- Extension version `0.3.0` and unchanged upstream prompt version `0.2.3`.
- Original display name, lineage, feature labels, and calibration metadata.

The profile tool remains available while injection is off. Upstream calibration numbers are historical metadata, not benchmarks performed by this port. Calling this tool adds its returned prompt to the conversation, even if injection is disabled.

### Read the status indicator

The Pi status area shows `on`, `off`, or `thinking`. After Pi finishes all automatic work, it can show a `pass`, `refusal`, or `fallback` heuristic verdict. Provider errors and cancelled responses show `error` or `aborted`, rather than a passing verdict. This also covers failure or cancellation during automatic compaction.

The inherited detector examines assistant text only; it ignores thinking blocks and tool calls. Quoted refusal phrases can produce false positives. A pass means only that none of the tracked phrases matched. The extension never rewrites a response or retries a request because of a verdict.

Interactive Pi and supported RPC clients can receive status updates. Print and JSON modes still receive the prompt and tool without terminal output. Commands in headless mode report a custom status message without starting a model turn.

## How the repository is organized

```text
dsh-infinite-gen-2/
├── index.ts                   # Native Pi factory, commands, and lifecycle hooks
├── src/
│   ├── profile.ts             # Prompt integrity, metadata, and profile-tool schema
│   └── armor.ts               # Pure response scoring and English status labels
├── prompts/
│   └── infinite-gen-2.md       # Original system prompt; unchanged
├── test/
│   ├── extension.test.ts      # Real Pi SDK/runner integration and focused unit tests
│   └── smoke.test.ts          # Offline Pi CLI loading checks
├── docs/
│   ├── DTD.tex / DTD.pdf      # Implementation contract and roadmap
│   └── modules/               # One extension-module design note
├── specification.tex / .pdf   # Scope, original structure, and architecture
├── package.json               # Explicit Pi manifest and host-provided peers
├── package-lock.json          # Reproducible development dependencies
└── LICENSE                    # Original MIT notice
```

The original repository had three host-specific parts: `index.js` registered Harness services, `client.js` rendered a React badge, and the installers modified Harness profiles. The Pi port replaces those parts rather than emulating the old host. The original implementation remains in Git history at commit `3a701c3`.

At runtime, Pi calls `index.ts`, which adds an `infinite_gen2` system-prompt section before a run. Pi's base instructions, tools, project context, and other extension sections are preserved. The profile helper verifies and reads the bundled asset; the status helper scores completed assistant text. Only the adapter owns session state. There are no background processes, network requests, telemetry, or application filesystem writes.

Another extension that replaces the entire system prompt can supersede structured sections. The extension reports a missing or changed prompt as a load error rather than silently substituting different instructions.

## Verify a checkout

```bash
npm ci --ignore-scripts
npm test
npm run check
npm run smoke
npm pack --dry-run
```

Tests use Pi's real extension loader, event runner, command dispatcher, and tool registry with isolated temporary state. They cover prompt integrity, section composition, profile output, toggles, lifecycle outcomes, and headless operation. Smoke tests load the package through the actual offline CLI. No paid model request is needed.

The prompt fingerprint is:

```text
02679eb726507d5a6bfe0a327c8469965440be7a7c5104cab57b8d1e529ec466
```

The runtime integrity check and regression test both enforce this fingerprint. Git treats the prompt as an exact-byte asset to prevent checkout-time newline conversion.

The specification, detailed technical design, and module note are English LaTeX/PDF reviewer artifacts. They use the development workspace's shared `tem.tex` / `tem.sty` template and LuaLaTeX; those shared template inputs are not runtime dependencies. Change evidence is included under `docs/evidence/` in the Git checkout, with its canonical copy in the parent development workspace.

## Remove

For a Git installation, use the same source and scope you installed:

```bash
pi remove git:github.com/FidesTherese/dsh-infinite-gen-2
# If installed with --local:
pi remove --local git:github.com/FidesTherese/dsh-infinite-gen-2
```

For a local installation, use `pi remove .` from the checkout. Restart Pi or run `/reload`. Stop using `-e` if you only loaded the extension temporarily. This port neither edits nor removes an existing DeepSeek Harness installation.

## License and attribution

[MIT](LICENSE). The original notice credits **0x5477**. This fork preserves the prompt and metadata from the [YAN-143 upstream repository](https://github.com/YAN-143/dsh-infinite-gen-2), whose history derives from Minglink's implementation. The Pi integration is maintained in this repository. License attribution is retained independently of the removed promotional material.
