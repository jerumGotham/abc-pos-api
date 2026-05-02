-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerAddress" TEXT,
ADD COLUMN     "deliveryAt" TIMESTAMP(3);
