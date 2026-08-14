# dsh-client-ui-team

Web team configuration and status surface for the DeepSeek Harness team plugin.

## Role

Browser-side UI plugin that adds a Team settings section to the Settings panel, showing teammate configuration and usage instructions.

## Slot Registrations

| Target slot | Kind | Content |
|---|---|---|
| `settings.section` | list/root | Team configuration section with teammate list and setup instructions |

## Model Experience

None, as the package is a browser-side UI plugin that registers nothing model-facing.

#### KV Cache effect

No effect.

## Known Limitations and Deferred Work

- Settings section is read-only for MVP; inline teammate definition editing is deferred.
- Session-level team status dock bar and toggle button are deferred to a follow-up.
- Conversation node rendering for team events (delegation, messages, progress) is deferred.
