# UPDATE TO v2.1.1 - CRITICAL FIX

## 🔴 ISSUE FOUND:
Cartwheel sends webhooks to a DIFFERENT path than documented!

**Expected:** `POST /webhook`  
**Actual:** `POST /webhook/order/{orderId}/status?status=accepted&teamId=X`

This is why SMS wasn't sending - the webhooks were getting 404 errors!

---

## ✅ FIXED IN v2.1.1:

1. **Correct webhook path** - Now listens for `/webhook/order/:orderId/status`
2. **Fetches full order data** - Calls Cartwheel API to get complete order details
3. **Better logging** - See exactly what's happening
4. **Handles all Cartwheel statuses** - Maps their status names to our events

---

## 🚀 HOW TO UPDATE:

### Step 1: Open Your Worker
1. Go to Cloudflare Dashboard
2. **Workers & Pages** → `cartwheel-webhook`
3. Click **Quick edit** (or **Edit code**)

### Step 2: Replace ALL Code
1. **Select ALL existing code** (Ctrl+A or Cmd+A)
2. **Delete it**
3. Open `cartwheel-webhook-worker-v2.1.1.js`
4. **Copy ALL the new code**
5. **Paste** into the editor
6. Click **Save and deploy**

### Step 3: That's It!
No other changes needed - all your environment variables and bindings stay the same!

---

## 🧪 TEST IT:

### Test 1: Health Check (Should Still Work)
```
https://cartwheel-webhook.jamiececil.workers.dev/health
```

### Test 2: Accept a Real Order
1. Open Cloudflare logs (Observability → Real-time Logs)
2. Accept a test order in Cartwheel
3. Watch the logs!

**You should now see:**
```
Received webhook: order abc-123, status=accepted, team=Asheville
Fetching order details: https://app2.cartwheel.tech/...
Fetched order abc-123 successfully
Handling order assigned: ORDER001 to John Smith (+1234567890)
Sent order assigned SMS to +1234567890
SMS sent to +1234567890, SID: SM...
Scheduled reminder SMS in 5 minutes
```

**And the driver should receive an SMS!** 📱

---

## 📋 WHAT'S DIFFERENT:

### Old Worker (v2.1.0):
```javascript
if (path === '/webhook' && request.method === 'POST') {
  // Expected full order data in body
  // But Cartwheel doesn't send that!
}
```

### New Worker (v2.1.1):
```javascript
if (path.match(/^\/webhook\/order\/([^\/]+)\/status$/)) {
  // Correct path pattern!
  const orderId = extracted from path;
  const status = from query params;
  
  // Fetch full order details from Cartwheel API
  const order = await fetchOrderDetails(orderId);
  
  // Now process with complete data
  await processWebhook(status, order);
}
```

---

## 🎯 STATUS MAPPING:

Cartwheel sends these status values:
- `accepted` or `assigned` → Triggers "order assigned" SMS
- `ready` or `ready_for_pickup` → Triggers "food ready" SMS
- `picked_up` → Triggers "en route" SMS (if enabled)
- `at_dropoff` → Updates tracking
- `delivered` or `done_delivered` → Completion SMS (if enabled)
- `cancelled` or `done_cancelled` → Cancellation SMS

---

## 🔍 ENHANCED LOGGING:

The new worker logs EVERYTHING:
- ✅ When webhook received
- ✅ What status it contains
- ✅ Fetching order from API
- ✅ Driver phone number
- ✅ SMS sending status
- ✅ Scheduled reminders
- ✅ Conflict detection results

This makes debugging MUCH easier!

---

## ⚡ WHAT HAPPENS NOW:

**When you accept an order:**

1. Cartwheel → `POST /webhook/order/ABC123/status?status=accepted`
2. Worker receives it ✅
3. Worker fetches full order: `GET /jobs/ABC123`
4. Worker extracts driver phone
5. Worker sends SMS immediately 📱
6. Worker schedules reminder for 5 min later ⏰
7. Worker schedules warning for 10 min before delivery ⏱️
8. Worker checks for conflicts 🚨
9. Worker stores order in KV 💾

**All automatic!**

---

## 🐛 TROUBLESHOOTING:

**Still no SMS after update?**

1. Check logs - Do you see "Fetching order details"?
2. Check logs - Do you see "SMS sent to..."?
3. If "Failed to fetch order" → API credentials might be wrong
4. If "Twilio credentials not configured" → Check environment variables
5. If "SMS failed: 401" → Twilio auth token is wrong

**Driver info not in order?**

Check the logs for the full order JSON. If there's no driver object, that means:
- Order isn't actually assigned yet
- Driver data might be in a different field

---

## 💡 NEXT STEPS:

After updating:

1. ✅ Deploy the new worker code
2. ✅ Accept a test order
3. ✅ Verify SMS is received
4. ✅ Check that reminder comes 5 min later
5. ✅ Celebrate! 🎉

Then you're ready for full production use!

---

## 📞 WHAT YOU'LL SEE:

**Driver receives immediately:**
```
🚗 New Delivery Assigned!

Order #12345
Pickup: Joe's Pizza
Dropoff: 123 Main St
Due: 6:30 PM
```

**Driver receives 5 minutes later:**
```
⏰ Reminder: Order #12345

Head to Joe's Pizza soon!
```

**Driver receives 10 min before delivery:**
```
⏱️ 10 Minutes Until Delivery!

Order #12345
Dropoff: 123 Main St
```

**Dispatcher receives if conflict:**
```
🚨 CONFLICT: John Smith has tight schedule!

Order #12344 dropoff: 6:25 PM
Order #12345 pickup: 6:30 PM
Only 5 minutes between!
```

---

## 🎉 YOU'RE ALMOST THERE!

Just update the worker code and test with one order acceptance.

Everything else is already configured and ready to go!
