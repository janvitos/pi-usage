# @janvitos/pi-usage

## 0.52.9

### Patch Changes

- Recognize native `openai` Sign in with ChatGPT OAuth separately from unsupported API-key usage reporting.
- Link to ChatGPT usage settings without inventing numerical quotas, reset times, or footer usage values.
- Require matching runtime OAuth credentials and the direct-token scope, reject custom/proxy origins, and keep Codex accounts separate.

## 0.52.1

### Patch Changes

- 30bc076: Load each extension from a generated TypeScript runtime to reduce Jiti package startup work while preserving existing first-use boundaries.

## 0.52.0

### Minor Changes

- ab49f5b: Add OpenCode Go Zen usage reporting for rolling, weekly, and monthly quota windows.

## 0.51.0

### Minor Changes

- e71cf31: Add persistent OpenAI Codex Fast routing with a `/fast` shortcut, a contextual `/usage` toggle, explicit usage guidance, and effective statusline labeling.

## 0.50.0

### Minor Changes

- a5b0feb: Add safe redemption of earned OpenAI Codex usage-limit resets for the current matching Pi OAuth account.

### Patch Changes

- Updated dependencies [2d79365]
  - @narumitw/pi-tui-kit@0.50.0
