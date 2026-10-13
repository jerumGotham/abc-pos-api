import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWebsiteOrder } from "../src/server";

const validOrder = {
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  customerPhone: "09171234567",
  customerAddress: "1 Main Street",
  paymentMethod: "GCASH",
  items: [{ productId: "product-1", variantId: "variant-1", quantity: 2 }],
};

test("accepts a valid website-order payload without a client price", () => {
  const result = parseWebsiteOrder(validOrder);
  assert.ok("value" in result);
  if ("value" in result) {
    assert.equal(result.value.items[0].quantity, 2);
    assert.equal(result.value.paymentMethod, "GCASH");
  }
});

test("rejects missing customer fields, invalid payment methods, and invalid quantities", () => {
  assert.ok("error" in parseWebsiteOrder({ ...validOrder, customerEmail: "" }));
  assert.ok("error" in parseWebsiteOrder({ ...validOrder, paymentMethod: "CARD" }));
  assert.ok("error" in parseWebsiteOrder({ ...validOrder, items: [{ productId: "p", variantId: "v", quantity: 1.5 }] }));
  assert.ok("error" in parseWebsiteOrder({ ...validOrder, items: [] }));
});

test("legacy POST /orders defaults and payload handling remain unchanged", () => {
  const source = readFileSync(join(process.cwd(), "src/server.ts"), "utf8");
  const legacyHandler = source.slice(source.indexOf('app.post("/orders"'), source.indexOf("async function recalculateOrder"));
  assert.match(legacyHandler, /paymentMethod = "GCASH"/);
  assert.match(legacyHandler, /paymentStatus = "PAID"/);
  assert.match(legacyHandler, /Number\(item\.price\)/);
});
