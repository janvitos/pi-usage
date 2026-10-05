# @janvitos/pi-usage

## 0.53.1

### Patch Changes

- Add Claude statusline reset countdowns to the right of each usage window: hours and minutes for the five-hour limit, and days, hours, and minutes for the weekly limit.
- Unify Claude session and five-hour usage labels as `5h` in the statusline and `Five-hour` in `/usage`.

## 0.53.0

### Minor Changes

- Add Claude subscription usage (session, weekly, and model-scoped windows with reset times) for Pi's Anthropic OAuth login, including `claude-bridge` models from `pi-claude-agent-sdk`. Uses an undocumented Anthropic endpoint; API keys, mismatched credentials, and custom/proxy origins are rejected.
- **Breaking display change:** quota percentages now show usage **used** instead of remaining, for Codex, GitHub Copilot, and Claude, so they rise toward 100% like Pi's context percentage. Statusline colours are inverted to match (green when low). OpenCode Go already showed used; OpenRouter dollar balances are unchanged.

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
