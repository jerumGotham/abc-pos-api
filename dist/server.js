"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
dotenv_1.default.config();
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
    const productsSold = {};
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
    const incomingWithId = variants.filter((v) => v.id);
    const incomingWithoutId = variants.filter((v) => !v.id);
    const incomingIds = incomingWithId.map((v) => v.id);
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
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
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
          create: items.map((item) => ({
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
          },
        },
      },
    });
    res.json(order);
  } catch (error) {
    console.error("CREATE ORDER ERROR:", error);
    res.status(500).json({
      message: "Failed to create order",
      error: error.message,
      code: error.code,
      meta: error.meta,
    });
  }
});
async function recalculateOrder(orderId) {
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
    const productsSold = {};
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
const PORT = process.env.PORT || 5000;
app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`API running on http://0.0.0.0:${PORT}`);
});
