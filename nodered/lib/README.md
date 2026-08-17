# Backend modules

`aqua-services.js` is the stable facade used by Node-RED. The implementation is
split by responsibility so each file stays small and can be tested separately.

| Module | Responsibility |
| --- | --- |
| `shared.js` | Constants, configuration, validation and small pure helpers |
| `store.js` | Local JSON store and account/device access rules |
| `firebase.js` | Firebase Admin initialization and Firestore writes |
| `auth.js` | Local/Firebase authentication and sessions |
| `devices.js` | Device discovery, ownership and claiming |
| `telemetry.js` | Sensor normalization, persistence and alert evaluation |
| `dashboard.js` | Dashboard, history, settings and profile queries |
| `telegram.js` | Telegram linking, polling and notifications |
| `chatbot.js` | OpenAI/local assistant responses and chat quota |
| `actions.js` | Small HTTP action handlers and command routing |
| `public-status.js` | Public feature/configuration status |
| `context.js` | Dependency assembly shared by all services |

Run `npm run check` for syntax/flow validation and `npm test` for the backend
contract tests.
