# Issue 132: command handling resolution on OpenCode 1.17.7

Issue #132 asks deterministic quota slash commands (`/quota`, `/quota_status`, `/quota_announcements`, `/pricing_refresh`, and `/tokens_*`) to satisfy all of these at once:

- produce deterministic local output;
- avoid visible OpenCode hook/command errors;
- avoid LLM/model calls;
- avoid writing or polluting OpenCode session storage.

The server `command.execute.before` hook cannot satisfy those requirements on OpenCode 1.17.7. The implementation therefore moves these commands to the TUI plugin's slash/palette command surface and renders output in local dialogs.

## Old server hook path

The old server plugin registered slash commands in `src/plugin.ts` and handled them from `command.execute.before`. For handled commands, it:

1. built deterministic local output;
2. injected that output with `client.session.prompt({ noReply: true, parts: [{ ignored: true, ... }] })`;
3. called `handled()` from `src/lib/command-handled.ts`, which throws a quiet branded sentinel error.

That throw was intentional: OpenCode 1.17.7 continues into the normal prompt/model path when `command.execute.before` resolves normally.

## OpenCode 1.17.7 pipeline proof

Relevant local OpenCode references under `references/opencode-source-v1.17.7/`:

- `packages/plugin/src/index.ts` defines `command.execute.before(input, output) => Promise<void>`. The hook exposes mutable `output.parts`, but no handled/cancel return value.
- `packages/opencode/src/session/prompt.ts` triggers `command.execute.before`; when the hook resolves normally, OpenCode proceeds to call `prompt(...)`.
- `packages/core/src/session.ts` and `packages/core/src/session/input.ts` persist admitted prompt input.
- `packages/plugin/src/tui.ts` supports TUI `api.keymap.registerLayer({ commands })` palette/slash commands and `api.ui.dialog.replace(...)`.

Therefore, the server hook path had an unavoidable trade-off: returning normally could continue into prompt/model/session persistence, while throwing aborted continuation but could surface hook errors. Injecting output through `session.prompt({ noReply: true, ignored: true })` also still routed display through OpenCode session prompt storage.

## Chosen resolution

Migrated deterministic slash commands are now owned by the TUI plugin:

```text
TUI slash/palette command
→ shared deterministic command-output builder
→ api.ui.dialog.replace(...)
```

This path:

- does not register those slash commands in the server plugin config;
- does not use `command.execute.before` for those command names;
- does not call `session.prompt()` or `handled()` for dialog command output;
- does not invoke a model;
- does not write command output into OpenCode session messages.

The server plugin still owns unrelated behavior: provider lifecycle, quota toasts, pricing initialization, question-tool hooks, `tool.quota_status`, and other non-slash-command functionality.

## Remaining compatibility note

`src/lib/command-handled.ts` remains for compatibility and tests of the branded sentinel helper. `injectRawOutput()` remains for the server `tool.quota_status` compatibility path, but it must not be reused for migrated TUI dialog slash commands.
