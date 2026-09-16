# n8n Workflow Templates for Medusa

Importable n8n workflow JSON files that work with the `n8n-event-forwarder` subscriber.

## How Events Flow

```
Medusa Event (e.g., order.placed)
    │
    ├──→ Redis pub/sub channel: "medusa:events"
    │         └─ n8n Redis Trigger node (real-time)
    │
    └──→ HTTP POST: N8N_WEBHOOK_URL
              └─ n8n Webhook Trigger node (fallback)
```

## Payload Structure

Every event delivered to n8n has this structure:

```json
{
  "event": "order.placed",
  "data": { "id": "order_01ABC..." },
  "timestamp": "2026-09-08T14:48:35.000Z",
  "source": "medusa"
}
```

## Available Workflows

| File | Purpose |
|------|---------|
| `order-notifications.json` | Filters order events → add email/SMS/Slack downstream |
| `inventory-alerts.json` | Filters inventory changes → add low-stock alerts |
| `analytics-event-log.json` | Logs ALL events → add Google Sheets/DB downstream |

## Setup

### 1. Import workflows into n8n
- Go to n8n → Workflows → Import from File
- Import each `.json` file
- Activate the workflows

### 2. Configure Medusa environment variables
Add these to your Coolify Medusa environment:

```env
# The webhook URL from the n8n Webhook Trigger node
N8N_WEBHOOK_URL=http://<n8n-container>:5678/webhook/medusa-events

# Shared secret (set the same value in n8n's header check)
N8N_WEBHOOK_SECRET=your_shared_secret_here
```

### 3. (Optional) Set up Redis Trigger in n8n
For real-time events via Redis pub/sub:
1. Add a **Redis Trigger** node in n8n
2. Connect to the same Redis instance: `redis://redis:6379`
3. Subscribe to channel: `medusa:events`
4. Parse the incoming message as JSON

### 4. Add downstream nodes
Each workflow has a "Format/Extract" node at the end. Connect your
desired actions:
- **SMTP / SendGrid** → send order confirmation emails
- **Twilio** → send SMS notifications
- **Slack** → post to a channel
- **Google Sheets** → log events to a spreadsheet
- **HTTP Request** → forward to any external API
