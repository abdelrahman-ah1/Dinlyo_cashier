# POS + KDS — Phase 1 & 2 Build

Working implementation of the Core POS (Phase 1) and KDS + Real-Time Sync Engine
(Phase 2) from your roadmap. Hardware bridging (Phase 3) and ingredient-level
inventory (Phase 4) are intentionally not built yet — see "What's next" below.

## Architecture decision made here

Your two source documents proposed different sync topologies. This build uses
the **Branch Edge Server** model (Master Plan), because it's the only one of
the two that:
- keeps the cashier and kitchen talking to each other over the LAN even if
  the internet is down, and
- has a real path to raw-socket hardware access (ESC/POS printers, card
  terminals) in Phase 3, which browser-only WebRTC sync doesn't.

The "edge server" here is `backend/` — a small Node service with a REST API
and a WebSocket hub. In production it runs on a Mini-PC inside each branch;
for this build you can run it anywhere on your network (or just localhost)
and it behaves the same way.

## Database Engine: MongoDB

The backend utilizes **MongoDB** as its primary document store, featuring:
- **Embedded Document Architecture**: Line items (`items: [...]`) are embedded directly into `orders` documents, enabling single-document atomic updates for kitchen status bumps (`placed → in_prep → ready → served`).
- **Flexible Connection**: Configured via `MONGODB_URI` environment variable (e.g. `mongodb://localhost:27017/pos_kds_db` or MongoDB Atlas).
- **Zero-Setup Developer Fallback**: Automatically provides an embedded in-memory MongoDB-compatible document engine if a standalone MongoDB daemon is not running locally.

## Project layout

```
backend/    Edge server — REST API + WebSocket hub + MongoDB (document collections:
            tenants, branches, tables, menu_items, orders, payments, inventory_items,
            recipe_items, users, audit_logs, outbox_events) + Hardware TCP Bridge (9100)
frontend/   Single React app with shared responsive views:
            - Cashier (POS)       — menu, cart, table selector, QR generator, payment settlement
            - Kitchen (KDS)       — live ticket board, per-item status control, audio arrival chime
            - Inventory & Recipes — real-time stock levels, low-stock alerts, recipe explorer
            - EOD Report          — End-of-day financial reconciliation & theoretical depletion
            - Audit Log (RBAC)    — role-scoped operator activity trail
            - QR Self-Order       — customer mobile ordering for dine-in tables
```

## Run it

**Terminal 1 — edge server**
```bash
cd backend
npm install
npm start
```
Runs on `http://localhost:4000`. First run seeds demo tenant, branch, 6 tables, 10-item menu, staff accounts, raw ingredients, and recipes.

**Terminal 2 — frontend**
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. Use the **Staff User Badge** (top right) to switch roles (*Manager PIN `1234`*, *Shift Manager PIN `5678`*, *Cashier PIN `0000`*).

---

## What's Implemented (Full SRS v1.0 Scope)

### Phase 1: Core Multi-Tenant POS & Table Management
- Multi-tenant data model (`tenants` → `branches` → `tables` / `menu_items` / `orders` / `payments`).
- REST API for menu, tables, orders, items, and status progression.
- Table floorplan tracking (`available`, `occupied`, `dirty`).

### Phase 2: Kitchen Display System (KDS) & Real-Time Sync Engine
- Local WebSocket hub delivering order updates in **<1 second** with zero polling over branch LAN.
- Order lifecycle: `placed → in_prep → ready → served` with auto-closing when all lines are served.
- **KDS Audio Arrival Alert (FR-3.6)**: Synthesized Web Audio API order arrival chime.
- **WebSocket State Resync Hardening (FR-4.3)**: Automatic active order reconciliation upon reconnection.
- **Offline Outbox & Replay Queue (FR-4.4)**: Buffers writes during WAN outages and automatically reconciles to cloud on reconnection.

### Phase 3: Hardware Integration (FR-5.1 – FR-5.5)
- **ESC/POS Generator & Network TCP Port 9100 Bridge**: Formats and streams raw ESC/POS binary to thermal receipt printers.
- **Automated Kitchen Ticket Printing (FR-5.1)**: Dispatched immediately on order placement.
- **Customer Tax Receipt Printing (FR-5.2)**: Dispatched on payment completion with itemization and VAT.
- **Cash Drawer Solenoid Kick (FR-5.3)**: Automated pulse command (`ESC p 0 25 250`) on cash payments.
- **Payment Idempotency (NFR-8)**: Client-generated `idempotency_key` preventing duplicate charges.
- **Interactive Hardware Spooler Modal**: View live formatted thermal receipt previews and trigger manual kicks/test prints.

### Phase 4: Inventory, Recipes, EOD & Add-ons (FR-6.1 – FR-6.5)
- **Recipe Management (FR-6.1)**: Maps menu items to raw ingredient quantities.
- **Stock Auto-Deduction (FR-6.2)**: Automatically depletes ingredient quantities when orders are placed.
- **Low-Stock Alerts (FR-6.3)**: Real-time visual warnings and WebSocket broadcast alerts when stock drops below threshold.
- **End-of-Day (EOD) Reconciliation Report (FR-6.4)**: Daily audit report detailing gross/net revenue, VAT, cash vs card tender split, voids, and theoretical ingredient depletion.
- **QR-Code Table Self-Ordering (FR-6.5)**: Dedicated mobile guest ordering view for dine-in tables (`/order/:branchId/:tableId`).



