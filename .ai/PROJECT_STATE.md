# CreemY Engineering State & Project Memory

## Project Overview
CreemY is a modern, high-grade full-stack Ride-Hailing platform inspired by modern ride platforms (Careem/Uber) but engineered with an independent, bespoke Arabic/English UI identity, strict domain models, production-grade security, real-time dispatch, and state-machine-driven lifecycle.

---

## Architecture Plan
1. **Modules**:
   - `auth`: JWT Access & Refresh Token rotation, bcrypt hashing, cookie handling, session management.
   - `users`: Profile management, role-based controls (Rider, Driver, Admin).
   - `drivers`: Onboarding, vehicle info, document verification, live online/offline toggle, GPS coordinates.
   - `rides`: State machine (`REQUESTED`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `RIDE_STARTED`, `RIDE_COMPLETED`, `CANCELLED`), fare calculation, ETA, distance computation.
   - `dispatch`: Geospatial proximity search, atomic driver matching, concurrency-safe assignment.
   - `payments`: Scalable PaymentProvider abstraction (Stripe + Sandbox/Test Provider with idempotency, signature validation, refund logic).
   - `wallet`: Digital wallet balance, credit/debit transactions, immutable audit trail.
   - `chat`: Real-time ride-scoped encrypted messaging between rider and driver.
   - `notifications`: Multi-channel in-app notifications with read status.
   - `admin`: Super-admin dashboard with live active rides, driver approvals, revenue analytics, audit logs.
   - `maps`: Leaflet & OpenStreetMap interactive tiles, driver movement simulation, route polyline, distance/duration engine.

2. **Storage Layer**:
   - MongoDB + Mongoose Schemas (User, Driver, Vehicle, Ride, Payment, Wallet, WalletTransaction, Rating, Message, Notification, RefreshToken, AuditLog).
   - Resilient database adapter: Auto-connects to MongoDB Atlas when `MONGODB_URI` is provided; maintains state-synchronized robust in-memory collection engine when running in standalone container sandbox mode.

3. **Real-Time Layer**:
   - Socket.IO on unified Express server with authenticated handshake (JWT verification), authorized rooms (`user:<id>`, `ride:<id>`, `role:drivers`, `role:admins`), rate-limiting, and event validation.

---

## Status Breakdown
- **Phase A (Discover & Environment)**: [COMPLETED] Dependencies installed, ports verified, scripts configured.
- **Phase B (Architecture & DB Models)**: [IN PROGRESS] Creating Mongoose models & DB persistence engine.
- **Phase C (Core Backend & Security API)**: [PENDING]
- **Phase D (Real-Time Socket.IO Server & Dispatch)**: [PENDING]
- **Phase E (Frontend Architecture & Design System)**: [PENDING]
- **Phase F (Testing & Quality Gates)**: [PENDING]
- **Phase G (Docker & CI/CD & Docs)**: [PENDING]

## Security Audits & Guards
- Authentication: Short-lived access tokens + Refresh token rotation + HTTPOnly cookies.
- IDOR / BOLA Prevention: Explicit ownership checks on all ride, message, wallet, and profile endpoints.
- Atomic state machine transitions with conditional locks.
- Centralized error handling without leaking stack traces or internal secrets.
