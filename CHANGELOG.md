# Changelog

## 0.1.2

- README: the Marketplace is now the main install method, with the manual `typescript.json` copy kept as an alternative. Title and intro match the extension name. No snippet changes.

## 0.1.1

First release as a VS Code extension, with 14 `xp-` snippets:

- **App:** `xp-app`, `xp-server`
- **Routing:** `xp-route`, `xp-controller`
- **Middleware:** `xp-mw-base`, `xp-mw-auth`, `xp-mw-error`, `xp-mw-idempotency`, `xp-mw-log`
- **Errors:** `xp-error-base`
- **Data:** `xp-service`, `xp-types`, `xp-mockdb`
- **Tests:** `xp-test-unit`

`xp-mw-log` (request logger that also records aborted requests) contributed by [@PandaHUN777](https://github.com/PandaHUN777) in [#6](https://github.com/menahil-tanveer55/vscode-ts-backend-snippets/pull/6).
