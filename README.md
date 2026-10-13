# ABC POS API

## Setup

Copy `.env.example` to `.env`, configure `DATABASE_URL`, set a strong `WEBSITE_POS_API_KEY`, then run:

```sh
npx prisma migrate deploy
npm run build
npm start
```

`CORS_ORIGINS` is a comma-separated allowlist. Requests without an `Origin` header, such as Expo/native and server-to-server requests, are allowed.

## Website Orders

`POST /website-orders` creates an unpaid, pending website order. It does not alter the existing mobile POS `POST /orders` endpoint.

Send `Authorization: Bearer <WEBSITE_POS_API_KEY>` and this JSON body:

```json
{
  "customerName": "Ada Lovelace",
  "customerEmail": "ada@example.com",
  "customerPhone": "09171234567",
  "customerAddress": "1 Main Street",
  "paymentMethod": "GCASH",
  "deliveryAt": "2026-08-14T10:00:00.000Z",
  "notes": "Optional note",
  "items": [{ "productId": "product-id", "variantId": "variant-id", "quantity": 2 }]
}
```

`paymentMethod` must be `CASH`, `GCASH`, or `BANK_TRANSFER`. Prices, discounts, delivery fees, payment state, and order state are never accepted from the website. Product and variant prices are read from the database; the response contains only `id`, `invoiceNo`, `paymentStatus`, `orderStatus`, `subtotal`, and `total`.

## Expo Push Tokens

`POST /devices/push-token` registers an Expo device token:

```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios",
  "deviceLabel": "Counter iPad"
}
```

The endpoint is rate-limited and reactivates an existing token. Successful website orders notify active tokens. Expo `DeviceNotRegistered` receipts deactivate their matching token; notification failure never rolls back an order.

## Tests

```sh
npm test
```
