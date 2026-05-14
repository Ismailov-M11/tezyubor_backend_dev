const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Tezyubor Backend API',
    version: '1.0.0',
    description: `
## Аутентификация

1. Выполните **POST /api/auth/admin/login** (или /pharmacy/login, /owner/login)
2. Скопируйте \`token\` из ответа
3. Нажмите **Authorize** (замок вверху) и введите токен

Все защищённые эндпоинты требуют:
\`\`\`
Authorization: Bearer <token>
\`\`\`

## Роли
| Токен | Доступ |
|-------|--------|
| Admin JWT | /api/admin/* |
| Pharmacy JWT | /api/pharmacy/* |
| Owner JWT | /api/owner/* |
| (публично) | /api/orders/:token/* |
    `.trim(),
  },
  servers: [{ url: 'https://api.tezyubor.uz', description: 'Production' }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      SuccessTrue: { type: 'object', properties: { success: { type: 'boolean', example: true } } },
      Error: {
        type: 'object',
        properties: { success: { type: 'boolean', example: false }, message: { type: 'string' } },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string' }, token: { type: 'string', example: 'ORD1234567' },
          status: { type: 'string', enum: ['pending', 'awaiting_confirmation', 'confirmed', 'courier_pickup', 'courier_picked', 'courier_delivery', 'delivered', 'cancelled'] },
          customerName: { type: 'string', nullable: true }, customerPhone: { type: 'string', nullable: true },
          customerAddress: { type: 'string', nullable: true },
          customerLat: { type: 'number', nullable: true }, customerLng: { type: 'number', nullable: true },
          selectedCourier: { type: 'string', nullable: true }, deliveryPrice: { type: 'number', nullable: true },
          medicinesTotal: { type: 'number' }, totalPrice: { type: 'number', nullable: true },
          trackingUrl: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Pharmacy: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, login: { type: 'string' },
          phone: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
          lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true },
          city: { type: 'string', nullable: true }, district: { type: 'string', nullable: true },
          isActive: { type: 'boolean' }, balance: { type: 'number' },
          noorPaymentType: { type: 'string', enum: ['CASH', 'BALANCE'] },
          subscriptionExpiry: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Partner: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' },
          type: { type: 'string', enum: ['MARKETPLACE', 'POST_SYSTEM'] },
          phone: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
          lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true },
          balance: { type: 'number' }, isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      PartnerShop: {
        type: 'object',
        properties: {
          id: { type: 'string' }, partnerId: { type: 'string' },
          pharmacyId: { type: 'string', nullable: true }, name: { type: 'string' },
          phone: { type: 'string', nullable: true }, address: { type: 'string', nullable: true },
          lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true },
          externalShopId: { type: 'string', nullable: true },
          balance: { type: 'number' }, isActive: { type: 'boolean' },
        },
      },
      Owner: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true }, login: { type: 'string' }, isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' },
          permissions: { type: 'array', items: { type: 'string' } },
          isActive: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' },
        },
      },
      OrderStatusLog: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          orderId: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'awaiting_confirmation', 'confirmed', 'courier_pickup', 'courier_picked', 'courier_delivery', 'delivered', 'cancelled'] },
          source: { type: 'string', enum: ['noor', 'millennium', 'mytaxi', 'yandex'], nullable: true },
          actor: { type: 'string', example: 'pharmacy', nullable: true, description: 'Кто совершил действие: pharmacy, customer, admin, noor, millennium, mytaxi, yandex' },
          actorName: { type: 'string', nullable: true, description: 'Название аптеки, имя клиента или ФИО курьера' },
          actorPhone: { type: 'string', nullable: true, description: 'Телефон курьера (только для courier_* статусов от Noor)' },
          rawStatus: { type: 'string', nullable: true, description: 'Оригинальный статус от курьерского сервиса (stage, state_id и т.д.)' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      OrderCheck: {
        type: 'object',
        properties: {
          token: { type: 'string', example: 'ORD1234567' },
          status: { type: 'string', enum: ['pending', 'awaiting_confirmation', 'confirmed', 'courier_pickup', 'courier_picked', 'courier_delivery', 'delivered', 'cancelled'] },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Аутентификация — вход, регистрация' },
    { name: 'Pharmacy', description: 'Аптека/бизнес — профиль, заказы, аналитика (pharmacy JWT)' },
    { name: 'Orders (Public)', description: 'Публичные эндпоинты для клиента — без авторизации' },
    { name: 'Admin — Me & Orders', description: 'Заказы через admin панель (admin JWT)' },
    { name: 'Admin — Pharmacies', description: 'Управление бизнесами (admin JWT)' },
    { name: 'Admin — Clients & Analytics', description: 'Клиенты, аналитика, активации (admin JWT)' },
    { name: 'Admin — Owners', description: 'Владельцы магазинов (admin JWT)' },
    { name: 'Admin — Partners', description: 'Партнёры — основные данные (admin JWT)' },
    { name: 'Admin — Partner Shops', description: 'Магазины и привязки аптек к партнёру (admin JWT)' },
    { name: 'Admin — Roles', description: 'Роли и права (superadmin only)' },
    { name: 'Admin — Users', description: 'Пользователи админ-панели (superadmin only)' },
    { name: 'Owner App', description: 'Кабинет владельца магазинов (owner JWT)' },
  ],
  paths: {

    // ══════════════════════════════════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════════════════════════════════

    '/api/auth/admin/login': {
      post: {
        tags: ['Auth'], summary: 'Вход для администратора', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', example: 'admin@tezyubor.uz' }, password: { type: 'string', example: 'password' } } } } },
        },
        responses: { 200: { description: 'JWT токен + данные пользователя' }, 401: { description: 'Неверные данные' } },
      },
    },

    '/api/auth/pharmacy/login': {
      post: {
        tags: ['Auth'], summary: 'Вход для аптеки или владельца (по login+password)', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string' }, password: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'JWT токен + данные аптеки/владельца' }, 401: { description: 'Неверные данные' } },
      },
    },

    '/api/auth/owner/login': {
      post: {
        tags: ['Auth'], summary: 'Вход для владельца', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string' }, password: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'JWT токен + данные владельца' }, 401: { description: 'Неверные данные' } },
      },
    },

    '/api/auth/signup': {
      post: {
        tags: ['Auth'], summary: 'Самостоятельная регистрация бизнеса (7 дней trial)', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, ownerName: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 8 } } } } },
        },
        responses: { 201: { description: 'Аккаунт создан, login = email' }, 409: { description: 'Email или телефон уже используется' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // PHARMACY
    // ══════════════════════════════════════════════════════════════════════

    '/api/pharmacy/me': {
      get: {
        tags: ['Pharmacy'], summary: 'Мой профиль',
        responses: { 200: { description: 'Данные аптеки' } },
      },
      put: {
        tags: ['Pharmacy'], summary: 'Обновить профиль (имя, телефон, адрес, пароль, noorPaymentType)',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, ownerName: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, district: { type: 'string' }, noorPaymentType: { type: 'string', enum: ['CASH', 'BALANCE'] }, currentPassword: { type: 'string' }, newPassword: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Обновлённый профиль' } },
      },
      delete: {
        tags: ['Pharmacy'], summary: 'Удалить собственный аккаунт',
        description: 'Необратимо удаляет профиль аптеки вместе со всеми заказами и платёжной историей.',
        responses: {
          200: { description: 'Аккаунт удалён', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, message: { type: 'string', example: 'Account deleted' } } } } } },
          401: { description: 'Не авторизован' },
        },
      },
    },

    '/api/pharmacy/location': {
      put: {
        tags: ['Pharmacy'], summary: 'Установить локацию бизнеса (lat, lng)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number', example: 41.299 }, lng: { type: 'number', example: 69.240 }, address: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Локация обновлена' } },
      },
    },

    '/api/pharmacy/subscription/pay': {
      post: {
        tags: ['Pharmacy'], summary: 'Создать счёт Multicard для оплаты подписки',
        responses: { 200: { description: 'checkout_url для оплаты' } },
      },
    },

    '/api/pharmacy/orders': {
      get: {
        tags: ['Pharmacy'], summary: 'Список заказов аптеки',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Поиск по токену, имени, телефону, адресу' },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Один или через запятую: pending,confirmed,...' },
          { name: 'courier', in: 'query', schema: { type: 'string' }, description: 'noor,millennium,mytaxi,yandex' },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Список заказов + total' } },
      },
      post: {
        tags: ['Pharmacy'], summary: 'Создать заказ (аптека создаёт → клиент получает SMS со ссылкой)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { pharmacyComment: { type: 'string' }, medicinesTotal: { type: 'number' }, customerPhone: { type: 'string', example: '+998901234567' }, customerName: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Заказ создан + orderUrl' } },
      },
    },

    '/api/pharmacy/orders/{token}/confirm': {
      put: {
        tags: ['Pharmacy'], summary: 'Подтвердить заказ — вызвать курьера',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string', example: 'ORD1234567' } }],
        responses: { 200: { description: 'Заказ подтверждён, курьер вызван' }, 400: { description: 'Ошибка курьера или баланса' } },
      },
    },

    '/api/pharmacy/orders/{token}/cancel': {
      put: {
        tags: ['Pharmacy'], summary: 'Отменить заказ (с возвратом баланса если BALANCE)',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Заказ отменён' } },
      },
    },

    '/api/pharmacy/analytics': {
      get: {
        tags: ['Pharmacy'], summary: 'Аналитика аптеки (заказы, суммы, по статусам/курьерам/дням)',
        responses: { 200: { description: 'Статистика за всё время + по дням за 30 дней' } },
      },
    },

    '/api/pharmacy/clients': {
      get: {
        tags: ['Pharmacy'], summary: 'Клиенты аптеки (сгруппированные по телефону)',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'minOrders', in: 'query', schema: { type: 'integer' }, description: 'Минимум заказов у клиента' },
        ],
        responses: { 200: { description: 'Список клиентов с адресами и кол-вом заказов' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ORDERS (PUBLIC — для клиента)
    // ══════════════════════════════════════════════════════════════════════

    '/api/orders/{token}/check': {
      get: {
        tags: ['Orders (Public)'],
        summary: 'Предварительная проверка статуса заказа (лёгкий polling)',
        description: 'Возвращает только token и status. Всегда доступен, в т.ч. для отменённых/доставленных заказов. Используется для периодического polling вместо полного GET.',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string', example: 'ORD1234567' } }],
        responses: {
          200: {
            description: 'Статус заказа',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, data: { $ref: '#/components/schemas/OrderCheck' } } } } },
          },
          404: { description: 'Заказ не найден' },
        },
      },
    },

    '/api/orders/{token}': {
      get: {
        tags: ['Orders (Public)'],
        summary: 'Получить полные данные заказа',
        description: '⚠️ Возвращает **403** если заказ уже отменён или доставлен. Для проверки статуса используйте `/check`.',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string', example: 'ORD1234567' } }],
        responses: {
          200: { description: 'Данные заказа + аптеки' },
          403: { description: 'Заказ закрыт (cancelled или delivered) — доступ запрещён' },
          404: { description: 'Не найден' },
        },
      },
    },

    '/api/orders/{token}/confirm': {
      put: {
        tags: ['Orders (Public)'], summary: 'Клиент заполняет свои данные (имя, телефон, адрес)', security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['customerName', 'customerPhone', 'customerAddress'], properties: { customerName: { type: 'string' }, customerPhone: { type: 'string' }, customerAddress: { type: 'string' }, customerLat: { type: 'number' }, customerLng: { type: 'number' }, apartment: { type: 'string' }, entrance: { type: 'string' }, floor: { type: 'string' }, intercom: { type: 'string' }, customerComment: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Данные сохранены' } },
      },
    },

    '/api/orders/{token}/courier': {
      put: {
        tags: ['Orders (Public)'], summary: 'Клиент выбирает курьера → статус awaiting_confirmation', security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['courier'], properties: { courier: { type: 'string', enum: ['noor', 'millennium', 'mytaxi', 'yandex'] }, deliveryPrice: { type: 'number' } } } } },
        },
        responses: { 200: { description: 'Статус изменён на awaiting_confirmation' } },
      },
    },

    '/api/orders/{token}/noor/evaluate': {
      post: {
        tags: ['Orders (Public)'], summary: 'Получить цену и доступность Noor (без вызова курьера)', security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ available, stage, price, error }' } },
      },
    },

    '/api/orders/{token}/millennium/evaluate': {
      post: {
        tags: ['Orders (Public)'], summary: 'Получить цену Millennium', security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ available, price }' } },
      },
    },

    '/api/orders/{token}/mytaxi/evaluate': {
      post: {
        tags: ['Orders (Public)'], summary: 'Получить цену и ETA MyTaxi', security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ available, price, eta, error }' } },
      },
    },

    '/api/orders/{token}/status-logs': {
      get: {
        tags: ['Orders (Public)'],
        summary: 'История статусов заказа',
        description: 'Возвращает все записи смены статуса в хронологическом порядке. Каждая запись содержит кто совершил действие (`actor`, `actorName`) и, для курьерских статусов, ФИО и телефон курьера (`actorName`, `actorPhone`).',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Массив логов',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { logs: { type: 'array', items: { $ref: '#/components/schemas/OrderStatusLog' } } } } } } } },
          },
        },
      },
    },

    '/api/orders/{token}/saved-addresses': {
      get: {
        tags: ['Orders (Public)'],
        summary: 'Сохранённые адреса клиента для данной аптеки',
        description: '⚠️ Доступен **только** пока заказ в статусе `pending`. Возвращает **403** для всех остальных статусов.',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Массив адресов с деталями квартиры' },
          403: { description: 'Заказ не в статусе pending' },
        },
      },
    },

    '/api/orders/{token}/status': {
      put: {
        tags: ['Orders (Public)'], summary: 'Обновить статус заказа вручную (pharmacy auth)',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['pending', 'confirmed', 'courier_pickup', 'courier_picked', 'courier_delivery', 'delivered'] } } } } },
        },
        responses: { 200: { description: 'Статус обновлён' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — ME & ORDERS
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/me': {
      get: {
        tags: ['Admin — Me & Orders'], summary: 'Текущие права администратора',
        responses: { 200: { description: '{ isSuperAdmin, permissions }' } },
      },
    },

    '/api/admin/orders': {
      get: {
        tags: ['Admin — Me & Orders'], summary: 'Все заказы платформы',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'pharmacyId', in: 'query', schema: { type: 'string' }, description: 'Один id или через запятую' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'courier', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Список заказов + total, pages' } },
      },
      post: {
        tags: ['Admin — Me & Orders'], summary: 'Создать заказ от имени аптеки',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['pharmacyId'], properties: { pharmacyId: { type: 'string' }, pharmacyComment: { type: 'string' }, medicinesTotal: { type: 'number' }, customerPhone: { type: 'string' }, customerName: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Заказ создан' } },
      },
    },

    '/api/admin/orders/stats': {
      get: {
        tags: ['Admin — Me & Orders'], summary: 'Сводная статистика заказов (awaiting / delivering / delivered)',
        responses: { 200: { description: '{ total, awaiting, delivering, delivered }' } },
      },
    },

    '/api/admin/orders/bulk': {
      delete: {
        tags: ['Admin — Me & Orders'], summary: 'Удалить несколько заказов',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } } } },
        },
        responses: { 200: { description: '{ success, count }' } },
      },
    },

    '/api/admin/orders/{id}': {
      delete: {
        tags: ['Admin — Me & Orders'], summary: 'Удалить заказ',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/orders/{token}/confirm': {
      put: {
        tags: ['Admin — Me & Orders'], summary: 'Подтвердить заказ от имени admin (вызвать курьера)',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Подтверждён' }, 400: { description: 'Ошибка курьера' } },
      },
    },

    '/api/admin/orders/{token}/cancel': {
      put: {
        tags: ['Admin — Me & Orders'], summary: 'Отменить заказ (admin)',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Отменён' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — PHARMACIES
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/pharmacies': {
      get: {
        tags: ['Admin — Pharmacies'], summary: 'Список бизнесов',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'courier', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Массив бизнесов' } },
      },
      post: {
        tags: ['Admin — Pharmacies'], summary: 'Создать бизнес',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'phone', 'login', 'password'], properties: { name: { type: 'string' }, ownerName: { type: 'string' }, phone: { type: 'string' }, login: { type: 'string' }, password: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, subscriptionExpiry: { type: 'string', format: 'date-time' }, allowedCouriers: { type: 'array', items: { type: 'string' } } } } } },
        },
        responses: { 201: { description: 'Создан' }, 409: { description: 'Login занят' } },
      },
    },

    '/api/admin/pharmacies/{id}': {
      put: {
        tags: ['Admin — Pharmacies'], summary: 'Обновить бизнес',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, ownerName: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, isActive: { type: 'boolean' }, login: { type: 'string' }, password: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, subscriptionExpiry: { type: 'string', format: 'date-time' }, allowedCouriers: { type: 'array', items: { type: 'string' } }, noorPaymentType: { type: 'string', enum: ['CASH', 'BALANCE'] } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Admin — Pharmacies'], summary: 'Удалить бизнес (со всеми заказами)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/pharmacies/{id}/balance': {
      put: {
        tags: ['Admin — Pharmacies'], summary: 'Установить баланс Noor для бизнеса (superadmin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['balance'], properties: { balance: { type: 'number', example: 500000 } } } } },
        },
        responses: { 200: { description: '{ id, name, balance, noorPaymentType }' } },
      },
    },

    '/api/admin/pharmacies/{id}/creator': {
      put: {
        tags: ['Admin — Pharmacies'], summary: 'Изменить ответственного за создание бизнеса',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { createdById: { type: 'string', nullable: true }, selfRegistered: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — CLIENTS & ANALYTICS
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/clients': {
      get: {
        tags: ['Admin — Clients & Analytics'], summary: 'Клиенты по всей платформе',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'minOrders', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Клиенты + total' } },
      },
    },

    '/api/admin/analytics': {
      get: {
        tags: ['Admin — Clients & Analytics'], summary: 'Общая аналитика платформы',
        responses: { 200: { description: 'totalOrders, activePharmacies, суммы, по статусам/курьерам/дням' } },
      },
    },

    '/api/admin/activations': {
      get: {
        tags: ['Admin — Clients & Analytics'], summary: 'Статистика активаций бизнесов',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'creatorType', in: 'query', schema: { type: 'string', enum: ['self', 'superadmin', 'user'] } },
          { name: 'createdById', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Глобальная статистика + список аптек' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — OWNERS
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/owners': {
      get: {
        tags: ['Admin — Owners'], summary: 'Список владельцев + партнёры',
        parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: '{ owners, partners, total }' } },
      },
      post: {
        tags: ['Admin — Owners'], summary: 'Создать владельца',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'login', 'password'], properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, login: { type: 'string' }, password: { type: 'string', minLength: 6 } } } } },
        },
        responses: { 201: { description: 'Владелец создан' }, 409: { description: 'Login занят' } },
      },
    },

    '/api/admin/owners/{id}': {
      put: {
        tags: ['Admin — Owners'], summary: 'Обновить владельца',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, login: { type: 'string' }, newPassword: { type: 'string' }, isActive: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Admin — Owners'], summary: 'Удалить владельца (superadmin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/owners/{id}/assign/{pharmacyId}': {
      post: {
        tags: ['Admin — Owners'], summary: 'Привязать бизнес к владельцу',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Привязан' } },
      },
      delete: {
        tags: ['Admin — Owners'], summary: 'Отвязать бизнес от владельца',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Отвязан' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — PARTNERS
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/partners': {
      get: {
        tags: ['Admin — Partners'], summary: 'Список партнёров',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['MARKETPLACE', 'POST_SYSTEM'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        ],
        responses: { 200: { description: 'Массив партнёров' } },
      },
      post: {
        tags: ['Admin — Partners'], summary: 'Создать партнёра (auto-генерируется apiToken)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ['MARKETPLACE', 'POST_SYSTEM'] }, phone: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } } },
        },
        responses: { 201: { description: 'Партнёр + apiToken (только при создании)' } },
      },
    },

    '/api/admin/partners/{id}': {
      get: {
        tags: ['Admin — Partners'], summary: 'Детали партнёра с магазинами и courierMarkups',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Партнёр + shops + courierMarkups' }, 404: { description: 'Не найден' } },
      },
      put: {
        tags: ['Admin — Partners'], summary: 'Обновить основные данные партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, isActive: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Admin — Partners'], summary: 'Удалить партнёра (superadmin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/partners/{id}/regenerate-token': {
      post: {
        tags: ['Admin — Partners'], summary: 'Перегенерировать API токен (superadmin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Новый токен (сохраните!)' } },
      },
    },

    '/api/admin/partners/{id}/courier-markups': {
      put: {
        tags: ['Admin — Partners'], summary: 'Настройки наценок курьеров',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { markups: { type: 'array', items: { type: 'object', properties: { courierType: { type: 'string', enum: ['noor', 'millennium', 'mytaxi', 'yandex'] }, markupPercent: { type: 'number' }, isEnabled: { type: 'boolean' } } } } } } } },
        },
        responses: { 200: { description: 'Сохранено' } },
      },
    },

    '/api/admin/partners/{id}/balance': {
      put: {
        tags: ['Admin — Partners'], summary: 'Обновить баланс партнёра (superadmin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['balance', 'operation'], properties: { balance: { type: 'number', example: 100000 }, operation: { type: 'string', enum: ['set', 'increment', 'decrement'] } } } } },
        },
        responses: { 200: { description: 'Баланс обновлён' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — PARTNER SHOPS
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/partners/{id}/shops': {
      get: {
        tags: ['Admin — Partner Shops'], summary: 'Магазины партнёра (с привязанной аптекой)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Массив магазинов' } },
      },
      post: {
        tags: ['Admin — Partner Shops'], summary: 'Создать магазин вручную (POST_SYSTEM)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, externalShopId: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Магазин создан' } },
      },
    },

    '/api/admin/partners/{id}/shops/{shopId}': {
      put: {
        tags: ['Admin — Partner Shops'], summary: 'Обновить магазин',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'shopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, externalShopId: { type: 'string' }, isActive: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Admin — Partner Shops'], summary: 'Удалить магазин (superadmin)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'shopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/partners/{id}/shops/{shopId}/balance': {
      put: {
        tags: ['Admin — Partner Shops'], summary: 'Обновить баланс магазина (superadmin)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'shopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['balance', 'operation'], properties: { balance: { type: 'number' }, operation: { type: 'string', enum: ['set', 'increment', 'decrement'] } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
    },

    '/api/admin/partners/{id}/available-pharmacies': {
      get: {
        tags: ['Admin — Partner Shops'], summary: 'Аптеки без привязки к любому партнёру',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Массив аптек для выбора' } },
      },
    },

    '/api/admin/partners/{id}/assign/{pharmacyId}': {
      post: {
        tags: ['Admin — Partner Shops'], summary: 'Привязать аптеку → создаётся магазин с auto externalShopId',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 201: { description: 'Магазин создан с externalShopId' }, 409: { description: 'Уже привязана' } },
      },
      delete: {
        tags: ['Admin — Partner Shops'], summary: 'Отвязать аптеку от партнёра',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Отвязана, магазин удалён' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — ROLES (superadmin only)
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/roles': {
      get: {
        tags: ['Admin — Roles'], summary: 'Список ролей',
        responses: { 200: { description: 'Роли с кол-вом пользователей' } },
      },
      post: {
        tags: ['Admin — Roles'], summary: 'Создать роль',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', example: 'Менеджер' }, permissions: { type: 'array', items: { type: 'string' }, example: ['orders:view', 'pharmacies:view'] } } } } },
        },
        responses: { 201: { description: 'Роль создана' }, 409: { description: 'Название уже существует' } },
      },
    },

    '/api/admin/roles/{id}': {
      put: {
        tags: ['Admin — Roles'], summary: 'Обновить роль',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } }, isActive: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Обновлена' } },
      },
      delete: {
        tags: ['Admin — Roles'], summary: 'Удалить роль',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалена' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // ADMIN — USERS (superadmin only)
    // ══════════════════════════════════════════════════════════════════════

    '/api/admin/users': {
      get: {
        tags: ['Admin — Users'], summary: 'Список пользователей admin-панели',
        responses: { 200: { description: 'Пользователи с ролями' } },
      },
      post: {
        tags: ['Admin — Users'], summary: 'Создать пользователя admin-панели',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 6 }, roleIds: { type: 'array', items: { type: 'string' } }, isActive: { type: 'boolean', default: true } } } } },
        },
        responses: { 201: { description: 'Создан' }, 409: { description: 'Email занят' } },
      },
    },

    '/api/admin/users/{id}': {
      put: {
        tags: ['Admin — Users'], summary: 'Обновить пользователя',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, roleIds: { type: 'array', items: { type: 'string' } }, isActive: { type: 'boolean' } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Admin — Users'], summary: 'Удалить пользователя',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════
    // OWNER APP
    // ══════════════════════════════════════════════════════════════════════

    '/api/owner/stores': {
      get: {
        tags: ['Owner App'], summary: 'Мои магазины',
        responses: { 200: { description: 'Массив магазинов с деталями' } },
      },
    },

    '/api/owner/stores/{id}': {
      get: {
        tags: ['Owner App'], summary: 'Настройки конкретного магазина',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Детали магазина' }, 404: { description: 'Не найден или нет доступа' } },
      },
      put: {
        tags: ['Owner App'], summary: 'Обновить настройки магазина (имя, телефон, адрес, город, пароль)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, ownerName: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' }, district: { type: 'string' }, noorPaymentType: { type: 'string', enum: ['CASH', 'BALANCE'] }, currentPassword: { type: 'string' }, newPassword: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
    },

    '/api/owner/orders': {
      get: {
        tags: ['Owner App'], summary: 'Все заказы по всем своим магазинам',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'pharmacyId', in: 'query', schema: { type: 'string' }, description: 'Фильтр по конкретному магазину' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'courier', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Заказы + total' } },
      },
      post: {
        tags: ['Owner App'], summary: 'Создать заказ от имени своего магазина',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['pharmacyId'], properties: { pharmacyId: { type: 'string' }, pharmacyComment: { type: 'string' }, medicinesTotal: { type: 'number' }, customerPhone: { type: 'string' }, customerName: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Заказ + orderUrl' } },
      },
    },

    '/api/owner/analytics': {
      get: {
        tags: ['Owner App'], summary: 'Аналитика по своим магазинам',
        parameters: [{ name: 'pharmacyId', in: 'query', schema: { type: 'string' }, description: 'Фильтр по конкретному магазину' }],
        responses: { 200: { description: 'totalOrders, суммы, по статусам/курьерам/дням' } },
      },
    },

    '/api/owner/clients': {
      get: {
        tags: ['Owner App'], summary: 'Клиенты своих магазинов',
        parameters: [
          { name: 'pharmacyId', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'minOrders', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Клиенты + total' } },
      },
    },
  },
}

module.exports = spec
