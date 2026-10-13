import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { PaymentMethod, PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
  }),
);
app.use(express.json());

const publicEndpointLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

const expoPushTokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseWebsiteOrder(body: unknown) {
  if (!isRecord(body)) {
    return { error: "Invalid request body" } as const;
  }

  const { customerName, customerEmail, customerPhone, customerAddress, paymentMethod, deliveryAt, notes, items } = body;

  if (!isNonEmptyString(customerName) || !isNonEmptyString(customerEmail) || !isNonEmptyString(customerPhone) || !isNonEmptyString(customerAddress)) {
    return { error: "Customer name, email, phone, and address are required" } as const;
  }

  if (!/^\S+@\S+\.\S+$/.test(customerEmail)) {
    return { error: "A valid customer email is required" } as const;
  }

  if (!Object.values(PaymentMethod).includes(paymentMethod as PaymentMethod)) {
    return { error: "A valid payment method is required" } as const;
  }

  let parsedDeliveryAt: Date | null = null;
  if (deliveryAt !== undefined) {
    if (!isNonEmptyString(deliveryAt) || Number.isNaN(Date.parse(deliveryAt))) {
      return { error: "deliveryAt must be a valid ISO date" } as const;
    }
    parsedDeliveryAt = new Date(deliveryAt);
  }

  if (notes !== undefined && typeof notes !== "string") {
    return { error: "notes must be a string" } as const;
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: "At least one item is required" } as const;
  }

  const parsedItems: Array<{ productId: string; variantId: string; quantity: number }> = [];
  for (const item of items) {
    if (!isRecord(item) || !isNonEmptyString(item.productId) || !isNonEmptyString(item.variantId) || typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { error: "Each item requires a productId, variantId, and positive integer quantity" } as const;
    }
    parsedItems.push({ productId: item.productId, variantId: item.variantId, quantity: item.quantity });
  }

  return {
    value: {
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      customerAddress: customerAddress.trim(),
      paymentMethod: paymentMethod as PaymentMethod,
      deliveryAt: parsedDeliveryAt,
      notes: typeof notes === "string" ? notes.trim() || null : null,
      items: parsedItems,
    },
  } as const;
}

async function sendWebsiteOrderNotification(order: { id: string; invoiceNo: string; customerName: string }) {
  const tokens = await prisma.devicePushToken.findMany({ where: { active: true } });
  if (tokens.length === 0) return;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        tokens.map(({ token }) => ({
          to: token,
          title: "New website order",
          body: `${order.invoiceNo} - ${order.customerName}`,
          data: { orderId: order.id, invoiceNo: order.invoiceNo, source: "WEBSITE" },
        })),
      ),
    });

    if (!response.ok) {
      console.error("EXPO PUSH ERROR:", response.status);
      return;
    }

    const result = (await response.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
    const invalidTokens = tokens
      .filter((_, index) => result.data?.[index]?.details?.error === "DeviceNotRegistered")
      .map(({ token }) => token);

    if (invalidTokens.length > 0) {
      await prisma.devicePushToken.updateMany({ where: { token: { in: invalidTokens } }, data: { active: false } });
    }
  } catch (error) {
    console.error("EXPO PUSH ERROR:", error);
  }
}

app.get("/", (req, res) => {
  res.json({ message: "ABC POS API running" });
});

app.get("/dashboard", async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const totalProducts = await prisma.product.count({
      where: { isActive: true },
    });

    const totalCustomers = await prisma.customer.count();

    const todayOrders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
        orderStatus: {
          not: "CANCELLED",
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    const todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);

    const productsSold: Record<string, number> = {};

    todayOrders.forEach((order) => {
      order.items.forEach((item) => {
        productsSold[item.product.name] =
          (productsSold[item.product.name] || 0) + item.quantity;
      });
    });

    const bestSeller =
      Object.entries(productsSold).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "No sales yet";

    const recentTodayOrders = todayOrders.slice(0, 10).map((order) => ({
      id: order.id,
      invoiceNo: order.invoiceNo,
      customerId: order.customerId,
      customerName: order.customerName,
      total: order.total,
      createdAt: order.createdAt,
    }));

    res.json({
      todaySales,
      todayOrders: todayOrders.length,
      totalProducts,
      totalCustomers,
      bestSeller,
      productsSold,
      recentTodayOrders,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get dashboard", error });
  }
});

app.get("/products", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: { variants: true },
      orderBy: { createdAt: "asc" },
    });

    res.json(products);
  } catch (error) {
    console.log("GET ORDERS ERROR:", error);
    res.status(500).json({ message: "Failed to get products", error });
  }
});

app.post("/products", async (req, res) => {
  try {
    const { name, category, variants } = req.body;

    const product = await prisma.product.create({
      data: {
        name,
        category,
        variants: {
          create: variants,
        },
      },
      include: { variants: true },
    });

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: "Failed to create product", error });
  }
});

app.patch("/products/:id", async (req, res) => {
  try {
    const { name, category, variants } = req.body;
    const productId = req.params.id;

    // 1. Update product
    await prisma.product.update({
      where: { id: productId },
      data: { name, category },
    });

    // 2. Get existing variants
    const existing = await prisma.productVariant.findMany({
      where: { productId },
    });

    // 3. Split incoming
    const incomingWithId = variants.filter((v: any) => v.id);
    const incomingWithoutId = variants.filter((v: any) => !v.id);

    const incomingIds = incomingWithId.map((v: any) => v.id);

    // 4. Find variants to delete (not in incoming)
    const toDelete = existing.filter((v) => !incomingIds.includes(v.id));

    // 5. Only delete if NOT used
    for (const v of toDelete) {
      const used = await prisma.orderItem.findFirst({
        where: { variantId: v.id },
      });

      if (!used) {
        await prisma.productVariant.delete({
          where: { id: v.id },
        });
      }
    }

    // 6. Update existing variants
    for (const v of incomingWithId) {
      await prisma.productVariant.update({
        where: { id: v.id },
        data: {
          label: v.label,
          price: Number(v.price),
        },
      });
    }

    // 7. Create new variants
    for (const v of incomingWithoutId) {
      await prisma.productVariant.create({
        data: {
          productId,
          label: v.label,
          price: Number(v.price),
        },
      });
    }

    // 8. Return updated
    const updated = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    res.json(updated);
  } catch (error) {
    console.log("UPDATE PRODUCT ERROR:", error);
    res.status(500).json({ message: "Failed to update product", error });
  }
});

app.delete("/products/:id", async (req, res) => {
  try {
    await prisma.product.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete product", error });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            variant: true,
          },
          orderBy: {
            product: {
              name: "asc",
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(orders);
  } catch (error) {
    console.log("GET ORDERS ERROR:", error);
    res.status(500).json({ message: "Failed to get orders", error });
  }
});

app.get("/version", (req, res) => {
  res.json({
    version: "orders-fix-v2",
    time: new Date().toISOString(),
  });
});

app.post("/devices/push-token", publicEndpointLimiter, async (req, res) => {
  const { token, platform, deviceLabel } = req.body || {};

  if (!isNonEmptyString(token) || !expoPushTokenPattern.test(token) || !isNonEmptyString(platform)) {
    return res.status(400).json({ message: "A valid Expo token and platform are required" });
  }

  if (deviceLabel !== undefined && typeof deviceLabel !== "string") {
    return res.status(400).json({ message: "deviceLabel must be a string" });
  }

  try {
    await prisma.devicePushToken.upsert({
      where: { token },
      create: { token, platform: platform.trim(), deviceLabel: deviceLabel?.trim() || null, active: true },
      update: { platform: platform.trim(), deviceLabel: deviceLabel?.trim() || null, active: true },
    });
    res.status(204).send();
  } catch (error) {
    console.error("REGISTER PUSH TOKEN ERROR:", error);
    res.status(500).json({ message: "Failed to register push token" });
  }
});

app.post("/website-orders", publicEndpointLimiter, async (req, res) => {
  const apiKey = process.env.WEBSITE_POS_API_KEY;
  if (!apiKey || req.get("authorization") !== `Bearer ${apiKey}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const parsed = parseWebsiteOrder(req.body);
  if ("error" in parsed) {
    return res.status(400).json({ message: parsed.error });
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const variantIds = parsed.value.items.map((item) => item.variantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: { product: true },
      });
      const variantsById = new Map(variants.map((variant) => [variant.id, variant]));

      const pricedItems = parsed.value.items.map((item) => {
        const variant = variantsById.get(item.variantId);
        if (!variant || variant.productId !== item.productId || !variant.product.isActive) {
          throw new Error("INVALID_WEBSITE_ORDER_ITEM");
        }
        return { ...item, price: variant.price, total: variant.price * item.quantity };
      });

      const subtotal = pricedItems.reduce((sum, item) => sum + item.total, 0);
      const customer = await tx.customer.create({
        data: {
          name: parsed.value.customerName,
          email: parsed.value.customerEmail,
          contact: parsed.value.customerPhone,
          address: parsed.value.customerAddress,
          platform: "WEBSITE",
        },
      });

      return tx.order.create({
        data: {
          invoiceNo: generateInvoiceNo(),
          customerId: customer.id,
          customerName: parsed.value.customerName,
          customerPhone: parsed.value.customerPhone,
          customerAddress: parsed.value.customerAddress,
          platform: "WEBSITE",
          deliveryAt: parsed.value.deliveryAt,
          paymentMethod: parsed.value.paymentMethod,
          paymentStatus: "UNPAID",
          orderStatus: "PENDING",
          subtotal,
          discount: 0,
          deliveryFee: 0,
          total: subtotal,
          notes: parsed.value.notes,
          items: { create: pricedItems },
        },
        select: { id: true, invoiceNo: true, paymentStatus: true, orderStatus: true, subtotal: true, total: true },
      });
    });

    void sendWebsiteOrderNotification({ ...order, customerName: parsed.value.customerName });
    res.status(201).json(order);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_WEBSITE_ORDER_ITEM") {
      return res.status(400).json({ message: "One or more items are unavailable" });
    }
    console.error("CREATE WEBSITE ORDER ERROR:", error);
    res.status(500).json({ message: "Failed to create website order" });
  }
});

function generateInvoiceNo() {
  return "INV-" + Date.now().toString(36).toUpperCase();
}

app.post("/orders", async (req, res) => {
  try {
    const {
      customerId,
      customerName,
      customerPhone,
      customerAddress,
      platform,
      deliveryAt,
      paymentMethod = "GCASH",
      paymentStatus = "PAID",
      discount = 0,
      deliveryFee = 0,
      notes,
      items,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Items are required" });
    }

    if (items.some((item: any) => !isNonEmptyString(item?.productId) || !isNonEmptyString(item?.variantId))) {
      return res.status(400).json({ message: "Each item requires a productId and variantId" });
    }

    let finalCustomerId = customerId;

    if (!finalCustomerId && customerName) {
      const customer = await prisma.customer.create({
        data: {
          name: customerName,
          contact: customerPhone,
          address: customerAddress,
          platform,
        },
      });

      finalCustomerId = customer.id;
    }

    const subtotal = items.reduce(
      (sum: number, item: any) =>
        sum + Number(item.price) * Number(item.quantity),
      0,
    );

    const total = subtotal - Number(discount) + Number(deliveryFee);

    const order = await prisma.order.create({
      data: {
        invoiceNo: generateInvoiceNo(),
        customerId: finalCustomerId,
        customerName,
        customerPhone,
        customerAddress,
        platform,
        deliveryAt: deliveryAt ? new Date(deliveryAt) : null,
        paymentMethod,
        paymentStatus,
        subtotal,
        discount: Number(discount),
        deliveryFee: Number(deliveryFee),
        total,
        notes,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.price) * Number(item.quantity),
          })),
        },
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    });

    res.json(order);
  } catch (error: any) {
    console.error("CREATE ORDER ERROR:", error);

    res.status(500).json({
      message: "Failed to create order",
      error: error.message,
      code: error.code,
      meta: error.meta,
    });
  }
});

async function recalculateOrder(orderId: string) {
  const items = await prisma.orderItem.findMany({ where: { orderId } });

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);

  return prisma.order.update({
    where: { id: orderId },
    data: {
      subtotal,
      total: subtotal,
    },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });
}

app.patch("/orders/:orderId/items/:itemId", async (req, res) => {
  try {
    const { orderId, itemId } = req.params;
    const { quantity, price } = req.body;

    await prisma.orderItem.update({
      where: { id: itemId },
      data: {
        quantity: Number(quantity),
        price: Number(price),
        total: Number(quantity) * Number(price),
      },
    });

    const order = await recalculateOrder(orderId);
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: "Failed to update item", error });
  }
});

app.delete("/orders/:orderId/items/:itemId", async (req, res) => {
  try {
    const { orderId, itemId } = req.params;

    await prisma.orderItem.delete({
      where: { id: itemId },
    });

    const order = await recalculateOrder(orderId);
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: "Failed to delete item", error });
  }
});

app.post("/orders/:orderId/items", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { productId, variantId, quantity, price } = req.body;

    if (!isNonEmptyString(productId) || !isNonEmptyString(variantId)) {
      return res.status(400).json({ message: "productId and variantId are required" });
    }

    await prisma.orderItem.create({
      data: {
        orderId,
        productId,
        variantId,
        quantity: Number(quantity),
        price: Number(price),
        total: Number(quantity) * Number(price),
      },
    });

    const order = await recalculateOrder(orderId);
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: "Failed to add item", error });
  }
});

app.delete("/orders/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    await prisma.order.delete({
      where: { id: orderId },
    });

    res.json({ message: "Invoice deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete invoice", error });
  }
});

app.get("/reports/today", async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
        orderStatus: {
          not: "CANCELLED",
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
    const totalOrders = orders.length;

    const productsSold: Record<string, number> = {};

    orders.forEach((order) => {
      order.items.forEach((item) => {
        productsSold[item.product.name] =
          (productsSold[item.product.name] || 0) + item.quantity;
      });
    });

    res.json({
      totalSales,
      totalOrders,
      productsSold,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get report", error });
  }
});

app.get("/customers", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { contact: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
              { platform: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      include: {
        orders: {
          include: {
            items: {
              include: {
                product: true,
                variant: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      take: search ? 8 : undefined,
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: "Failed to get customers", error });
  }
});

app.post("/customers", async (req, res) => {
  try {
    const { name, contact, address, platform } = req.body;

    const customer = await prisma.customer.create({
      data: {
        name,
        contact,
        address,
        platform,
      },
    });

    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to create customer", error });
  }
});

// GET all customers + search
app.get("/customers", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { contact: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
      include: {
        orders: {
          include: {
            items: {
              include: {
                product: true,
                variant: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: "Failed to get customers", error });
  }
});

// GET one customer history
app.get("/customers/:id", async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        orders: {
          include: {
            items: {
              include: {
                product: true,
                variant: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to get customer", error });
  }
});

// UPDATE customer
app.patch("/customers/:id", async (req, res) => {
  try {
    const { name, contact, address, platform } = req.body;

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: { name, contact, address, platform },
    });

    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to update customer", error });
  }
});

// DELETE customer
app.delete("/customers/:id", async (req, res) => {
  try {
    await prisma.customer.delete({
      where: { id: req.params.id },
    });

    res.json({ message: "Customer deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete customer", error });
  }
});

export { app, parseWebsiteOrder };

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`API running on http://0.0.0.0:${PORT}`);
  });
}
