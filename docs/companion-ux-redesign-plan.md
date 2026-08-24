# Expo Companion UX Redesign Plan

Checkpoint: `checkpoint/pre-ux-redesign-2026-08-23` (`149e7c9`)

Audit date: 2026-08-23

## Product direction

Build a quiet, native-feeling personal operations client—not a developer dashboard squeezed into React Native. Navigation, data behavior, and permissions stay powerful; presentation becomes focused, readable, and consistent.

### Visual system

Use a graphite-and-sage palette instead of neon lime everywhere:

- Canvas: `#090B0A`
- Grouped canvas: `#111411`
- Surface: `#181C19`
- Raised surface: `#202520`
- Separator: `#303630`
- Primary text: `#F2F4F1`
- Secondary text: `#9AA29A`
- Tertiary text: `#697169`
- Brand sage: `#A8C98A`
- Brand pressed: `#8FB273`
- Information blue: `#64A8FF`
- Success: `#55C787`
- Warning: `#E7B85B`
- Destructive: `#F06F6A`

Brand sage is reserved for selection, primary actions, and progress. Semantic colors communicate meaning. Remove emoji from desktop navigation and use one coherent icon family.

### Layout and interaction principles

- Root stack above tabs; details and workflows cover tabs.
- Mobile: native stack + three primary tabs.
- Desktop: persistent navigation, intentional master/detail layouts, readable content widths.
- One clear primary action per screen.
- Lists show useful summaries; details show complete information.
- No raw JSON as a primary interface.
- No tiny inline action clusters. Use row navigation, menus, or focused detail actions.
- Destructive actions live behind menus and confirmations.
- Every async screen has loading, empty, error, refreshing, and success states.
- Preserve selection/query state when popping the stack.
- Every route is deep-linkable where the backend can reconstruct it.

## Foundation tasks

- [ ] Split the monolithic `OperationsScreen` into domain screens and focused shared primitives.
- [ ] Move remaining data access into `@vito/client` query hooks.
- [ ] Introduce design tokens for color, spacing, type, radii, elevation, and motion.
- [ ] Add a coherent cross-platform icon system; remove emoji navigation.
- [ ] Create shared primitives: `Screen`, `NavigationHeader`, `Section`, `ListRow`, `StatusBadge`, `EmptyState`, `ErrorState`, `Skeleton`, `SearchField`, `ActionMenu`, `ConfirmSheet`, and `FormField`.
- [ ] Define desktop widths for sidebar, master lists, readable forms, and detail columns.
- [ ] Add accessibility labels, focus states, keyboard navigation, dynamic type behavior, and 44px minimum targets.
- [ ] Add route definitions and deep-link tests for every screen/detail flow.
- [ ] Add visual-regression fixtures with representative data.

## Screen task lists

### Authentication

- [ ] Replace the oversized marketing-like login composition with a restrained secure-access screen.
- [ ] Clarify server identity and connection state.
- [ ] Add password-manager/autofill semantics and native submit behavior.
- [ ] Show actionable authentication/network errors.
- [ ] Consider biometric unlock after the native build is stable.

### Chat list

- [ ] Add search and useful last-message previews.
- [ ] Use channel icons and human channel labels rather than raw IDs as primary information.
- [ ] Tighten desktop master-list density and preserve the 340px column.
- [ ] Add loading skeletons, empty state, pagination, and pull-to-refresh.
- [ ] Define unread/running indicators without noisy badges.
- [ ] Verify internal and voice-session visibility only after a separate product decision.

### Chat conversation

- [ ] Refine message typography, markdown, links, code, attachments, and long content.
- [ ] Group consecutive messages and add restrained timestamps/day separators.
- [ ] Preserve distinct user, assistant, thought, tool-call, and tool-response treatments.
- [ ] Make thought/tool rows compact, expandable, and selectable.
- [ ] Make the three-dot filter menu native-feeling and persistent.
- [ ] Add older-message loading without scroll jumps.
- [ ] Improve desktop composer width and attachment workflow.
- [ ] Test keyboard avoidance, selection, copying, and long messages on iPhone.

### Voice

- [ ] Do not redesign workflow until the voice product model is agreed with Mike.
- [ ] Decide whether the primary model is always-new sessions, resumable context, or transcript continuation.
- [ ] Decide where voice history belongs and whether it participates in unified conversations.
- [ ] Define states: ready, connecting, listening, thinking, speaking, muted, investigating, completed task, reconnecting, failed, and ended.
- [ ] Replace the giant empty avatar composition with a purposeful live-call interface.
- [ ] Move voice choice into a compact sheet/settings flow instead of ten permanent pills.
- [ ] Design audio route, mute, end, transcript, task, and usage affordances.
- [ ] Preserve barge-in, VAD, routing, previews, and asynchronous Vito tasks.

### More

- [ ] Keep it mobile-only; desktop uses direct sidebar navigation.
- [ ] Replace the emoji card grid with grouped native list sections.
- [ ] Group areas: Intelligence, Automation, Infrastructure, and Vito.
- [ ] Use coherent icons, subtitles, and standard disclosure indicators.
- [ ] Add Settings/Sign out placement that matches platform conventions.

### Memory overview

- [ ] Keep the compact stats cards but reduce visual weight.
- [ ] Clarify what chunks, sessions, days, and date range mean.
- [ ] Render top/recent sessions as useful rows, not database metadata.
- [ ] Move Profile into a dedicated root-stack screen with readable markdown.
- [ ] Add loading, empty, and embedding-health states.

### Memory search/results

- [ ] Preserve root-stack results over tabs and deep-link query URLs.
- [ ] Preserve current date/session/context hierarchy and inline transcript expansion.
- [ ] Add retrieval-mode and optional session/date filters in a filter sheet.
- [ ] Add result count, duration, loading skeletons, no-results guidance, and retry.
- [ ] Use aliases from the backend and demote raw session IDs.
- [ ] Ensure huge transcripts expand without freezing or stealing scroll position.
- [ ] Preserve selectable/copyable context and transcript text.

### Skills

- [ ] Add search, category/source filters, and built-in/user badges.
- [ ] Show concise capability summaries and relevant metadata in rows.
- [ ] Push a deep-linkable skill detail screen.
- [ ] Render `SKILL.md` as formatted markdown.
- [ ] Add a file list and focused file viewer/editor where mutation is allowed.
- [ ] Distinguish read-only built-ins from editable user skills.

### Jobs

- [ ] Replace job JSON creation with fields for name, schedule, timezone, prompt, session, condition, enabled state, and one-time behavior.
- [ ] Add schedule presets plus human-readable next-run text.
- [ ] Show enabled/running/failed status and last/next execution in each row.
- [ ] Push a job detail/edit screen; preserve draft and validation state.
- [ ] Move Run now, enable/disable, duplicate, and delete into appropriate actions/menu.
- [ ] Add run feedback and recent execution history.

### Apps

- [ ] Replace tiny start/stop/restart/delete links with status-first rows and a detail action menu.
- [ ] Show process status, port/domain, uptime, and health.
- [ ] Push a deep-linkable app detail screen.
- [ ] Organize detail sections: Overview, Files, Process, Logs, Access, and Danger Zone.
- [ ] Show progress and verified outcomes for lifecycle operations.
- [ ] Require confirmation for deletion and explain persistence impact.

### Drive

- [ ] Replace free-text path navigation with breadcrumbs and standard folder navigation.
- [ ] Use file/folder icons, type, size, modified date, and visibility indicators.
- [ ] Use a desktop table/list and native mobile rows.
- [ ] Push folder/file detail or preview routes where appropriate.
- [ ] Move visibility/delete into row menus; keep opening as the primary interaction.
- [ ] Design Upload file and Upload site as a clear action sheet.
- [ ] Add upload progress, errors, empty folders, and pull-to-refresh.

### Traces

- [ ] Preserve the existing bounded list/detail architecture and structured event rendering.
- [ ] Add timestamp, session alias, event count, size, success state, and duration to rows.
- [ ] Add search/filter by session, date, status, and event type.
- [ ] Push detail on the root stack and deep-link by filename.
- [ ] Keep pagination/loading feedback and add jump-to-newest.
- [ ] Move delete into a menu with confirmation.

### Pi sessions

- [ ] Preserve bounded retrieval and structured role/event rendering.
- [ ] Add alias, model, last activity, message count, file size, and compaction state.
- [ ] Add search/filter and meaningful empty/loading states.
- [ ] Push detail on the root stack and deep-link by safe relative identifier.
- [ ] Move deletion into a menu and distinguish one-session from delete-all consequences.

### Settings

- [ ] Replace generic recursive object rendering with purpose-built settings sections.
- [ ] Use pickers/segmented controls for enums, switches for booleans, and validated inputs for scalar values.
- [ ] Separate Global, Channel, and Session scopes with explicit inheritance indicators.
- [ ] Show effective values versus overrides.
- [ ] Add sticky Save/Discard actions, dirty state, validation summaries, and success confirmation.
- [ ] Protect unknown/new config fields from accidental loss.
- [ ] Provide an advanced raw view only as a secondary escape hatch.

### Secrets

- [ ] Show configured/not-configured status without exposing values.
- [ ] Move add/edit secret into a dedicated secure form/sheet.
- [ ] Separate system-known keys from custom secrets.
- [ ] Explain which changes require reconnect/restart.
- [ ] Move delete into a menu and protect system keys.
- [ ] Improve keyboard/autofill behavior and clear secret inputs after mutation.

### System / SOUL

- [ ] Separate editable SOUL and read-only system instructions into tabs or distinct routes.
- [ ] Add a proper markdown editor with preview and readable typography.
- [ ] Add dirty state, Save/Discard, validation, and saved confirmation.
- [ ] Explain when `/new` is needed for changes to affect a conversation.
- [ ] Keep the project-owned system prompt visibly read-only.

### Server

- [ ] Replace raw key/value diagnostics with status, uptime, memory, version, active sessions, and service health cards.
- [ ] Humanize uptime and memory units.
- [ ] Make rebuild/restart a secondary danger-zone workflow, not the first focal element.
- [ ] Show confirmation, progress, build stages, outcome, and reconnect state.
- [ ] Add links to relevant logs/status without exposing secrets.

### Providers

- [ ] Show provider identity, authentication state, available models, and active/default usage.
- [ ] Never show Login and Logout as simultaneous equal actions.
- [ ] Push a provider detail/authentication flow.
- [ ] Design OAuth states: available, awaiting browser, awaiting code/prompt, authenticated, expired, failed.
- [ ] Add model browsing and optional connection verification.
- [ ] Use semantic status badges and keep destructive logout secondary.

## QA definition of done

Every redesigned screen must be tested with Playwright at:

- 1920px desktop
- 1440px desktop
- 390px mobile
- 320px narrow mobile

For each applicable state:

- Loading
- Populated
- Empty
- Error
- Detail/open
- Menu/sheet
- Destructive confirmation
- Dark mode
- Keyboard/focus

No screen is ready for Mike review while known high/medium visual issues remain. Capture, inspect, critique, fix, and repeat until the design-critic verdict is `pass`.
