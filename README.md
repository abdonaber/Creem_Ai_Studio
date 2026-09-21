# CreemY — Production-Ready Smart Ride-Hailing Platform
منصة نقل ذكية متكاملة ومستقلة (إنتاجية بالكامل)

---

## 🌟 نظرة عامة (Overview)

**CreemY** هي منصة نقل ذكية كاملة (Full-Stack Ride-Hailing Platform) مبنية لتلائم متطلبات التشغيل الفعلي والإنتاجي (Production-Ready). تشتمل على واجهات ركاب، وسائقين، ولوحة إدارة متقدمة، مع دعم الخرائط التفاعلية وتتبع الرحلات اللحظي، وإدارة المحفظة والمدفوعات الإلكترونية عبر Stripe، ومحرك التوزيع الجغرافي الذكي المعتمد على أقفال التزامن لمنع سباقات الحجز (Race Conditions).

---

## 🏗️ البنية المعمارية (Architectural Topology)

1. **Frontend**: React 18+, TypeScript, Tailwind CSS, Leaflet/OSM Maps, Socket.IO Client, Lucide Icons, RTL support.
2. **Backend**: Node.js, Express, Socket.IO Server, TypeScript (`tsx` in dev, `esbuild` for production CJS bundle).
3. **Database Layer**: MongoDB (Mongoose ODM) مع بنية فهارس جغرافية 2dsphere وUnique Indexes.
4. **Caching & Concurrency Layer**: Redis (ioredis) لدعم Distributed Locks (`ride_accept:${rideId}`) وحسابات التزامن وإلغاء الازدواجية.
5. **Payment Engine**: Stripe SDK (PaymentIntents, Webhook Signature Verification, Idempotency Keys) + محفظة رقمية بنظام قيد الحركات ومحاسبة عمولة المنصة (Platform Commission).
6. **Security & RBAC**: JWT Access Tokens (15 min) + HttpOnly Refresh Tokens (7 days) مع Token Rotation وإبطال الجلسات عند التدوير غير المشروع، وحماية ضد IDOR/BOLA على مستوى جميع المسارات وغرف السوكت.

---

## 🔒 دورة حياة الرحلة وقواعد الحالات (State Machine)

تخضع كل رحلة لـ Finite State Machine صارم ومدعوم بعمليات ذرية (Atomic Transitions):
- `REQUESTED` ➔ `SEARCHING_DRIVER` ➔ `DRIVER_ASSIGNED` ➔ `DRIVER_ARRIVING` ➔ `DRIVER_ARRIVED` ➔ `RIDE_STARTED` ➔ `RIDE_COMPLETED`
- الإلغاء مسموح من الحالات المؤهلة (`REQUESTED`, `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`) مع تسجيل سبب الإلغاء والطرف الملغي.
- لا يمكن قبول الرحلة إلا لسائق واحد فقط بواسطة قفل موزع (`atomicAcceptRide` + Redis Lock).

---

## 💳 النظام المالي والمحفظة (Wallet & Payments)

- **الدفع بالمحفظة (Wallet)**: خصم ذري مع التحقق الصارم من الرصيد الكافي، وإضافة الأرباح للسائق بعد اقتطاع نسبة عمولة المنصة (15%).
- **الدفع بالبطاقة عبر Stripe**: إنشاء `PaymentIntent` مع دعم تأكيد الدفع ومعالجة الـ Webhooks مع التحقق من التوقيع الرقمي (`stripe-signature`).
- **الدفع النقدي (Cash)**: توثيق عمولة المنصة في ذمة السائق وموازنة الحسابات بعد اكتمال الرحلة.
- **مقاومة التكرار (Idempotency)**: منع عمليات الخصم أو الشحن المكررة باستخدام `idempotencyKey` ومؤشرات الفهرسة الفريدة.

---

## ⚙️ متغيرات البيئة (Environment Variables)

راجع ملف `.env.example` لضبط المتغيرات المطلوبة:

```env
# بيئة التشغيل
APP_ENV=production
APP_MODE=production
NODE_ENV=production

# خادم المنصة
PORT=3000
APP_URL=http://localhost:3000

# قواعد البيانات والتخزين المؤقت
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/creemy?retryWrites=true&w=majority
REDIS_URL=redis://localhost:6379

# مفاتيح التشفير والأمان (32 خانة على الأقل في الإنتاج)
JWT_SECRET=your-32-character-ultra-secure-jwt-secret-key
JWT_REFRESH_SECRET=your-32-character-ultra-secure-refresh-key
COOKIE_SECRET=your-32-character-cookie-secret-key

# بوابات الدفع (Stripe)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# الأصول المسموحة في CORS
CORS_ALLOWED_ORIGINS=https://creemy.app,https://admin.creemy.app
```

---

## 🧪 تشغيل الاختبارات والتحقق (Tests & Quality Checks)

```bash
# تشغيل فحص الأنماط والأنواع (Linting & Type Safety)
npm run lint

# تشغيل حزمة الاختبارات الشاملة (Vitest)
npx vitest run

# بناء المشروع الإنتاجي (Production Build)
npm run build
```

---

## 🚀 الحسابات التجريبية الافتراضية (Seeded Accounts for Testing)

| الدور (Role) | البريد الإلكتروني | كلمة المرور |
| :--- | :--- | :--- |
| **Admin** | `admin@creemy.app` | `CreemY@2026` |
| **Rider** | `rider@creemy.app` | `CreemY@2026` |
| **Driver** | `driver@creemy.app` | `CreemY@2026` |
