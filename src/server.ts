import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

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

    res.json({
      todaySales,
      todayOrders: todayOrders.length,
      totalProducts,
      totalCustomers,
      bestSeller,
      productsSold,
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
    res.status(500).json({ message: "Failed to get orders", error });
  }
});

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
      (sum: number, item: any) => sum + item.price * item.quantity,
      0,
    );

    const total = subtotal - discount + deliveryFee;

    const count = await prisma.order.count();
    const invoiceNo = `INV-${String(count + 1).padStart(5, "0")}`;

    const order = await prisma.order.create({
      data: {
        invoiceNo,
        customerId: finalCustomerId,
        customerName,
        customerPhone,
        customerAddress,
        platform,
        deliveryAt: deliveryAt ? new Date(deliveryAt) : null,
        paymentMethod,
        paymentStatus,
        subtotal,
        discount,
        deliveryFee,
        total,
        notes,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            price: item.price,
            total: item.price * item.quantity,
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
    res.status(500).json({ message: "Failed to create order", error });
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

    if (!search) {
      return res.json([]);
    }

    const customers = await prisma.customer.findMany({
      where: {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      take: 8,
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: "Failed to search customers", error });
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

const PORT = process.env.PORT || 5000;

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`API running on http://0.0.0.0:${PORT}`);
});
