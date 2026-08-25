---
name: huddle-ui-design
description: Designs or reviews Huddle Host App, room lobby, and game web UI using the shared minimal visual and interaction system. Use when designing a new game UI, changing the lobby, unifying visual styles, or designing Host App screens.
---

# Huddle UI Design

Use this workflow before editing Huddle UI:

1. Read `design/huddle-ui-system.md` and the relevant existing UI files.
2. Identify ownership:
   - Android shell: game choice, service lifecycle, invitation, settings.
   - Shared web Shell: room and connection state for both host WebView and guests.
   - Game plugin: game canvas and game-specific state in `www/games/<game-id>/`.
3. Design all required states before writing components: loading, ready, disabled, waiting, reconnecting, recoverable error, blocking error, and completion.
4. Use semantic dual-theme tokens. Update Android and web mappings together whenever a shared token changes.
5. Validate narrow, medium, and wide layouts; touch targets; text/contrast; keyboard focus; screen-reader names; and reduced-motion behavior.

## Design decisions

- Prefer one clear primary action per task area.
- Use text first for room, connection, seat, ready, turn, and error state. Color and icons reinforce rather than replace meaning.
- Keep motion short and purposeful: press 100–150ms, transition 160–240ms, result layer at most 280ms.
- Treat the active game as the focus. Shell chrome stays quiet; each game may use only `game-accent`, its canvas, and game-specific information for personality.
- Do not create a native-only game UI or a host-only web flow.

## Required output for a UI task

Report:

1. User goal and affected journey stage.
2. Owning layer and target files.
3. State matrix, including network recovery and failure.
4. Token/component changes for both themes.
5. Responsive and accessibility acceptance checks.

## References

- Read [reference.md](reference.md) for the state matrix, responsive constraints, token mapping, and implementation checklist.
