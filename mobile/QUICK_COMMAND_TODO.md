# Quick Command implementation

- [x] Add Home as the initial tab and create the Quick Command dashboard UI.
- [x] Persist the launch-recording toggle locally per device.
- [x] Record continuously to an app-private file until Stop or app backgrounding.
- [x] Persist a durable local outbox before attempting upload; retry pending entries on launch/foreground.
- [x] Reject trivially short recordings locally and reject empty transcriptions server-side.
- [x] Add validated quick-command request/status/device-registration schemas.
- [x] Add a focused backend service and SQLite store for command lifecycle and push registrations.
- [x] Add authenticated dashboard routes through RouterService/createRoute patterns.
- [x] Transcribe received audio server-side, then submit through AskApiService in a dedicated session.
- [x] Register Expo/APNs push tokens and send a result notification with a Chat deep link.
- [x] Preserve the response in message/session history even if push delivery fails.
- [ ] Add route/service tests for auth, validation, empty transcription, and duplicate submissions.
- [x] Add store tests for lifecycle persistence and push-registration idempotency.
- [x] Configure Expo notifications/native permissions and run backend/mobile checks.
- [ ] Perform a real-device end-to-end test after rebuilding backend and the iOS development client.
