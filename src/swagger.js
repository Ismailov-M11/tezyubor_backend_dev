const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Tezyubor Backend API',
    version: '1.0.0',
    description: `
## Аутентификация

Выполните **POST /api/auth/login** → получите \`token\` → нажмите кнопку **Authorize** и введите токен.

Все защищённые эндпоинты требуют заголовок:
\`\`\`
Authorization: Bearer <token>
\`\`\`
    `.trim(),
  },
  servers: [{ url: 'https://api.tezyubor.uz', description: 'Production' }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
        },
      },
      Partner: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['MARKETPLACE', 'POST_SYSTEM'] },
          phone: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          lat: { type: 'number', nullable: true },
          lng: { type: 'number', nullable: true },
          balance: { type: 'number' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      PartnerShop: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          partnerId: { type: 'string' },
          pharmacyId: { type: 'string', nullable: true },
          name: { type: 'string' },
          phone: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          externalShopId: { type: 'string', nullable: true },
          balance: { type: 'number' },
          isActive: { type: 'boolean' },
        },
      },
      Pharmacy: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          login: { type: 'string' },
          phone: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          lat: { type: 'number', nullable: true },
          lng: { type: 'number', nullable: true },
          isActive: { type: 'boolean' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Аутентификация' },
    { name: 'Partners', description: 'Управление партнёрами (Admin)' },
    { name: 'Partner Shops', description: 'Магазины и привязки аптек (Admin)' },
    { name: 'Pharmacies', description: 'Бизнесы / аптеки (Admin)' },
    { name: 'Orders', description: 'Заказы (Admin)' },
    { name: 'Owners', description: 'Владельцы магазинов (Admin)' },
  ],
  paths: {
    // ── Auth ─────────────────────────────────────────────────────────────────
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Вход в систему',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'admin@tezyubor.uz' },
                  password: { type: 'string', example: 'password' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Успешный вход',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    token: { type: 'string' },
                    user: { type: 'object' },
                  },
                },
              },
            },
          },
          401: { description: 'Неверные учётные данные' },
        },
      },
    },

    // ── Partners ──────────────────────────────────────────────────────────────
    '/api/admin/partners': {
      get: {
        tags: ['Partners'],
        summary: 'Список партнёров',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['MARKETPLACE', 'POST_SYSTEM'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: { partners: { type: 'array', items: { $ref: '#/components/schemas/Partner' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Partners'],
        summary: 'Создать партнёра',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'type'],
                properties: {
                  name: { type: 'string', example: 'Мой партнёр' },
                  type: { type: 'string', enum: ['MARKETPLACE', 'POST_SYSTEM'] },
                  phone: { type: 'string' },
                  address: { type: 'string' },
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Партнёр создан' },
        },
      },
    },

    '/api/admin/partners/{id}': {
      get: {
        tags: ['Partners'],
        summary: 'Детали партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Не найден' } },
      },
      put: {
        tags: ['Partners'],
        summary: 'Обновить партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  address: { type: 'string' },
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Partners'],
        summary: 'Удалить партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/partners/{id}/balance': {
      put: {
        tags: ['Partners'],
        summary: 'Обновить баланс партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['balance', 'operation'],
                properties: {
                  balance: { type: 'number', example: 100000 },
                  operation: { type: 'string', enum: ['set', 'increment', 'decrement'] },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Баланс обновлён' } },
      },
    },

    '/api/admin/partners/{id}/regenerate-token': {
      post: {
        tags: ['Partners'],
        summary: 'Перегенерировать API токен партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Токен обновлён' } },
      },
    },

    '/api/admin/partners/{id}/courier-markups': {
      put: {
        tags: ['Partners'],
        summary: 'Настройки наценок курьеров',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  markups: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        courierType: { type: 'string', enum: ['noor', 'millennium', 'mytaxi', 'yandex'] },
                        markupPercent: { type: 'number' },
                        isEnabled: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Сохранено' } },
      },
    },

    // ── Partner Shops ─────────────────────────────────────────────────────────
    '/api/admin/partners/{id}/shops': {
      get: {
        tags: ['Partner Shops'],
        summary: 'Список магазинов партнёра',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: { shops: { type: 'array', items: { $ref: '#/components/schemas/PartnerShop' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Partner Shops'],
        summary: 'Создать магазин',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  address: { type: 'string' },
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  externalShopId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Создан' } },
      },
    },

    '/api/admin/partners/{id}/shops/{shopId}': {
      put: {
        tags: ['Partner Shops'],
        summary: 'Обновить магазин',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'shopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  address: { type: 'string' },
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  externalShopId: { type: 'string' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
      delete: {
        tags: ['Partner Shops'],
        summary: 'Удалить магазин',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'shopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Удалён' } },
      },
    },

    '/api/admin/partners/{id}/shops/{shopId}/balance': {
      put: {
        tags: ['Partner Shops'],
        summary: 'Обновить баланс магазина',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'shopId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['balance', 'operation'],
                properties: {
                  balance: { type: 'number' },
                  operation: { type: 'string', enum: ['set', 'increment', 'decrement'] },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Обновлён' } },
      },
    },

    '/api/admin/partners/{id}/available-pharmacies': {
      get: {
        tags: ['Partner Shops'],
        summary: 'Аптеки без привязки к партнёру (для назначения)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: { pharmacies: { type: 'array', items: { $ref: '#/components/schemas/Pharmacy' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/admin/partners/{id}/assign/{pharmacyId}': {
      post: {
        tags: ['Partner Shops'],
        summary: 'Привязать аптеку к партнёру (создаёт магазин + генерирует externalShopId)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 201: { description: 'Привязана' }, 409: { description: 'Уже привязана' } },
      },
      delete: {
        tags: ['Partner Shops'],
        summary: 'Отвязать аптеку от партнёра',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Отвязана' } },
      },
    },

    // ── Pharmacies ────────────────────────────────────────────────────────────
    '/api/admin/pharmacies': {
      get: {
        tags: ['Pharmacies'],
        summary: 'Список бизнесов',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'OK' } },
      },
      post: {
        tags: ['Pharmacies'],
        summary: 'Создать бизнес',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'login', 'password'],
                properties: {
                  name: { type: 'string' },
                  login: { type: 'string' },
                  password: { type: 'string' },
                  phone: { type: 'string' },
                  address: { type: 'string' },
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Создан' } },
      },
    },

    // ── Owners ────────────────────────────────────────────────────────────────
    '/api/admin/owners': {
      get: {
        tags: ['Owners'],
        summary: 'Список владельцев и партнёров',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        owners: { type: 'array' },
                        partners: { type: 'array', items: { $ref: '#/components/schemas/Partner' } },
                        total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

module.exports = spec
