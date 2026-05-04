# Изменения в tezyubor_backend и tezyubor_frontend

Этот документ описывает все изменения, которые нужно внести в **существующий** Node.js бэкенд
(`tezyubor_backend`) и фронтенд (`tezyubor_frontend`) для поддержки нового Partner API.

---

## 1. Изменения в базе данных (Prisma Schema)

Файл: `prisma/schema.prisma`

### 1.1 Новые модели — добавить в конец файла

```prisma
enum PartnerType {
  MARKETPLACE
  POST_SYSTEM
}

model Partner {
  id          String      @id @default(cuid())
  name        String
  type        PartnerType
  apiToken    String      @unique
  phone       String?
  address     String?
  lat         Float?
  lng         Float?
  balance     Float       @default(0)
  isActive    Boolean     @default(true)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  courierMarkups PartnerCourierMarkup[]
  shops          PartnerShop[]
  orders         Order[]                @relation("PartnerOrders")
}

model PartnerCourierMarkup {
  id            String      @id @default(cuid())
  partnerId     String
  partner       Partner     @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  courierType   CourierType
  markupPercent Float       @default(0)
  isEnabled     Boolean     @default(true)

  @@unique([partnerId, courierType])
}

model PartnerShop {
  id             String   @id @default(cuid())
  partnerId      String
  partner        Partner  @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  externalShopId String?
  name           String
  phone          String?
  address        String?
  lat            Float?
  lng            Float?
  balance        Float    @default(0)
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  orders         Order[]  @relation("PartnerShopOrders")

  @@unique([partnerId, externalShopId])
}
```

### 1.2 Изменения в существующей модели Order

Найти модель `Order` и добавить следующие поля (после поля `pharmacyId`):

```prisma
model Order {
  id              String      @id @default(cuid())
  token           String      @unique
  pharmacyId      String?                          // ИЗМЕНИТЬ: убрать обязательность (добавить ?)
  pharmacy        Pharmacy?   @relation(...)       // ИЗМЕНИТЬ: сделать опциональным

  // --- НОВЫЕ ПОЛЯ (добавить после pharmacyId) ---
  partnerId       String?
  partner         Partner?    @relation("PartnerOrders", fields: [partnerId], references: [id])
  partnerShopId   String?
  partnerShop     PartnerShop? @relation("PartnerShopOrders", fields: [partnerShopId], references: [id])
  actualDeliveryPrice  Float?   // реальная цена от курьера (без наценки)
  markupAmount         Float?   // сумма нашей наценки

  // ... остальные существующие поля без изменений
}
```

> **Важно**: поле `pharmacyId` становится nullable (`String?`). Это нужно, потому что
> заказы от партнёров не привязаны к аптеке. Существующие заказы не затрагиваются.

После изменений выполнить:
```bash
npx prisma migrate dev --name add_partner_tables
```

---

## 2. Новые API маршруты в tezyubor_backend (Node.js)

### 2.1 Создать файл `src/routes/adminPartners.js`

Этот файл реализует полный CRUD для управления партнёрами через Admin панель.

```javascript
const express = require('express')
const crypto = require('crypto')
const prisma = require('../config/db')
const { auth, requireRole, superAdminOnly } = require('../middleware/auth')

const router = express.Router()
router.use(auth)
router.use(requireRole('admin'))

// Генерация безопасного API токена
function generateApiToken() {
  return 'sk_' + crypto.randomBytes(32).toString('hex')
}

// GET /api/admin/partners — список всех партнёров
router.get('/', async (req, res, next) => {
  try {
    const { type, search, isActive } = req.query
    const where = {}
    if (type) where.type = type
    if (isActive === 'true') where.isActive = true
    if (isActive === 'false') where.isActive = false
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { phone: { contains: search.trim() } },
      ]
    }
    const partners = await prisma.partner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        courierMarkups: true,
        _count: { select: { shops: true, orders: true } },
      },
    })
    res.json({ success: true, data: { partners } })
  } catch (err) { next(err) }
})

// GET /api/admin/partners/:id — один партнёр
router.get('/:id', async (req, res, next) => {
  try {
    const partner = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: {
        courierMarkups: true,
        shops: { orderBy: { createdAt: 'desc' } },
        _count: { select: { orders: true } },
      },
    })
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// POST /api/admin/partners — создание партнёра
router.post('/', async (req, res, next) => {
  try {
    const { name, type, phone, address, lat, lng } = req.body
    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'name and type required' })
    }
    if (!['MARKETPLACE', 'POST_SYSTEM'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be MARKETPLACE or POST_SYSTEM' })
    }
    const apiToken = generateApiToken()
    const partner = await prisma.partner.create({
      data: {
        name,
        type,
        apiToken,
        phone: phone || null,
        address: address || null,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        // Создаём дефолтные настройки наценки для всех курьеров (0%)
        courierMarkups: {
          create: [
            { courierType: 'noor',       markupPercent: 0, isEnabled: true },
            { courierType: 'millennium', markupPercent: 0, isEnabled: true },
            { courierType: 'mytaxi',     markupPercent: 0, isEnabled: true },
            { courierType: 'yandex',     markupPercent: 0, isEnabled: false },
          ],
        },
      },
      include: { courierMarkups: true },
    })
    res.status(201).json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id — обновление партнёра
router.put('/:id', async (req, res, next) => {
  try {
    const { name, phone, address, lat, lng, isActive } = req.body
    const data = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone || null
    if (address !== undefined) data.address = address || null
    if (lat !== undefined) data.lat = lat ? Number(lat) : null
    if (lng !== undefined) data.lng = lng ? Number(lng) : null
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data,
      include: { courierMarkups: true },
    })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// POST /api/admin/partners/:id/regenerate-token — перегенерация токена
router.post('/:id/regenerate-token', superAdminOnly, async (req, res, next) => {
  try {
    const apiToken = generateApiToken()
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data: { apiToken },
      select: { id: true, name: true, apiToken: true },
    })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/courier-markups — обновление наценок курьеров
router.put('/:id/courier-markups', async (req, res, next) => {
  try {
    // req.body.markups = [{ courierType, markupPercent, isEnabled }, ...]
    const { markups } = req.body
    if (!Array.isArray(markups)) {
      return res.status(400).json({ success: false, message: 'markups array required' })
    }
    const updates = await Promise.all(
      markups.map(m =>
        prisma.partnerCourierMarkup.upsert({
          where: { partnerId_courierType: { partnerId: req.params.id, courierType: m.courierType } },
          create: { partnerId: req.params.id, courierType: m.courierType, markupPercent: Number(m.markupPercent) || 0, isEnabled: Boolean(m.isEnabled) },
          update: { markupPercent: Number(m.markupPercent) || 0, isEnabled: Boolean(m.isEnabled) },
        })
      )
    )
    res.json({ success: true, data: { markups: updates } })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/balance — установить баланс (только superadmin)
router.put('/:id/balance', superAdminOnly, async (req, res, next) => {
  try {
    const { balance, operation } = req.body
    // operation: 'set' | 'increment' | 'decrement'
    const value = Number(balance)
    if (isNaN(value) || value < 0) {
      return res.status(400).json({ success: false, message: 'balance must be non-negative number' })
    }
    const data = {}
    if (operation === 'increment') data.balance = { increment: value }
    else if (operation === 'decrement') data.balance = { decrement: value }
    else data.balance = value
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, balance: true },
    })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// DELETE /api/admin/partners/:id — удаление партнёра (superadmin)
router.delete('/:id', superAdminOnly, async (req, res, next) => {
  try {
    await prisma.partner.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// ─── Shops (только для POST_SYSTEM) ──────────────────────────────────────────

// GET /api/admin/partners/:id/shops
router.get('/:id/shops', async (req, res, next) => {
  try {
    const shops = await prisma.partnerShop.findMany({
      where: { partnerId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: { shops } })
  } catch (err) { next(err) }
})

// POST /api/admin/partners/:id/shops
router.post('/:id/shops', async (req, res, next) => {
  try {
    const { name, phone, address, lat, lng, externalShopId } = req.body
    if (!name) return res.status(400).json({ success: false, message: 'name required' })
    const shop = await prisma.partnerShop.create({
      data: {
        partnerId: req.params.id,
        name,
        phone: phone || null,
        address: address || null,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        externalShopId: externalShopId || null,
      },
    })
    res.status(201).json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/shops/:shopId
router.put('/:id/shops/:shopId', async (req, res, next) => {
  try {
    const { name, phone, address, lat, lng, isActive } = req.body
    const data = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone || null
    if (address !== undefined) data.address = address || null
    if (lat !== undefined) data.lat = lat ? Number(lat) : null
    if (lng !== undefined) data.lng = lng ? Number(lng) : null
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    const shop = await prisma.partnerShop.update({
      where: { id: req.params.shopId },
      data,
    })
    res.json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/shops/:shopId/balance
router.put('/:id/shops/:shopId/balance', superAdminOnly, async (req, res, next) => {
  try {
    const { balance, operation } = req.body
    const value = Number(balance)
    if (isNaN(value) || value < 0) {
      return res.status(400).json({ success: false, message: 'balance must be non-negative number' })
    }
    const data = {}
    if (operation === 'increment') data.balance = { increment: value }
    else if (operation === 'decrement') data.balance = { decrement: value }
    else data.balance = value
    const shop = await prisma.partnerShop.update({
      where: { id: req.params.shopId },
      data,
      select: { id: true, name: true, balance: true },
    })
    res.json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// DELETE /api/admin/partners/:id/shops/:shopId
router.delete('/:id/shops/:shopId', superAdminOnly, async (req, res, next) => {
  try {
    await prisma.partnerShop.delete({ where: { id: req.params.shopId } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

module.exports = router
```

### 2.2 Подключить маршрут в `server.js`

Добавить в `server.js` после существующих admin маршрутов:

```javascript
const adminPartnersRoutes = require('./src/routes/adminPartners')
// ...
app.use('/api/admin/partners', adminPartnersRoutes)
```

---

## 3. Изменения во фронтенде (tezyubor_frontend)

> Предполагается React + существующая структура Admin панели.

### 3.1 Новые страницы (добавить в роутер)

```
/admin/partners                  — список партнёров
/admin/partners/new              — создание партнёра
/admin/partners/:id              — просмотр/редактирование партнёра
/admin/partners/:id/shops        — магазины POST_SYSTEM партнёра
/admin/partners/:id/shops/new    — добавление магазина
```

### 3.2 Страница списка партнёров `/admin/partners`

Компоненты и функциональность:
- Таблица с колонками: Имя, Тип (MARKETPLACE/POST_SYSTEM), Баланс, Кол-во заказов, Статус, Дата создания, Действия
- Фильтры: по типу, статусу, поиск по имени
- Кнопка "Создать партнёра"
- Badge с типом: MARKETPLACE (синий), POST_SYSTEM (фиолетовый)

### 3.3 Страница создания/редактирования партнёра

Форма:
```
Имя партнёра *
Тип * [MARKETPLACE | POST_SYSTEM] — radio или select
Телефон
Адрес (точка отправления по умолчанию)
Координаты: Широта / Долгота (с кнопкой "Открыть на карте")
Статус: Активен / Неактивен
```

После успешного создания:
- Показать модальное окно с токеном (один раз!)
- Текст: "Сохраните токен — он показывается только один раз"
- Кнопка "Скопировать токен"
- Кнопка "Закрыть"

### 3.4 Вкладки на странице партнёра

На странице `/admin/partners/:id` добавить вкладки:
1. **Основные данные** — форма редактирования
2. **API Токен** — показывает маскированный токен (`sk_****...****`), кнопка "Перегенерировать"
3. **Настройки курьеров** — таблица наценок (см. ниже)
4. **Баланс** — текущий баланс, история пополнений, форма пополнения (только superadmin)
5. **Магазины** — только для POST_SYSTEM, список субмагазинов
6. **Заказы** — список заказов этого партнёра

### 3.5 Вкладка "Настройки курьеров" (Наценка)

Таблица с настройками наценки для каждого курьера:

```
Курьер         | Включён | Наценка (%)  | Пример цены
Noor           |  ✅     | [10]%        | 22 000 → 24 000 сум
Millennium     |  ✅     | [15]%        | 22 000 → 25 500 сум (=25 500)
MyTaxi         |  ✅     | [8]%         | 22 000 → 24 000 сум (=23 760→24 000)
Yandex         |  ☐     | [0]%         | (не подключён)
```

- Live preview: пока вводишь %, показывает пример расчёта
- Правило округления: стандартное до ближайших 500 сум
- Формула preview: `Math.round((basePrice * (1 + percent/100)) / 500) * 500`
- Кнопка "Сохранить настройки курьеров"
- Минимальное значение наценки: 0% (отрицательные не разрешены)

### 3.6 Вкладка "Магазины" (только POST_SYSTEM)

Таблица:
- Имя магазина, Телефон, Адрес, Баланс, External ID, Статус, Действия
- Кнопка "Добавить магазин"
- Для каждого магазина: кнопка "Пополнить баланс" (только superadmin)

Форма добавления магазина:
```
Имя *
Телефон
Адрес
Широта / Долгота
External Shop ID (ID в системе ESPOS/другой POS)
Начальный баланс
```

### 3.7 Добавить пункт "Партнёры" в сайдбар Admin панели

```javascript
// В компоненте Sidebar добавить:
{
  label: 'Партнёры',
  icon: <PlugIcon />,
  path: '/admin/partners',
  permission: 'partners:view',  // или доступно всем adminUser
}
```

### 3.8 Новые permissions (роли)

Добавить в систему ролей следующие permissions:
```
partners:view
partners:create
partners:edit
partners:delete
partners:balance
```

---

## 4. Краткое резюме миграции БД

```sql
-- Prisma создаст эти таблицы автоматически через migrate:
-- partner
-- partner_courier_markup
-- partner_shop

-- В таблице orders:
-- ALTER TABLE orders ALTER COLUMN pharmacy_id DROP NOT NULL;
-- ALTER TABLE orders ADD COLUMN partner_id TEXT REFERENCES partner(id);
-- ALTER TABLE orders ADD COLUMN partner_shop_id TEXT REFERENCES partner_shop(id);
-- ALTER TABLE orders ADD COLUMN actual_delivery_price DOUBLE PRECISION;
-- ALTER TABLE orders ADD COLUMN markup_amount DOUBLE PRECISION;
```

---

## 5. Checklist изменений

### tezyubor_backend
- [ ] Обновить `prisma/schema.prisma` — добавить 3 новые модели + изменить Order
- [ ] Выполнить `npx prisma migrate dev`
- [ ] Создать `src/routes/adminPartners.js`
- [ ] Подключить маршрут в `server.js`
- [ ] Добавить `partners:*` permissions в систему ролей

### tezyubor_frontend
- [ ] Добавить "Партнёры" в сайдбар
- [ ] Создать страницу списка партнёров
- [ ] Создать страницу создания/редактирования партнёра
- [ ] Реализовать модальное окно показа токена (один раз)
- [ ] Реализовать вкладку "Настройки курьеров" с live preview
- [ ] Реализовать управление балансом (superadmin)
- [ ] Реализовать управление магазинами (POST_SYSTEM)
