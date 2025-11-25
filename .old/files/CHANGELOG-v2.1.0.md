# CHANGELOG - Driver SMS Manager v2.1.0

## 🎉 MAJOR UPDATE: Cartwheel Webhook Integration

**Release Date:** November 2025  
**Version:** 2.1.0  
**Previous Version:** 2.0.0

---

## ✨ NEW FEATURES:

### 1. Cartwheel Integration Settings
**Location:** Settings → Cartwheel Integration (NEW TAB)

**What's New:**
- Configure webhook worker URL
- Adjust timer settings:
  - Reminder after accept (default: 5 min)
  - Warning before delivery (default: 10 min)
  - Minimum buffer between orders (default: 15 min)
- Toggle notifications on/off for each event type
- Customize SMS templates with variables
- Set dispatcher phone for conflict alerts
- Save/load configuration from webhook worker

**How to Use:**
1. Open Settings (⚙️ button)
2. Go to "Cartwheel Integration" tab
3. Enter webhook URL: `https://cartwheel-webhook.jamiececil.workers.dev`
4. Customize settings as desired
5. Click "Save Configuration"

---

### 2. Orders Dashboard
**Location:** NEW "Orders" tab (next to Drivers tab)

**What's New:**
- View all active orders across all drivers
- Real-time status updates
- Order timeline and progress
- Conflict warnings highlighted in RED
- Filter by driver, team, or status
- Auto-refresh every 30 seconds

**What You See:**
- Order number
- Driver assigned
- Current status (assigned, picked up, en route, etc.)
- Pickup location
- Dropoff address
- Due time
- Conflict indicators

---

### 3. Color-Coded Driver Status
**Location:** Driver list (enhanced visual indicators)

**Color Meanings:**
- 🟦 **Blue Background** - Order assigned, driver hasn't started yet
- 🟡 **Yellow Background** - Should be heading to pickup location
- 🟠 **Orange Background** - At pickup location/food ready
- 🟢 **Green Background** - Has food, heading to customer
- 🟣 **Purple Background** - At dropoff location
- 🔴 **Red Background + Badge** - CONFLICT! Tight schedule detected
- ⚪ **Gray/White** - No active orders (default)

**Auto-Updates:**
- Colors update automatically every 30 seconds
- Based on real-time order status from webhook worker
- Visual at-a-glance status monitoring

---

### 4. Active Order Count
**Location:** Driver cards (badge overlay)

**What's New:**
- Shows number of active orders per driver
- Badge appears in top-right of driver card
- Example: "📦 2" means driver has 2 active orders
- Helps identify busy drivers quickly

---

### 5. Conflict Detection Display
**Location:** Driver cards + Orders dashboard

**What's New:**
- Red "⚠️ CONFLICT" badge on driver card
- Visual red highlighting
- Shows in Orders tab with details
- Indicates time gap between orders
- Example: "⚠️ Only 8 min between orders"

---

### 6. Real-Time Order Sync
**Location:** Background automatic updates

**What's New:**
- Fetches active orders from webhook worker every 30 seconds
- Updates driver colors automatically
- Refreshes order counts
- Detects new conflicts
- No manual refresh needed (but you can force refresh)

**Endpoints Called:**
- `GET /orders` - All active orders
- `GET /settings` - Current configuration
- `GET /driver/{phone}` - Specific driver orders

---

### 7. Enhanced Settings Panel
**Location:** Settings modal (⚙️ button)

**New Tabs Added:**
1. **Cartwheel Integration** (NEW)
   - Webhook worker URL
   - Timer configuration
   - Notification toggles
   - SMS template customization
   - Dispatcher settings

2. **Appearance** (EXISTING)
   - Theme selection (unchanged)

3. **Driver List** (EXISTING)  
   - Update driver list (Excel import)
   - Clear cache (unchanged)

4. **Signature** (EXISTING)
   - User signature (unchanged)

---

## 🔧 UNDER THE HOOD:

### New JavaScript Functions:
```javascript
// Configuration Management
- loadWebhookConfig()
- saveWebhookConfig()
- fetchWorkerSettings()
- updateWorkerSettings()

// Order Tracking
- fetchActiveOrders()
- updateDriverColors()
- detectConflicts()
- getDriverStatus()

// Auto-Refresh
- startOrderPolling()
- stopOrderPolling()
- refreshOrders()

// Color Coding
- getStatusColor()
- applyDriverColors()
- updateDriverBadges()
```

### New CSS Classes:
```css
.driver-status-blue
.driver-status-yellow
.driver-status-orange
.driver-status-green
.driver-status-purple
.driver-status-red
.driver-status-gray
.conflict-badge
.order-count-badge
.orders-dashboard
.webhook-settings
```

### New LocalStorage Keys:
```javascript
'webhookWorkerUrl' - Webhook worker endpoint
'orderPollingEnabled' - Auto-refresh toggle
'lastOrderFetch' - Last sync timestamp
```

---

## 🐛 BUG FIXES:

### Fixed in v2.1.0:
- Driver list now properly updates after Excel import
- Improved mobile responsiveness for driver cards
- Fixed theme switching persistence
- Better error handling for Twilio API calls
- Resolved blacklist management edge cases

---

## ⚡ PERFORMANCE IMPROVEMENTS:

- Reduced unnecessary re-renders of driver list
- Optimized order fetching (only changed data)
- Lazy loading for order dashboard
- Cached webhook worker responses
- Debounced search functionality

---

## 🔄 MIGRATION FROM v2.0.0:

**No breaking changes!** v2.1.0 is fully backward compatible.

**What's Preserved:**
- ✅ All existing drivers
- ✅ User accounts and roles
- ✅ Conversation history
- ✅ Blacklist
- ✅ Theme preferences
- ✅ Cached data

**What's New (Optional):**
- Cartwheel webhook integration (must configure)
- Order tracking (requires webhook worker)
- Color coding (automatic if webhook configured)

**Migration Steps:**
1. Open v2.1.0
2. Your existing data loads automatically
3. Configure webhook URL in settings (optional)
4. Start using new features!

No data loss, no reset required!

---

## 📱 COMPATIBILITY:

**Tested On:**
- ✅ Chrome 120+
- ✅ Firefox 121+
- ✅ Safari 17+
- ✅ Edge 120+
- ✅ Mobile Chrome (Android)
- ✅ Mobile Safari (iOS)

**PWA Features:**
- ✅ Install as app
- ✅ Offline driver list
- ✅ Background sync (when online)
- ✅ Push notifications (future)

---

## 🚀 WHAT'S COMING IN v2.2.0:

**Planned Features:**
- Analytics dashboard
- Driver performance metrics
- Historical order data
- Advanced reporting
- Multi-language support
- Custom notification rules per driver
- GPS tracking integration (if Cartwheel provides)
- Delivery heatmaps
- Average delivery time calculations

---

## 📝 NOTES:

**Important:**
- Webhook worker must be deployed for full functionality
- Orders tab will be empty until webhook worker is configured
- Color coding requires active orders from Cartwheel
- Test with manual webhook POST before production use

**Recommended Workflow:**
1. Use v2.0.0 features (SMS, bulk messages) immediately
2. Configure webhook integration when ready
3. Monitor Orders tab for real-time updates
4. Adjust settings based on your operation
5. Train team on color-coding system

---

## 🆘 SUPPORT:

**If you need help:**
1. Check the Integration Guide
2. View Cloudflare worker logs
3. Test endpoints manually
4. Review this changelog
5. Check browser console for errors

**Common Issues:**
- "Orders not loading" → Check webhook URL in settings
- "Colors not changing" → Verify webhook worker is receiving events
- "SMS not sending" → Check Twilio credentials in worker
- "Conflicts not detected" → Adjust minimum buffer setting

---

**Upgrade to v2.1.0 today and automate your dispatch operations!** 🎉
