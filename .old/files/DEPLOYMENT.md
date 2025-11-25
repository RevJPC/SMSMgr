# Cloudflare Worker Deployment Guide

## Step 1: Create KV Namespace

1. Go to Cloudflare Dashboard → Workers & Pages → KV
2. Click "Create a namespace"
3. Name it: `ORDERS_KV`
4. Copy the namespace ID

## Step 2: Create Queue

1. Go to Workers & Pages → Queues
2. Click "Create"
3. Name it: `SMS_QUEUE`
4. Copy the queue name

## Step 3: Deploy Worker

1. Go to Workers & Pages
2. Create new Worker: `cartwheel-webhook-notifier`
3. Paste the code from `cartwheel-webhook-worker.js`
4. Click "Deploy"

## Step 4: Configure Bindings

In your worker settings:

### KV Namespace Binding:
- Variable name: `ORDERS_KV`
- KV namespace: Select the one you created

### Queue Binding:
- Variable name: `SMS_QUEUE`
- Queue: Select the one you created

### Environment Variables (Secrets):
Add these in Settings → Variables → Environment Variables:

- `TWILIO_ACCOUNT_SID` = Your Twilio Account SID
- `TWILIO_AUTH_TOKEN` = Your Twilio Auth Token  
- `TWILIO_PHONE_NUMBER` = Your Twilio Phone Number (E.164 format)

## Step 5: Get Your Webhook URL

Your webhook URL will be:
```
https://cartwheel-webhook-notifier.YOUR-SUBDOMAIN.workers.dev/webhook
```

## Step 6: Register with Cartwheel

Email Cartwheel support to register your webhook:
- **To:** support@cartwheel.tech
- **Subject:** Webhook Registration Request
- **Body:**
  ```
  Hello,
  
  Please register the following webhook URL for order events:
  
  https://cartwheel-webhook-notifier.YOUR-SUBDOMAIN.workers.dev/webhook
  
  Events needed:
  - order.assigned
  - order.ready_for_pickup
  - order.picked_up
  - order.at_dropoff
  - order.done_delivered
  - order.cancelled
  
  Thank you!
  ```

## Step 7: Test Your Webhook

Test the health endpoint:
```
https://cartwheel-webhook-notifier.YOUR-SUBDOMAIN.workers.dev/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-07T..."
}
```

## API Endpoints Available:

- `POST /webhook` - Receives webhooks from Cartwheel
- `GET /orders` - Get all active orders for all drivers
- `GET /driver/{phone}` - Get orders for specific driver
- `GET /settings` - Get current settings
- `POST /settings` - Update settings
- `GET /health` - Health check

## Default Settings:

```json
{
  "timers": {
    "reminderAfterAccept": 5,
    "warningBeforeDelivery": 10,
    "minimumBufferMinutes": 15
  },
  "notifications": {
    "orderAssigned": true,
    "acceptReminder": true,
    "readyForPickup": true,
    "pickedUp": false,
    "beforeDelivery": true,
    "delivered": false,
    "cancelled": true,
    "conflict": true
  }
}
```

You can customize these from the HTML settings panel once deployed!
