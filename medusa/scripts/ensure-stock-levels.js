/**
 * ensure-stock-levels.js
 * 
 * Runs on every MedusaJS startup (via start.sh) to ensure all inventory items
 * have stock level entries at the default stock location.
 * 
 * This prevents the "Sales channel is not associated with any stock location
 * for variant" error that occurs when WooCommerce-synced products don't have
 * stock levels created.
 * 
 * Environment:
 *   MEDUSA_ADMIN_EMAIL + MEDUSA_ADMIN_PASSWORD — used to authenticate
 *   BACKEND_URL — internal URL (default: http://localhost:9000)
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:9000";
const EMAIL = process.env.MEDUSA_ADMIN_EMAIL;
const PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD;
const DEFAULT_STOCK_QTY = 999;

async function waitForServer(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("MedusaJS server not reachable after 60s");
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.log("[ensure-stock-levels] Skipping: MEDUSA_ADMIN_EMAIL/PASSWORD not set");
    return;
  }

  // Auth
  const authRes = await fetch(`${BACKEND_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!authRes.ok) {
    console.error("[ensure-stock-levels] Auth failed:", await authRes.text());
    return;
  }
  const { token } = await authRes.json();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Get stock locations
  const slRes = await fetch(`${BACKEND_URL}/admin/stock-locations?fields=id,name,*sales_channels&limit=50`, { headers });
  const slData = await slRes.json();
  const stockLocations = slData.stock_locations || [];

  if (stockLocations.length === 0) {
    console.log("[ensure-stock-levels] No stock locations found, skipping");
    return;
  }

  // Use the first stock location (BNR-PICKUP or whatever exists)
  const stockLocation = stockLocations[0];
  console.log(`[ensure-stock-levels] Using stock location: ${stockLocation.name} (${stockLocation.id})`);

  // Ensure stock location is linked to at least one sales channel
  const linkedSCs = stockLocation.sales_channels || [];
  if (linkedSCs.length === 0) {
    console.log("[ensure-stock-levels] Stock location has no sales channels, attempting to link...");
    const scRes = await fetch(`${BACKEND_URL}/admin/sales-channels?limit=50`, { headers });
    const scData = await scRes.json();
    const salesChannels = (scData.sales_channels || []).filter((sc) => !sc.is_disabled);
    
    if (salesChannels.length > 0) {
      await fetch(`${BACKEND_URL}/admin/stock-locations/${stockLocation.id}/sales-channels/batch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ add: salesChannels.map((sc) => sc.id) }),
      });
      console.log(`[ensure-stock-levels] Linked ${salesChannels.length} sales channels`);
    }
  }

  // Paginate through all inventory items and find those missing stock levels
  let offset = 0;
  const limit = 100;
  let totalFixed = 0;
  let totalSkipped = 0;

  while (true) {
    const res = await fetch(
      `${BACKEND_URL}/admin/inventory-items?fields=id,sku,*location_levels&limit=${limit}&offset=${offset}`,
      { headers }
    );
    const data = await res.json();
    const items = data.inventory_items || [];

    if (items.length === 0) break;

    for (const item of items) {
      const levels = item.location_levels || [];
      const hasLevel = levels.some((l) => l.location_id === stockLocation.id);

      if (hasLevel) {
        totalSkipped++;
        continue;
      }

      try {
        const createRes = await fetch(
          `${BACKEND_URL}/admin/inventory-items/${item.id}/location-levels`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              location_id: stockLocation.id,
              stocked_quantity: DEFAULT_STOCK_QTY,
            }),
          }
        );

        if (createRes.ok) {
          totalFixed++;
        } else {
          console.error(`[ensure-stock-levels] Failed for ${item.sku || item.id}: ${(await createRes.text()).slice(0, 100)}`);
        }
      } catch (e) {
        console.error(`[ensure-stock-levels] Error for ${item.sku || item.id}: ${e.message}`);
      }
    }

    offset += limit;
    if (items.length < limit) break;
  }

  if (totalFixed > 0) {
    console.log(`[ensure-stock-levels] ✅ Created ${totalFixed} stock levels (${totalSkipped} already existed)`);
  } else {
    console.log(`[ensure-stock-levels] All ${totalSkipped} inventory items already have stock levels`);
  }
}

main().catch((e) => {
  console.error("[ensure-stock-levels] Error:", e.message);
  // Don't exit with error — this is non-critical for startup
});
