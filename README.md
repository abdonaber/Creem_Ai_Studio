# Creem — Production-Ready Smart Ride-Hailing Platform
منصة **Creem** للنقل الذكي المتكاملة (Production-Ready Ride-Hailing Platform)

---

## نظرة عامة (Overview)

**Creem** هي منصة نقل ذكية متكاملة (Full-Stack Ride-Hailing Platform) تضم تطبيقات الركاب والكباتن ولوحة الإدارة، مع خرائط تفاعلية آمنة عبر Leaflet/OSM، وتتبع لحظي عبر Socket.IO + Redis Pub/Sub Adapter، ومحرك دفع متكامل عبر Stripe والمحفظة الرقمية، ودورة تسوية محاسبية مزدوجة القيد (Double-Entry Ledger) تدعم الاسترداد الكامل والجزئي المتعدد والمطابقة المالية (Reconciliation).

---

## البنية المعمارية (Architectural Topology)

1. **Runtime & Package Manager**: Bun (`bun.lock` صارم عبر `bun install --frozen-lockfile`).
2. **Frontend**: React 19, TypeScript, Tailwind CSS v4, Leaflet/OSM Maps, Socket.IO Client, Lucide Icons, دعم كامل للغة العربية RTL.
3. **Backend**: Express, Socket.IO Server (`@socket.io/redis-adapter`), TypeScript, esbuild production bundle (`dist/server.cjs`).
4. **Database Layer**: MongoDB Replica Set (Mongoose ODM) مع فهارس `2dsphere` و`Unique Indexes` ومعاملات مالية ذرية (Multi-Document ACID Transactions).
5. **Caching, Locks & Queues**: Redis (`ioredis`) للأقفال الموزعة (`acquireLock` / `releaseLock`) وقوائم انتظار BullMQ (`QueueManager`).
6. **Payment Engine**: Stripe SDK (PaymentIntents، التحقق الصارم من توقيع Webhooks، مفاتيح Idempotency) + محفظة رقمية ودفتر أستاذ عام بنظام عمولة المنصة الموحدة **20%** (`PLATFORM_COMMISSION_RATE=0.2`).
7. **Security & RBAC**:
   - تخزين Access Token في الذاكرة فقط (JWT قصير الأمد 15 دقيقة).
   - تدوير Refresh Tokens عبر كوكيز `HttpOnly; SameSite=Lax` مع فحص CSRF Origin، وكشف إعادة الاستخدام غير المشروع، ونافذة سماح آمنة للطلبات المتزامنة (5 ثوانٍ).
   - فحص حالة الحساب في قاعدة البيانات، وإبطال الجلسات عند تغيير كلمة المرور أو إيقاف الحساب من الإدارة.

---

## دورة حياة الرحلة (Ride State Machine)

تخضع كل رحلة لتحولات ذرية محمية:
- `REQUESTED` ➔ `SEARCHING_DRIVER` ➔ `DRIVER_ASSIGNED` ➔ `DRIVER_ARRIVING` ➔ `DRIVER_ARRIVED` ➔ `RIDE_STARTED` ➔ `RIDE_COMPLETED`
- الإلغاء مسموح قبل بدء الرحلة مع توثيق الطرف الملغي (`RIDER`, `DRIVER`, `ADMIN`, `SYSTEM`)، ورفض العروض عبر `POST /api/v1/rides/:id/decline`.

---

## النظام المالي والمحفظة والاستردادات (Payments, Ledger & Refunds)

- **المحفظة (Wallet)**: خصم ذري من الراكب وإضافة صافي **80%** للسائق مع قيد عمولة المنصة **20%** في دفتر الأستاذ.
- **البطاقات عبر Stripe**: معالجة `payment_intent.succeeded`، `payment_intent.payment_failed`، `payment_intent.canceled`، و`charge.refunded` / `refund.updated` / `refund.failed`.
- **ضوابط الاسترداد (Refund Safety)**:
  - عدم تسوية أي استرداد مالياً قبل تأكيد Stripe لحالة `succeeded`.
  - التحقق الصارم من الدقة العشرية (خانتان عشريتان كحد أقصى) ومنع الخلط بين `re_*` و`pi_*`.
  - دعم الاستردادات الجزئية المتعددة (Multi-item `refunds.data`)، وعكس الأرباح والعمولات وفق القيم الفعلية للمعاملة الأصلية.
  - مطابقة مالية شاملة عبر `/api/v1/admin/reconciliation`.

---

## متغيرات البيئة (Environment Variables)

راجع `.env.example`:

```env
APP_ENV=production
APP_MODE=production
NODE_ENV=production

PORT=3000
APP_URL=https://creem.app

MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/creem?retryWrites=true&w=majority
REDIS_URL=redis://localhost:6379

PLATFORM_COMMISSION_RATE=0.2

JWT_SECRET=your-32-character-ultra-secure-jwt-secret-key
JWT_REFRESH_SECRET=your-32-character-ultra-secure-refresh-key
COOKIE_SECRET=your-32-character-cookie-secret-key

STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

CORS_ALLOWED_ORIGINS=https://creem.app,https://admin.creem.app
```

---

## التثبيت والاختبارات والبناء (Bun Workflow)

```bash
# تثبيت الاعتماديات بشكل صارم وفق bun.lock
bun install --frozen-lockfile

# فحص الثغرات الأمنية
bun audit

# فحص TypeScript
bun run lint

# تشغيل جميع الاختبارات (Vitest)
bun run test

# تشغيل الاختبارات على مشغل Bun
bun test

# بناء نسخة الإنتاج وتشغيلها
bun run build
bun run start
```

---

## التشغيل عبر Docker

```bash
docker build -t creem-platform .
docker run -p 3000:3000 --env-file .env creem-platform
```
