"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log("🌱 Seeding Antigua's Menu...");
    // Clear old data
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customer.deleteMany();
    // ======================
    // 🍪 COOKIES
    // ======================
    const cookieVariants = [
        { label: "3s", price: 55 },
        { label: "6s", price: 100 },
        { label: "8s", price: 120 },
        { label: "10s", price: 140 },
    ];
    await prisma.product.create({
        data: {
            name: "Chocolate Chip Cookies",
            category: "COOKIE",
            variants: { create: cookieVariants },
        },
    });
    await prisma.product.create({
        data: {
            name: "Choco-Walnut Cookies",
            category: "COOKIE",
            variants: {
                create: [
                    { label: "3s", price: 65 },
                    { label: "6s", price: 120 },
                    { label: "8s", price: 150 },
                    { label: "10s", price: 180 },
                ],
            },
        },
    });
    await prisma.product.create({
        data: {
            name: "Premium Nutty Cookies",
            category: "COOKIE",
            variants: {
                create: [
                    { label: "3s", price: 75 },
                    { label: "6s", price: 145 },
                    { label: "8s", price: 180 },
                    { label: "10s", price: 215 },
                ],
            },
        },
    });
    await prisma.product.create({
        data: {
            name: "Gooey Smores Cookies",
            category: "COOKIE",
            variants: {
                create: [
                    { label: "3s", price: 70 },
                    { label: "6s", price: 135 },
                    { label: "8s", price: 170 },
                    { label: "10s", price: 200 },
                ],
            },
        },
    });
    // ======================
    // 🎁 MIX BOXES
    // ======================
    await prisma.product.create({
        data: {
            name: "Full Flavor Box of 4",
            category: "COOKIE",
            variants: {
                create: [{ label: "Box", price: 88 }],
            },
        },
    });
    await prisma.product.create({
        data: {
            name: "Full Flavor Box of 8",
            category: "COOKIE",
            variants: {
                create: [{ label: "Box", price: 170 }],
            },
        },
    });
    await prisma.product.create({
        data: {
            name: "Box of 10 Mix Flavors",
            category: "COOKIE",
            variants: {
                create: [
                    { label: "Premium Nutty + Chocolate Chip", price: 200 },
                    { label: "Premium Nutty + Choco-Walnut", price: 215 },
                    { label: "Chocolate Chip + Choco-Walnut", price: 180 },
                    { label: "Smores + Chocolate Chip", price: 200 },
                    { label: "Smores + Choco-Walnut", price: 210 },
                    { label: "Smores + Premium Nutty", price: 230 },
                ],
            },
        },
    });
    // ======================
    // 🍝 PASTA
    // ======================
    await prisma.product.create({
        data: {
            name: "Creamy Tuna Pesto",
            category: "PASTA",
            variants: {
                create: [{ label: "Solo 220g", price: 120 }],
            },
        },
    });
    // ======================
    // 🥭 DESSERTS
    // ======================
    await prisma.product.create({
        data: {
            name: "Mango Tapioca Jelly",
            category: "DESSERT",
            variants: {
                create: [
                    { label: "Small 150ml", price: 40 },
                    { label: "Large 500ml", price: 130 },
                ],
            },
        },
    });
    await prisma.product.create({
        data: {
            name: "Coffee Jelly",
            category: "DESSERT",
            variants: {
                create: [
                    { label: "Small 150ml", price: 40 },
                    { label: "Large 500ml", price: 130 },
                ],
            },
        },
    });
    await prisma.product.create({
        data: {
            name: "Moist Chocolate Cake",
            category: "DESSERT",
            variants: {
                create: [
                    { label: "Small 130ml", price: 90 },
                    { label: "Large 300ml", price: 130 },
                ],
            },
        },
    });
    // ======================
    // 🍝 PASTA
    // ======================
    await prisma.product.create({
        data: {
            name: "Beef & Mushroom Lasagna",
            category: "PASTA",
            variants: {
                create: [
                    { label: "Solo Pan", price: 88 },
                    { label: "Sharing Pan", price: 240 },
                    { label: "Family Pan", price: 480 },
                ],
            },
        },
    });
    // ======================
    // 🍝 PASTA
    // ======================
    await prisma.product.create({
        data: {
            name: "Carbonara",
            category: "PASTA",
            variants: {
                create: [{ label: "Solo 220g", price: 120 }],
            },
        },
    });
    console.log("✅ Antigua's Menu Seeded!");
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
