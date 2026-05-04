# tezyubor_partner_api_backend — Полная спецификация

Новый Python бэкенд для партнёрского API платформы Tezyubor.
Репозиторий: `tezyubor_partner_api_backend`

---

## 1. Обзор системы

### Назначение
Единый API для внешних партнёров (маркетплейсы и POS-системы) для:
- Параллельного расчёта цен доставки по всем курьерским службам
- Создания заказов с автоматическим вызовом курьера
- Управления статусами заказов и балансом

### Два типа партнёров
| Тип | Заголовок URL | Баланс | Флоу |
|-----|--------------|--------|------|
| `MARKETPLACE` | `/marketplace/...` | Единый баланс партнёра | calculate → confirm → order |
| `POST_SYSTEM` | `/possystem/...` | Баланс каждого магазина отдельно | create order → SMS → клиент выбирает |

### Общие правила
- Оплата: **только BALANCE** (наличка не поддерживается в partner API)
- Аутентификация: постоянный API токен в заголовке `X-API-Token`
- База данных: **тот же PostgreSQL** что и у tezyubor_backend
- Наценка: прозрачна для партнёра (он видит цену уже с наценкой)
- Округление: стандартное до ближайших **500 сум**

---

## 2. Технологический стек

```
Python          3.11+
FastAPI         0.110+
SQLAlchemy      2.0 (async mode)
asyncpg         0.29+          # async PostgreSQL driver
httpx           0.27+          # async HTTP для запросов к курьерам
Pydantic        v2
uvicorn         0.29+          # ASGI сервер
python-dotenv   1.0+
```

### requirements.txt
```
fastapi==0.110.0
uvicorn[standard]==0.29.0
sqlalchemy[asyncio]==2.0.28
asyncpg==0.29.0
httpx==0.27.0
pydantic==2.6.0
pydantic-settings==2.2.0
python-dotenv==1.0.1
```

---

## 3. Структура проекта

```
tezyubor_partner_api_backend/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app, middleware, роутеры
│   ├── config.py                # Settings из env переменных
│   ├── database.py              # Async SQLAlchemy engine + session
│   │
│   ├── models/                  # SQLAlchemy ORM модели (читаем из существующей БД)
│   │   ├── __init__.py
│   │   ├── partner.py           # Partner, PartnerCourierMarkup, PartnerShop
│   │   └── order.py             # Order (общая таблица с tezyubor_backend)
│   │
│   ├── schemas/                 # Pydantic схемы (request/response)
│   │   ├── __init__.py
│   │   ├── calculate.py         # CalculateRequest, CalculateResponse, CourierOption
│   │   └── order.py             # OrderCreateRequest, OrderResponse
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── marketplace.py       # /marketplace/* endpoints
│   │   └── possystem.py         # /possystem/* endpoints
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── calculator.py        # Параллельный расчёт + наценка + рекомендация
│   │   ├── order_service.py     # Создание заказов, токены, SMS
│   │   └── balance_service.py   # Проверка и списание баланса
│   │
│   ├── couriers/
│   │   ├── __init__.py
│   │   ├── base.py              # Абстрактный класс CourierClient
│   │   ├── noor.py              # Noor Express API
│   │   ├── millennium.py        # Millennium (TaxiMaster) API
│   │   ├── mytaxi.py            # MyTaxi API
│   │   └── yandex.py            # Yandex Delivery (заглушка, future)
│   │
│   └── middleware/
│       ├── __init__.py
│       └── auth.py              # Проверка X-API-Token → Partner
│
├── .env.example
├── requirements.txt
├── Dockerfile
├── railway.toml
└── README.md
```

---

## 4. Переменные окружения

### `.env.example`
```env
# Database (тот же PostgreSQL что у tezyubor_backend)
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/medications_delivery

# Noor Express
NOOR_HOST=https://tback.noor.uz
NOOR_TOKEN=your_noor_jwt_token
NOOR_ACCOUNT_ID=

# Millennium (TaxiMaster)
MILLENNIUM_API_HOST=https://millennium.tm.taxi:8089
MILLENNIUM_SECRET_KEY=your_millennium_secret_key
MILLENNIUM_USER_ID=189
MILLENNIUM_CLIENT_ID=145964
MILLENNIUM_CREW_GROUP_ID=25

# MyTaxi
MYTAXI_API_HOST=https://external.mytaxi.uz
MYTAXI_TOKEN=your_mytaxi_token

# Yandex Delivery (future)
YANDEX_API_HOST=https://b2b.taxi.yandex.net
YANDEX_API_KEY=

# SMS (Eskiz)
ESKIZ_EMAIL=your_eskiz_email
ESKIZ_PASSWORD=your_eskiz_password

# App
APP_ENV=production
CLIENT_BASE_URL=https://tezyubor.uz
```

---

## 5. База данных — ORM модели

### `app/models/partner.py`
```python
import enum
from sqlalchemy import Column, String, Float, Boolean, DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class PartnerType(str, enum.Enum):
    MARKETPLACE = "MARKETPLACE"
    POST_SYSTEM = "POST_SYSTEM"

class CourierType(str, enum.Enum):
    noor       = "noor"
    millennium = "millennium"
    mytaxi     = "mytaxi"
    yandex     = "yandex"

class Partner(Base):
    __tablename__ = "Partner"

    id         = Column(String, primary_key=True)
    name       = Column(String, nullable=False)
    type       = Column(Enum(PartnerType, name="PartnerType"), nullable=False)
    apiToken   = Column(String, unique=True, nullable=False)
    phone      = Column(String, nullable=True)
    address    = Column(String, nullable=True)
    lat        = Column(Float, nullable=True)
    lng        = Column(Float, nullable=True)
    balance    = Column(Float, default=0)
    isActive   = Column(Boolean, default=True)
    createdAt  = Column(DateTime(timezone=True), server_default=func.now())
    updatedAt  = Column(DateTime(timezone=True), onupdate=func.now())

    courier_markups = relationship("PartnerCourierMarkup", back_populates="partner", lazy="selectin")
    shops           = relationship("PartnerShop", back_populates="partner")
    orders          = relationship("Order", back_populates="partner", foreign_keys="Order.partnerId")

class PartnerCourierMarkup(Base):
    __tablename__ = "PartnerCourierMarkup"
    __table_args__ = (UniqueConstraint("partnerId", "courierType"),)

    id            = Column(String, primary_key=True)
    partnerId     = Column(String, ForeignKey("Partner.id", ondelete="CASCADE"), nullable=False)
    courierType   = Column(Enum(CourierType, name="CourierType"), nullable=False)
    markupPercent = Column(Float, default=0)
    isEnabled     = Column(Boolean, default=True)

    partner = relationship("Partner", back_populates="courier_markups")

class PartnerShop(Base):
    __tablename__ = "PartnerShop"
    __table_args__ = (UniqueConstraint("partnerId", "externalShopId"),)

    id             = Column(String, primary_key=True)
    partnerId      = Column(String, ForeignKey("Partner.id", ondelete="CASCADE"), nullable=False)
    externalShopId = Column(String, nullable=True)
    name           = Column(String, nullable=False)
    phone          = Column(String, nullable=True)
    address        = Column(String, nullable=True)
    lat            = Column(Float, nullable=True)
    lng            = Column(Float, nullable=True)
    balance        = Column(Float, default=0)
    isActive       = Column(Boolean, default=True)
    createdAt      = Column(DateTime(timezone=True), server_default=func.now())
    updatedAt      = Column(DateTime(timezone=True), onupdate=func.now())

    partner = relationship("Partner", back_populates="shops")
    orders  = relationship("Order", back_populates="partner_shop", foreign_keys="Order.partnerShopId")
```

### `app/models/order.py`
```python
import enum
from sqlalchemy import Column, String, Float, Boolean, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class OrderStatus(str, enum.Enum):
    pending               = "pending"
    awaiting_confirmation = "awaiting_confirmation"
    confirmed             = "confirmed"
    courier_pickup        = "courier_pickup"
    courier_picked        = "courier_picked"
    courier_delivery      = "courier_delivery"
    delivered             = "delivered"
    cancelled             = "cancelled"

class Order(Base):
    __tablename__ = "Order"

    id              = Column(String, primary_key=True)
    token           = Column(String, unique=True, nullable=False)
    pharmacyId      = Column(String, ForeignKey("Pharmacy.id"), nullable=True)
    partnerId       = Column(String, ForeignKey("Partner.id"), nullable=True)
    partnerShopId   = Column(String, ForeignKey("PartnerShop.id"), nullable=True)

    status          = Column(Enum(OrderStatus, name="OrderStatus"), default=OrderStatus.pending)
    pharmacyComment = Column(String, nullable=True)
    medicinesTotal  = Column(Float, default=0)

    customerName    = Column(String, nullable=True)
    customerPhone   = Column(String, nullable=True)
    customerAddress = Column(String, nullable=True)
    apartment       = Column(String, nullable=True)
    entrance        = Column(String, nullable=True)
    floor           = Column(String, nullable=True)
    intercom        = Column(String, nullable=True)
    customerComment = Column(String, nullable=True)
    customerLat     = Column(Float, nullable=True)
    customerLng     = Column(Float, nullable=True)

    selectedCourier     = Column(String, nullable=True)
    deliveryPrice       = Column(Float, nullable=True)   # цена с наценкой (что видит партнёр)
    actualDeliveryPrice = Column(Float, nullable=True)   # реальная цена курьера
    markupAmount        = Column(Float, nullable=True)   # наша прибыль
    trackingUrl         = Column(String, nullable=True)
    totalPrice          = Column(Float, nullable=True)
    paymentType         = Column(String, default="BALANCE")

    noorOrderId       = Column(String, nullable=True)
    noorDisplayId     = Column(String, nullable=True)
    millenniumOrderId = Column(String, nullable=True)
    mytaxiOrderId     = Column(String, nullable=True)

    createdAt = Column(DateTime(timezone=True), server_default=func.now())
    updatedAt = Column(DateTime(timezone=True), onupdate=func.now())

    partner      = relationship("Partner", back_populates="orders", foreign_keys=[partnerId])
    partner_shop = relationship("PartnerShop", back_populates="orders", foreign_keys=[partnerShopId])
```

---

## 6. Аутентификация

### `app/middleware/auth.py`
```python
from fastapi import Header, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.partner import Partner

async def get_partner(
    x_api_token: str = Header(..., alias="X-API-Token"),
    db: AsyncSession = Depends(get_db),
) -> Partner:
    result = await db.execute(
        select(Partner).where(Partner.apiToken == x_api_token, Partner.isActive == True)
    )
    partner = result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=401, detail="Invalid or inactive API token")
    return partner

# Зависимость для MARKETPLACE роутов
async def require_marketplace(partner: Partner = Depends(get_partner)) -> Partner:
    if partner.type.value != "MARKETPLACE":
        raise HTTPException(status_code=403, detail="This endpoint is for MARKETPLACE partners only")
    return partner

# Зависимость для POST_SYSTEM роутов
async def require_pos_system(partner: Partner = Depends(get_partner)) -> Partner:
    if partner.type.value != "POST_SYSTEM":
        raise HTTPException(status_code=403, detail="This endpoint is for POST_SYSTEM partners only")
    return partner
```

---

## 7. Курьерские клиенты

### `app/couriers/base.py`
```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

@dataclass
class CourierCalculateResult:
    courier: str
    available: bool
    price: Optional[float]          # реальная цена (без наценки)
    eta_minutes: Optional[int]
    error: Optional[str]
    raw_offer_id: Optional[str]     # для MyTaxi offer_id нужен при создании заказа

class CourierClient(ABC):
    @abstractmethod
    async def calculate(
        self,
        from_lat: float, from_lng: float,
        to_lat: float, to_lng: float,
    ) -> CourierCalculateResult:
        pass

    @abstractmethod
    async def create_order(self, order: dict) -> dict:
        pass

    @abstractmethod
    async def cancel_order(self, external_order_id: str) -> None:
        pass
```

### `app/couriers/noor.py`
```python
import httpx
from app.couriers.base import CourierClient, CourierCalculateResult
from app.config import settings

class NoorClient(CourierClient):
    def __init__(self):
        self.host  = settings.NOOR_HOST
        self.token = settings.NOOR_TOKEN
        self.account_id = settings.NOOR_ACCOUNT_ID

    def _headers(self):
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
            "Accept-Language": "ru",
        }

    async def calculate(self, from_lat, from_lng, to_lat, to_lng) -> CourierCalculateResult:
        body = {
            "vendor_order_id": "0",
            "is_business": True,
            "origin": [{"location": {"long": from_lng, "lat": from_lat}, "order": 1,
                        "address": "", "entrance": "", "door_phone": "", "floor": None,
                        "apartment": "", "comment": "",
                        "client": {"phone": "", "name": "Отправитель", "email": ""},
                        "products": {"type_id": 1, "description": "Товары", "items": []}}],
            "destination": [{"location": {"long": to_lng, "lat": to_lat}, "order": 2,
                             "address": "", "entrance": "", "door_phone": "", "floor": None,
                             "apartment": "", "comment": "",
                             "client": {"phone": "", "name": "Получатель", "email": ""},
                             "products": {"type_id": 1, "description": "Товары", "items": []}}],
            "payment_type": "BALANCE",
            "delivery": {"door_to_door": True, "equipment_id": 1, "type": "EXPRESS",
                         "send_link": True, "product_paid": True, "time": None},
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(f"{self.host}/api/v1/orders/eval",
                                         json=body, headers=self._headers())
                if not resp.is_success:
                    return CourierCalculateResult("noor", False, None, None,
                                                  f"HTTP {resp.status_code}", None)
                data = resp.json()
                stage = data.get("evaluated_stage")
                price = data.get("total_delivery_price")
                ERRORS = {23: "Недостаточно средств", 27: "Нет курьеров", 28: "Вне зоны"}
                if stage == 1:
                    return CourierCalculateResult("noor", True, price, None, None, None)
                return CourierCalculateResult("noor", False, None, None,
                                              ERRORS.get(stage, f"Stage {stage}"), None)
        except Exception as e:
            return CourierCalculateResult("noor", False, None, None, str(e), None)

    async def create_order(self, order: dict) -> dict:
        # Реализация аналогична noorApi.js из tezyubor_backend
        # order содержит: sender (lat,lng,address,phone,name), recipient, token, comment
        floor_val = None
        if order.get("floor") and str(order["floor"]).isdigit():
            floor_val = int(order["floor"])
        body = {
            "vendor_order_id": str(order["order_id"]),
            "is_business": True,
            "is_paid": True,
            "payment_type": "BALANCE",
            **({"accountId": self.account_id} if self.account_id else {}),
            "origin": [{"location": {"long": order["from_lng"], "lat": order["from_lat"]},
                        "order": 1, "address": order.get("from_address", ""),
                        "entrance": "", "door_phone": "", "floor": None, "apartment": "",
                        "comment": "",
                        "client": {"phone": order.get("from_phone", ""),
                                   "name": order.get("from_name", ""), "email": ""},
                        "products": {"type_id": 1, "description": order.get("comment", "Товары"),
                                     "items": []}}],
            "destination": [{"location": {"long": order["to_lng"], "lat": order["to_lat"]},
                             "order": 2, "address": order.get("to_address", ""),
                             "entrance": order.get("entrance", ""),
                             "door_phone": order.get("intercom", ""),
                             "floor": floor_val,
                             "apartment": order.get("apartment", ""),
                             "comment": order.get("customer_comment", ""),
                             "client": {"phone": order.get("to_phone", ""),
                                        "name": order.get("to_name", ""), "email": ""},
                             "products": {"type_id": 1,
                                          "description": order.get("comment", "Товары"),
                                          "items": [{"name": order.get("comment", "Товары"),
                                                     "price_per_unit": round(order.get("goods_total", 0)),
                                                     "quantity": 1, "weight": None,
                                                     "height": None, "width": None, "length": None}]}}],
            "delivery": {"door_to_door": True, "equipment_id": 1, "type": "EXPRESS",
                         "send_link": True, "product_paid": True, "time": None},
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{self.host}/api/v1/orders",
                                     json=body, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def cancel_order(self, external_order_id: str) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.patch(
                f"{self.host}/api/v1/orders/{external_order_id}/cancel",
                headers=self._headers())
            resp.raise_for_status()
```

### `app/couriers/millennium.py`
```python
import hashlib, ssl, json
from datetime import datetime
import httpx
from app.couriers.base import CourierClient, CourierCalculateResult
from app.config import settings

class MillenniumClient(CourierClient):
    def __init__(self):
        self.host          = settings.MILLENNIUM_API_HOST
        self.secret_key    = settings.MILLENNIUM_SECRET_KEY
        self.user_id       = settings.MILLENNIUM_USER_ID
        self.client_id     = int(settings.MILLENNIUM_CLIENT_ID)
        self.crew_group_id = int(settings.MILLENNIUM_CREW_GROUP_ID)

    def _signature(self, body_str: str) -> str:
        return hashlib.md5((body_str + self.secret_key).encode()).hexdigest()

    def _source_time(self) -> str:
        return datetime.now().strftime("%Y%m%d%H%M%S")

    async def _post(self, path: str, body: dict) -> dict:
        payload = json.dumps(body, separators=(',', ':'))
        headers = {
            "Content-Type": "application/json",
            "Signature": self._signature(payload),
            "X-User-Id": str(self.user_id),
        }
        # Millennium использует self-signed cert → verify=False
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            resp = await client.post(f"{self.host}{path}", content=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                raise Exception(f"Millennium API error {data.get('code')}: {data.get('descr')}")
            return data

    async def calculate(self, from_lat, from_lng, to_lat, to_lng) -> CourierCalculateResult:
        body = {
            "crew_group_id": self.crew_group_id,
            "client_id": self.client_id,
            "analyze_route": True,
            "source_time": self._source_time(),
            "source_lat": from_lat,
            "source_lon": from_lng,
            "dest_lat": to_lat,
            "dest_lon": to_lng,
        }
        try:
            data = await self._post("/common_api/1.0/calc_order_cost2", body)
            price = data.get("data", {}).get("sum")
            return CourierCalculateResult("millennium", True, price, None, None, None)
        except Exception as e:
            return CourierCalculateResult("millennium", False, None, None, str(e), None)

    async def create_order(self, order: dict) -> dict:
        details = " ".join(filter(None, [
            f"Подъезд: {order['entrance']}" if order.get("entrance") else "",
            f"Домофон: {order['intercom']}" if order.get("intercom") else "",
            f"Этаж: {order['floor']}" if order.get("floor") else "",
            f"Кв: {order['apartment']}" if order.get("apartment") else "",
        ]))
        comment = "\n".join(filter(None, [
            f"Заказ: {order['token']}",
            details,
            f"Комментарий: {order['customer_comment']}" if order.get("customer_comment") else "",
            f"Номер клиента: {order.get('to_phone', '')}",
        ]))
        body = {
            "crew_group_id": self.crew_group_id,
            "client_id": self.client_id,
            "phone": order.get("from_phone", ""),
            "addresses": [
                {"address": order.get("from_name", ""), "lat": order["from_lat"], "lon": order["from_lng"]},
                {"address": order.get("to_address", ""), "lat": order["to_lat"], "lon": order["to_lng"]},
            ],
            "source_time": self._source_time(),
            "comment": comment,
            "check_duplicate": False,
            "attribute_values": [{"id": 232, "bool_value": True}],
        }
        return await self._post("/common_api/1.0/create_order2", body)

    async def cancel_order(self, external_order_id: str) -> None:
        pass  # Millennium не поддерживает отмену через API
```

### `app/couriers/mytaxi.py`
```python
import httpx
from app.couriers.base import CourierClient, CourierCalculateResult
from app.config import settings

class MyTaxiClient(CourierClient):
    def __init__(self):
        self.host  = settings.MYTAXI_API_HOST
        self.token = settings.MYTAXI_TOKEN

    def _headers(self):
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
            "Accept-Language": "ru",
        }

    async def calculate(self, from_lat, from_lng, to_lat, to_lng) -> CourierCalculateResult:
        body = {"route_points": [{"lat": from_lat, "lon": from_lng}, {"lat": to_lat, "lon": to_lng}]}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(f"{self.host}/v1/offers",
                                         json=body, headers=self._headers())
                if not resp.is_success:
                    return CourierCalculateResult("mytaxi", False, None, None,
                                                  f"HTTP {resp.status_code}", None)
                data = resp.json()
                offer = next((o for o in data.get("offers", []) if o.get("tariff_id") == "delivery"), None)
                if not offer:
                    return CourierCalculateResult("mytaxi", False, None, None,
                                                  "Доставка недоступна в этом районе", None)
                eta = data.get("route", {}).get("duration")
                return CourierCalculateResult("mytaxi", True, offer["total_price"],
                                              eta, None, data.get("offer_id"))
        except Exception as e:
            return CourierCalculateResult("mytaxi", False, None, None, str(e), None)

    async def create_order(self, order: dict) -> dict:
        comment_parts = list(filter(None, [
            order.get("to_address"),
            f"кв. {order['apartment']}" if order.get("apartment") else None,
            f"п. {order['entrance']}" if order.get("entrance") else None,
            f"эт. {order['floor']}" if order.get("floor") else None,
            order.get("customer_comment"),
        ]))
        body = {
            "offer_id": order["offer_id"],
            "tariff_id": "delivery",
            "user_name": order.get("to_name", "Клиент"),
            "user_phone": order.get("to_phone", ""),
            "comment": ", ".join(comment_parts) or None,
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{self.host}/v1/orders",
                                     json=body, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def cancel_order(self, external_order_id: str) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{self.host}/v1/orders/{external_order_id}/cancel",
                                     headers=self._headers())
            resp.raise_for_status()
```

### `app/couriers/yandex.py` — заглушка (future)
```python
from app.couriers.base import CourierClient, CourierCalculateResult

class YandexClient(CourierClient):
    async def calculate(self, from_lat, from_lng, to_lat, to_lng) -> CourierCalculateResult:
        return CourierCalculateResult("yandex", False, None, None, "Yandex not yet integrated", None)

    async def create_order(self, order: dict) -> dict:
        raise NotImplementedError("Yandex integration coming soon")

    async def cancel_order(self, external_order_id: str) -> None:
        raise NotImplementedError("Yandex integration coming soon")
```

---

## 8. Сервис расчёта цен

### `app/services/calculator.py`
```python
import asyncio
import math
from dataclasses import dataclass
from typing import List, Optional
from app.couriers.base import CourierCalculateResult
from app.couriers.noor import NoorClient
from app.couriers.millennium import MillenniumClient
from app.couriers.mytaxi import MyTaxiClient
from app.couriers.yandex import YandexClient
from app.models.partner import Partner, PartnerCourierMarkup

def round_to_500(price: float) -> int:
    """Стандартное округление до ближайших 500 сум."""
    return int(math.floor(price / 500 + 0.5)) * 500

@dataclass
class CourierOption:
    courier: str
    available: bool
    actual_price: Optional[float]    # реальная цена курьера
    charged_price: Optional[int]     # цена с наценкой, округлённая до 500
    markup_amount: Optional[float]   # сумма наценки
    markup_percent: float
    eta_minutes: Optional[int]
    is_recommended: bool
    error: Optional[str]
    raw_offer_id: Optional[str]      # для MyTaxi

def apply_markup(actual_price: float, markup_percent: float) -> tuple[int, float]:
    """Возвращает (charged_price_rounded, markup_amount)."""
    if markup_percent == 0 or actual_price is None:
        return round_to_500(actual_price), 0.0
    marked_up = actual_price * (1 + markup_percent / 100)
    charged = round_to_500(marked_up)
    markup_amount = charged - actual_price
    return charged, markup_amount

COURIER_CLIENTS = {
    "noor":       NoorClient,
    "millennium": MillenniumClient,
    "mytaxi":     MyTaxiClient,
    "yandex":     YandexClient,
}

async def calculate_all(
    from_lat: float, from_lng: float,
    to_lat: float, to_lng: float,
    partner: Partner,
) -> List[CourierOption]:
    """
    Параллельно запрашивает все включённые курьерские службы,
    применяет наценку партнёра, округляет до 500, определяет рекомендацию.
    """
    # Строим карту наценок из настроек партнёра
    markup_map: dict[str, PartnerCourierMarkup] = {
        m.courierType.value: m for m in partner.courier_markups
    }

    # Запускаем только включённые курьеры
    tasks = []
    enabled_couriers = []
    for courier_name, ClientClass in COURIER_CLIENTS.items():
        markup_cfg = markup_map.get(courier_name)
        if markup_cfg and markup_cfg.isEnabled:
            client = ClientClass()
            tasks.append(client.calculate(from_lat, from_lng, to_lat, to_lng))
            enabled_couriers.append((courier_name, markup_cfg.markupPercent))

    raw_results: list[CourierCalculateResult | Exception] = await asyncio.gather(
        *tasks, return_exceptions=True
    )

    options: List[CourierOption] = []
    for (courier_name, markup_percent), result in zip(enabled_couriers, raw_results):
        if isinstance(result, Exception):
            options.append(CourierOption(
                courier=courier_name, available=False, actual_price=None,
                charged_price=None, markup_amount=None, markup_percent=markup_percent,
                eta_minutes=None, is_recommended=False, error=str(result), raw_offer_id=None,
            ))
            continue

        if not result.available or result.price is None:
            options.append(CourierOption(
                courier=courier_name, available=False, actual_price=None,
                charged_price=None, markup_amount=None, markup_percent=markup_percent,
                eta_minutes=result.eta_minutes, is_recommended=False,
                error=result.error, raw_offer_id=None,
            ))
            continue

        charged, markup_amt = apply_markup(result.price, markup_percent)
        options.append(CourierOption(
            courier=courier_name, available=True, actual_price=result.price,
            charged_price=charged, markup_amount=markup_amt, markup_percent=markup_percent,
            eta_minutes=result.eta_minutes, is_recommended=False,
            error=None, raw_offer_id=result.raw_offer_id,
        ))

    # Определяем рекомендацию — самый дешёвый доступный курьер
    available = [o for o in options if o.available and o.charged_price is not None]
    if available:
        cheapest = min(available, key=lambda o: o.charged_price)
        cheapest.is_recommended = True

    return options
```

---

## 9. Сервис создания заказов

### `app/services/order_service.py`
```python
import random
import string
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.order import Order

async def generate_order_token(db: AsyncSession) -> str:
    """Генерирует уникальный токен формата ORD1234567."""
    while True:
        digits = ''.join(random.choices(string.digits, k=7))
        token = f"ORD{digits}"
        result = await db.execute(select(Order).where(Order.token == token))
        if result.scalar_one_or_none() is None:
            return token

async def send_sms_to_customer(phone: str, order_url: str, sender_name: str):
    """Отправка SMS через Eskiz API."""
    import httpx
    from app.config import settings
    # Получаем Eskiz токен
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            auth_resp = await client.post(
                "https://notify.eskiz.uz/api/auth/login",
                data={"email": settings.ESKIZ_EMAIL, "password": settings.ESKIZ_PASSWORD}
            )
            eskiz_token = auth_resp.json().get("data", {}).get("token")
            if not eskiz_token:
                return
            message = f"{sender_name}\nSsylka dlya zakaza / Buyurtma havolasi:\n{order_url}"
            await client.post(
                "https://notify.eskiz.uz/api/message/sms/send",
                headers={"Authorization": f"Bearer {eskiz_token}"},
                data={"mobile_phone": phone, "message": message, "from": "4546"}
            )
    except Exception:
        pass  # SMS не блокирует создание заказа
```

---

## 10. API Endpoints

### 10.1 MARKETPLACE endpoints — `app/routers/marketplace.py`

```
POST   /marketplace/calculate
       Body: { from_lat, from_lng, to_lat, to_lng, goods_total? }
       Response: { couriers: [...], recommended_courier: "noor" }

POST   /marketplace/orders
       Body: { from_lat, from_lng, to_lat, to_lng, from_name, from_phone, from_address,
               to_name, to_phone, to_address, to_lat, to_lng,
               courier, goods_total?, comment?, apartment?, entrance?, floor?, intercom? }
       Response: { order: {...}, order_url: "https://tezyubor.uz/order/ORD..." }
       Логика: создать Order, списать баланс партнёра, вызвать курьера, вернуть ответ

GET    /marketplace/orders
       Query: page, page_size, status, dateFrom, dateTo
       Response: { orders: [...], total, page, page_size }

GET    /marketplace/orders/{token}
       Response: { order: {...} }  — статус + trackingUrl

DELETE /marketplace/orders/{token}
       Response: { success: true }  — отмена заказа + возврат баланса

GET    /marketplace/clients
       Query: search, page, page_size
       Response: { clients: [{phone, name, addresses, orders_count}] }

GET    /marketplace/profile
       Response: { id, name, balance, courier_markups: [...] }
```

### 10.2 POS_SYSTEM endpoints — `app/routers/possystem.py`

```
# Сценарий 1 (основной): магазин создаёт заказ, клиент выбирает курьера через ссылку

POST   /possystem/orders
       Header: X-API-Token, X-Shop-ID (ID магазина внутри POST_SYSTEM партнёра)
       Body: { customer_phone, customer_name?, comment?, goods_total? }
       Логика:
         1. Найти PartnerShop по (partnerId, externalShopId=X-Shop-ID)
         2. Создать Order (status: pending, partnerShopId)
         3. Отправить SMS клиенту со ссылкой
         4. Вернуть order_token и order_url
       Response: { order_token, order_url }

GET    /possystem/orders/{token}
       Response: { order: {...} }

GET    /possystem/orders
       Header: X-Shop-ID
       Query: page, page_size, status
       Response: { orders: [...], total }

DELETE /possystem/orders/{token}
       Отмена + возврат баланса магазина

GET    /possystem/shops
       Response: { shops: [{id, name, balance, externalShopId, isActive}] }

GET    /possystem/shops/{external_shop_id}/balance
       Response: { shop_id, name, balance }

# Сценарий 2 (будущий, API готов но UI не строим):
POST   /possystem/calculate
       Header: X-Shop-ID
       Body: { from_lat, from_lng, to_lat, to_lng }
       Response: { couriers: [...], recommended_courier }

POST   /possystem/orders/full
       Header: X-Shop-ID
       Body: { все данные отправителя и получателя + выбранный курьер }
       Логика: сразу создать заказ и вызвать курьера
```

---

## 11. Схемы Pydantic (request/response)

### `app/schemas/calculate.py`
```python
from pydantic import BaseModel
from typing import List, Optional

class CalculateRequest(BaseModel):
    from_lat: float
    from_lng: float
    to_lat: float
    to_lng: float
    goods_total: float = 0.0

class CourierOptionSchema(BaseModel):
    courier: str
    available: bool
    charged_price: Optional[int]       # цена с наценкой, округлённая (что видит партнёр)
    eta_minutes: Optional[int]
    is_recommended: bool
    error: Optional[str]

class CalculateResponse(BaseModel):
    couriers: List[CourierOptionSchema]
    recommended_courier: Optional[str]  # имя рекомендуемого курьера
```

### `app/schemas/order.py`
```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class MarketplaceOrderCreateRequest(BaseModel):
    # Отправитель (если не указан — берётся из профиля партнёра)
    from_lat: Optional[float] = None
    from_lng: Optional[float] = None
    from_name: Optional[str] = None
    from_phone: Optional[str] = None
    from_address: Optional[str] = None
    # Получатель
    to_name: str
    to_phone: str
    to_address: str
    to_lat: float
    to_lng: float
    # Заказ
    courier: str               # "noor" | "millennium" | "mytaxi"
    goods_total: float = 0.0
    comment: Optional[str] = None
    apartment: Optional[str] = None
    entrance: Optional[str] = None
    floor: Optional[str] = None
    intercom: Optional[str] = None

class PosSystemOrderCreateRequest(BaseModel):
    customer_phone: str
    customer_name: Optional[str] = None
    comment: Optional[str] = None
    goods_total: float = 0.0

class OrderResponse(BaseModel):
    id: str
    token: str
    status: str
    customer_name: Optional[str]
    customer_phone: Optional[str]
    customer_address: Optional[str]
    selected_courier: Optional[str]
    delivery_price: Optional[float]    # цена с наценкой
    total_price: Optional[float]
    tracking_url: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
```

---

## 12. Логика баланса

### `app/services/balance_service.py`
```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models.partner import Partner, PartnerShop
from fastapi import HTTPException

async def check_and_deduct_partner_balance(
    db: AsyncSession,
    partner_id: str,
    amount: float,
) -> None:
    """Проверяет и списывает баланс партнёра (MARKETPLACE)."""
    result = await db.execute(select(Partner).where(Partner.id == partner_id).with_for_update())
    partner = result.scalar_one_or_none()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    if partner.balance < amount:
        raise HTTPException(status_code=402, detail=f"Insufficient balance. Required: {amount}, Available: {partner.balance}")
    await db.execute(
        update(Partner).where(Partner.id == partner_id)
        .values(balance=Partner.balance - amount)
    )

async def check_and_deduct_shop_balance(
    db: AsyncSession,
    shop_id: str,
    amount: float,
) -> None:
    """Проверяет и списывает баланс магазина (POST_SYSTEM)."""
    result = await db.execute(select(PartnerShop).where(PartnerShop.id == shop_id).with_for_update())
    shop = result.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    if shop.balance < amount:
        raise HTTPException(status_code=402, detail=f"Insufficient shop balance. Required: {amount}, Available: {shop.balance}")
    await db.execute(
        update(PartnerShop).where(PartnerShop.id == shop_id)
        .values(balance=PartnerShop.balance - amount)
    )

async def refund_partner_balance(db: AsyncSession, partner_id: str, amount: float) -> None:
    await db.execute(
        update(Partner).where(Partner.id == partner_id)
        .values(balance=Partner.balance + amount)
    )

async def refund_shop_balance(db: AsyncSession, shop_id: str, amount: float) -> None:
    await db.execute(
        update(PartnerShop).where(PartnerShop.id == shop_id)
        .values(balance=PartnerShop.balance + amount)
    )
```

**Важно**: баланс списывается в момент создания заказа и вызова курьера. При отмене — возвращается.

---

## 13. `app/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import marketplace, possystem

app = FastAPI(
    title="Tezyubor Partner API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # partner API — CORS открытый
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(marketplace.router, prefix="/marketplace", tags=["Marketplace"])
app.include_router(possystem.router,   prefix="/possystem",  tags=["POS System"])

@app.get("/health")
async def health():
    return {"status": "ok", "service": "tezyubor-partner-api"}
```

---

## 14. `app/database.py`

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

---

## 15. `app/config.py`

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    NOOR_HOST: str = "https://tback.noor.uz"
    NOOR_TOKEN: str
    NOOR_ACCOUNT_ID: str = ""
    MILLENNIUM_API_HOST: str = "https://millennium.tm.taxi:8089"
    MILLENNIUM_SECRET_KEY: str
    MILLENNIUM_USER_ID: str
    MILLENNIUM_CLIENT_ID: str
    MILLENNIUM_CREW_GROUP_ID: str
    MYTAXI_API_HOST: str = "https://external.mytaxi.uz"
    MYTAXI_TOKEN: str
    YANDEX_API_HOST: str = ""
    YANDEX_API_KEY: str = ""
    ESKIZ_EMAIL: str = ""
    ESKIZ_PASSWORD: str = ""
    CLIENT_BASE_URL: str = "https://tezyubor.uz"
    APP_ENV: str = "production"

    class Config:
        env_file = ".env"

settings = Settings()
```

---

## 16. Dockerfile и Railway

### `Dockerfile`
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `railway.toml`
```toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
healthcheckTimeout = 30
```

---

## 17. Полный флоу создания заказа — MARKETPLACE

```
1. Partner → POST /marketplace/calculate
   ├── auth: проверить X-API-Token → найти Partner
   ├── параллельно: Noor.calculate(), Millennium.calculate(), MyTaxi.calculate()
   ├── для каждого результата: apply_markup() + round_to_500()
   ├── найти cheapest available → is_recommended=True
   └── вернуть список CourierOption

2. Partner → POST /marketplace/orders  (выбрал courier="noor", charged_price=24500)
   ├── auth: проверить X-API-Token → найти Partner
   ├── проверить Partner.balance >= charged_price (402 если нет)
   ├── сгенерировать token = ORD1234567
   ├── create Order { partnerId, token, status="confirmed", selectedCourier="noor",
   │                  deliveryPrice=24500, actualDeliveryPrice=22000, markupAmount=2500, ... }
   ├── списать Partner.balance -= 24500
   ├── вызвать NoorClient.create_order(...)
   ├── обновить Order { noorOrderId, trackingUrl, status="confirmed" }
   └── вернуть { order, order_url }

3. Partner → GET /marketplace/orders/ORD1234567
   └── вернуть актуальный статус из DB
```

---

## 18. Полный флоу создания заказа — POST_SYSTEM (Сценарий 1)

```
1. Shop → POST /possystem/orders
   Header: X-API-Token (партнёра), X-Shop-ID (externalShopId магазина)
   Body: { customer_phone: "+998901234567", customer_name: "Алишер", comment: "...", goods_total: 50000 }
   ├── auth: найти Partner по X-API-Token
   ├── найти PartnerShop по (partnerId, externalShopId=X-Shop-ID)
   ├── создать Order { partnerShopId, token, status="pending", customerPhone, customerName,
   │                   pharmacyComment=comment, medicinesTotal=goods_total }
   ├── SMS клиенту: "https://tezyubor.uz/order/ORD1234567"
   └── вернуть { order_token: "ORD1234567", order_url: "..." }

2. Клиент открывает ссылку → tezyubor.uz/order/ORD1234567
   (существующий фронтенд tezyubor обрабатывает этот URL)
   ├── клиент вводит адрес
   ├── вызываются evaluate endpoints (из tezyubor_backend)
   │   НО: цены должны учитывать наценку партнёра!
   │   → Нужна логика в tezyubor_backend: если order.partnerShopId != null,
   │     применить наценку PartnerShop.partner.courierMarkups
   ├── клиент выбирает курьера
   └── при подтверждении: списать PartnerShop.balance
```

> **Важное замечание по Сценарию 1**: Когда заказ создан через POST_SYSTEM и клиент
> открывает ссылку на существующем фронтенде tezyubor.uz, evaluate/confirm endpoints
> в tezyubor_backend (Node.js) должны знать о наценке партнёра. Нужно добавить в
> tezyubor_backend логику: если у Order есть partnerShopId — применять наценку
> при evaluate и списывать с баланса PartnerShop при confirm.

---

## 19. Checklist разработки (порядок)

### Этап 1 — Основа
- [ ] Инициализировать проект: `pip install fastapi sqlalchemy asyncpg httpx uvicorn pydantic-settings`
- [ ] Создать структуру папок
- [ ] Настроить `app/config.py`, `app/database.py`
- [ ] Создать ORM модели `app/models/partner.py` и `app/models/order.py`
- [ ] Реализовать `app/middleware/auth.py`
- [ ] Создать `app/main.py`

### Этап 2 — Курьеры
- [ ] Реализовать `app/couriers/base.py`
- [ ] Реализовать `app/couriers/noor.py`
- [ ] Реализовать `app/couriers/millennium.py`
- [ ] Реализовать `app/couriers/mytaxi.py`
- [ ] Создать заглушку `app/couriers/yandex.py`

### Этап 3 — Сервисы
- [ ] Реализовать `app/services/calculator.py` (параллельный расчёт + наценка + рекомендация)
- [ ] Реализовать `app/services/balance_service.py`
- [ ] Реализовать `app/services/order_service.py` (токены + SMS)

### Этап 4 — Endpoints
- [ ] Реализовать `app/routers/marketplace.py` (calculate, orders CRUD)
- [ ] Реализовать `app/routers/possystem.py` (orders, shops)

### Этап 5 — Деплой
- [ ] Создать `Dockerfile`
- [ ] Создать `railway.toml`
- [ ] Настроить переменные окружения в Railway
- [ ] Подключить к тому же PostgreSQL
- [ ] Проверить `/health` endpoint

---

## 20. Пример ответа `/marketplace/calculate`

```json
{
  "couriers": [
    {
      "courier": "noor",
      "available": true,
      "charged_price": 24500,
      "eta_minutes": null,
      "is_recommended": true,
      "error": null
    },
    {
      "courier": "millennium",
      "available": true,
      "charged_price": 27000,
      "eta_minutes": null,
      "is_recommended": false,
      "error": null
    },
    {
      "courier": "mytaxi",
      "available": true,
      "charged_price": 25500,
      "eta_minutes": 12,
      "is_recommended": false,
      "error": null
    },
    {
      "courier": "yandex",
      "available": false,
      "charged_price": null,
      "eta_minutes": null,
      "is_recommended": false,
      "error": "Yandex not yet integrated"
    }
  ],
  "recommended_courier": "noor"
}
```
