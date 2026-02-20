# HTTP Server Support

Overseer can run an HTTP server to provide remote access to the application through a web browser. This is useful for accessing Overseer from mobile devices or other machines on the same network (e.g., via Tailscale).

## Features

### Starting the Server

The HTTP server can be started from Settings:
1. Open Settings (gear icon or Cmd+,)
2. Scroll to "HTTP Server" section
3. Enter a port number (default: 3210)
4. Optionally enable "Require authentication"
5. Click "Start Server"

### Authentication

When authentication is enabled:
- A random bearer token is generated on server start
- The token is displayed in Settings with a copy button
- All API and WebSocket requests must include the token

Token can be provided via:
- `Authorization: Bearer <token>` header
- `?token=<token>` query parameter

### Architecture

The HTTP server (`src-tauri/src/http_server/`) uses:
- **Axum** for HTTP routing
- **tower-http** for CORS support
- **WebSocket** for real-time agent communication

Key components:
- `mod.rs` - Server setup, routes, WebSocket handling
- `state.rs` - Shared state (event sender, auth token)
- `auth.rs` - Authentication middleware

### Frontend Integration

The `HttpBackend` (`src/renderer/backend/http.ts`) connects to the HTTP server:
- Loads auth token from URL params or localStorage
- Sends bearer token with all API requests
- Appends token to WebSocket URL as query param

### crypto.randomUUID Polyfill

When running over plain HTTP (not HTTPS), `crypto.randomUUID()` is not available. A polyfill is added in `src/renderer/main.tsx` to ensure ID generation works in all contexts.

## API Endpoints

### REST Endpoints

- `POST /api/invoke/:command` - Invoke Tauri commands
- `GET /api/health` - Health check

### WebSocket

- `GET /ws` - WebSocket connection for real-time events

## Security Considerations

- Authentication token is randomly generated per server start
- Token is not persisted (new token on each start)
- CORS allows all origins (intended for local network use)
- For public networks, use Tailscale or similar VPN

## Implementation Files

- `src-tauri/src/http_server/mod.rs` - Server implementation
- `src-tauri/src/http_server/state.rs` - Shared state
- `src-tauri/src/http_server/auth.rs` - Auth middleware
- `src-tauri/src/lib.rs` - Server startup command
- `src/renderer/backend/http.ts` - HTTP backend
- `src/renderer/components/shared/SettingsDialog.tsx` - Server UI
- `src/renderer/main.tsx` - crypto.randomUUID polyfill
