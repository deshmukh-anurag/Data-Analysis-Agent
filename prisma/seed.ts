import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STORES = [1320, 1750, 2280, 880, 1650];
const SKUS = [
  { sku: "SKU-1001", productClass: 22875, basePrice: 4.99, baseCost: 2.1 },
  { sku: "SKU-1002", productClass: 22875, basePrice: 6.49, baseCost: 2.8 },
  { sku: "SKU-1003", productClass: 41215, basePrice: 12.99, baseCost: 6.5 },
  { sku: "SKU-1004", productClass: 41215, basePrice: 9.99, baseCost: 4.4 },
  { sku: "SKU-1005", productClass: 51820, basePrice: 24.99, baseCost: 12.0 },
  { sku: "SKU-1006", productClass: 51820, basePrice: 19.99, baseCost: 9.0 },
  { sku: "SKU-1007", productClass: 60330, basePrice: 3.49, baseCost: 1.2 },
  { sku: "SKU-1008", productClass: 60330, basePrice: 5.99, baseCost: 2.4 },
];

// Deterministic PRNG so seeded data is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

async function main() {
  console.log("Clearing existing sales_transactions…");
  await prisma.salesTransaction.deleteMany();

  const rand = mulberry32(42);
  const start = new Date(Date.UTC(2021, 10, 1)); // 2021-11-01
  const end = new Date(Date.UTC(2021, 11, 31)); // 2021-12-31
  const dates = daysBetween(start, end);

  const rows: {
    storeNumber: number;
    skuCoded: string;
    productClassCode: number;
    soldDate: Date;
    qtySold: number;
    totalSaleValue: number;
    onPromotion: boolean;
  }[] = [];

  for (const day of dates) {
    for (const store of STORES) {
      // Each store sells a random subset of SKUs per day.
      const skuCount = 3 + Math.floor(rand() * (SKUS.length - 3));
      const shuffled = [...SKUS].sort(() => rand() - 0.5).slice(0, skuCount);

      for (const sku of shuffled) {
        const onPromotion = rand() < 0.25;
        // Promo lifts quantity ~2x and discounts price ~20%.
        const promoQtyLift = onPromotion ? 1.6 + rand() * 0.8 : 1;
        const promoPriceCut = onPromotion ? 0.75 + rand() * 0.1 : 1;
        const qty = Math.max(1, Math.round((2 + rand() * 8) * promoQtyLift));
        const realizedPrice = sku.basePrice * promoPriceCut;
        const totalSaleValue =
          Math.round(qty * realizedPrice * 100) / 100;

        rows.push({
          storeNumber: store,
          skuCoded: sku.sku,
          productClassCode: sku.productClass,
          soldDate: day,
          qtySold: qty,
          totalSaleValue,
          onPromotion,
        });
      }
    }
  }

  console.log(`Inserting ${rows.length} synthetic transactions…`);
  // createMany is the fastest path for Postgres.
  await prisma.salesTransaction.createMany({ data: rows });
  const total = await prisma.salesTransaction.count();
  console.log(`Done. sales_transactions row count: ${total}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
