# Medusa v2 API Reference Notes

## Order Module (`Modules.ORDER`)

### retrieveOrder(id, config)
**Valid relations:**
- `items` — line items
- `shipping_address` — shipping address
- `billing_address` — billing address
- `shipping_methods` — shipping methods
- `summary` — order summary
- `items.tax_lines` — nested tax lines
- `shipping_methods.tax_lines` — nested tax lines

**NOT valid relations:**
- ❌ `sales_channel` — NOT a relation, but `sales_channel_id` IS a direct property on the order
- ❌ `customer` — NOT a relation on the order module entity
- ❌ `refunds` — NOT a relation on the order module entity

### Event Payloads
All event payloads contain only `{ id: string }`. You must retrieve the full entity using the module service.

### Sales Channel from Order
```typescript
// sales_channel_id is a direct property on the order
const order = await orderService.retrieveOrder(orderId)
const salesChannelId = order.sales_channel_id

// To get the full sales channel, use the Sales Channel module
const scModule = container.resolve(Modules.SALES_CHANNEL)
const channel = await scModule.retrieveSalesChannel(salesChannelId)
console.log(channel.name) // "Chamkiley Store"
```

### Module Isolation Principle
Modules are isolated in Medusa v2. You cannot eager-load entities from other modules as relations.
- Order → Sales Channel: Use `sales_channel_id` + `Modules.SALES_CHANNEL`
- Order → Fulfillment: Use link modules or separate queries
- Fulfillment → Order: Use `order_id` from fulfillment data
