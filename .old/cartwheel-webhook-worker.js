// Cartwheel Webhook Worker v2.1.0
// Features: Order tracking, Conflict detection, Auto-SMS, KV storage

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Webhook endpoint - receives events from Cartwheel
      if (path === '/webhook' && request.method === 'POST') {
        const webhookData = await request.json();
        console.log('Received webhook:', JSON.stringify(webhookData));
        
        await processWebhook(webhookData, env);
        
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Get active orders for all drivers
      if (path === '/orders' && request.method === 'GET') {
        const orders = await getAllActiveOrders(env);
        return new Response(JSON.stringify(orders), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Get orders for specific driver
      if (path.startsWith('/driver/') && request.method === 'GET') {
        const phone = path.split('/')[2];
        const driverOrders = await getDriverOrders(phone, env);
        return new Response(JSON.stringify(driverOrders), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Get/Set settings
      if (path === '/settings') {
        if (request.method === 'GET') {
          const settings = await getSettings(env);
          return new Response(JSON.stringify(settings), {
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        if (request.method === 'POST') {
          const newSettings = await request.json();
          await saveSettings(newSettings, env);
          return new Response(JSON.stringify({ saved: true }), {
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }

      // Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ 
          status: 'healthy',
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ 
        error: error.message,
        stack: error.stack 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // Queue handler for scheduled SMS
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const { phone, text, orderId } = message.body;
        await sendSMS(phone, text, env);
        console.log(`Scheduled SMS sent to ${phone} for order ${orderId}`);
        message.ack();
      } catch (error) {
        console.error('Queue message error:', error);
        message.retry();
      }
    }
  }
};

// ========== WEBHOOK PROCESSING ==========

async function processWebhook(webhookData, env) {
  const { event_type, order, driver } = webhookData;
  const settings = await getSettings(env);
  
  console.log(`Processing: ${event_type} for order ${order?.number}`);

  // Update driver info if present
  if (driver?.phone) {
    await updateDriverInfo(driver, env);
  }

  // Handle different event types
  switch (event_type) {
    case 'order.assigned':
      await handleOrderAssigned(order, driver, settings, env);
      break;
      
    case 'order.ready_for_pickup':
      await handleReadyForPickup(order, driver, settings, env);
      break;
      
    case 'order.picked_up':
      await handlePickedUp(order, driver, settings, env);
      break;
      
    case 'order.at_dropoff':
      await handleAtDropoff(order, driver, settings, env);
      break;
      
    case 'order.done_delivered':
      await handleDelivered(order, driver, settings, env);
      break;
      
    case 'order.cancelled':
      await handleCancelled(order, driver, settings, env);
      break;
  }
}

// ========== ORDER EVENT HANDLERS ==========

async function handleOrderAssigned(order, driver, settings, env) {
  if (!driver?.phone) return;
  
  // Store order in KV
  await storeOrder(order, driver, 'assigned', env);
  
  // Check for conflicts with other orders
  const conflict = await detectConflict(driver.phone, order, env);
  
  if (conflict) {
    // IMMEDIATE SMS for conflict
    const conflictMessage = settings.templates.conflict
      .replace('{order_number}', order.number)
      .replace('{conflict_minutes}', conflict.minutesBetween)
      .replace('{first_order}', conflict.firstOrder.number)
      .replace('{second_order}', conflict.secondOrder.number);
    
    await sendSMS(driver.phone, conflictMessage, env);
    
    // Also notify dispatcher
    if (settings.dispatcherPhone) {
      const dispatcherMsg = `🚨 CONFLICT: ${driver.name} has tight schedule!\n\n` +
        `Order ${conflict.firstOrder.number} dropoff: ${formatTime(conflict.firstOrder.dropoff_time)}\n` +
        `Order ${conflict.secondOrder.number} pickup: ${formatTime(conflict.secondOrder.pickup_time)}\n` +
        `Only ${conflict.minutesBetween} minutes between!`;
      await sendSMS(settings.dispatcherPhone, dispatcherMsg, env);
    }
  } else {
    // Normal assignment - send immediate confirmation
    if (settings.notifications.orderAssigned) {
      const message = settings.templates.orderAssigned
        .replace('{order_number}', order.number)
        .replace('{pickup_name}', order.pickup?.name || 'Restaurant')
        .replace('{dropoff_address}', order.dropoff?.address || 'Customer')
        .replace('{due_time}', formatTime(order.dropoff?.arrive_at));
      
      await sendSMS(driver.phone, message, env);
    }
    
    // Schedule reminder X minutes after assignment
    if (settings.notifications.acceptReminder && settings.timers.reminderAfterAccept > 0) {
      const reminderMessage = settings.templates.acceptReminder
        .replace('{order_number}', order.number)
        .replace('{pickup_name}', order.pickup?.name || 'Restaurant');
      
      await scheduleDelayedSMS(
        driver.phone, 
        reminderMessage, 
        settings.timers.reminderAfterAccept * 60, // minutes to seconds
        order.id,
        env
      );
    }
  }
  
  // Schedule pre-delivery warning
  if (settings.notifications.beforeDelivery && settings.timers.warningBeforeDelivery > 0) {
    const deliveryTime = new Date(order.dropoff?.arrive_at);
    const warningTime = new Date(deliveryTime.getTime() - (settings.timers.warningBeforeDelivery * 60 * 1000));
    const delaySeconds = Math.max(0, (warningTime.getTime() - Date.now()) / 1000);
    
    if (delaySeconds > 0) {
      const warningMessage = settings.templates.beforeDelivery
        .replace('{order_number}', order.number)
        .replace('{minutes}', settings.timers.warningBeforeDelivery)
        .replace('{dropoff_address}', order.dropoff?.address || 'Customer');
      
      await scheduleDelayedSMS(driver.phone, warningMessage, delaySeconds, order.id, env);
    }
  }
}

async function handleReadyForPickup(order, driver, settings, env) {
  if (!driver?.phone) return;
  
  await updateOrderStatus(order.id, 'ready_for_pickup', env);
  
  if (settings.notifications.readyForPickup) {
    const message = settings.templates.readyForPickup
      .replace('{order_number}', order.number)
      .replace('{pickup_name}', order.pickup?.name || 'Restaurant');
    
    await sendSMS(driver.phone, message, env);
  }
}

async function handlePickedUp(order, driver, settings, env) {
  if (!driver?.phone) return;
  
  await updateOrderStatus(order.id, 'picked_up', env);
  
  if (settings.notifications.pickedUp) {
    const message = settings.templates.pickedUp
      .replace('{order_number}', order.number)
      .replace('{dropoff_address}', order.dropoff?.address || 'Customer')
      .replace('{customer_name}', order.dropoff?.customer_name || 'Customer');
    
    await sendSMS(driver.phone, message, env);
  }
}

async function handleAtDropoff(order, driver, settings, env) {
  if (!driver?.phone) return;
  await updateOrderStatus(order.id, 'at_dropoff', env);
}

async function handleDelivered(order, driver, settings, env) {
  if (!driver?.phone) return;
  
  await removeOrder(order.id, env);
  
  if (settings.notifications.delivered) {
    const message = settings.templates.delivered
      .replace('{order_number}', order.number);
    
    await sendSMS(driver.phone, message, env);
  }
}

async function handleCancelled(order, driver, settings, env) {
  if (!driver?.phone) return;
  
  await removeOrder(order.id, env);
  
  if (settings.notifications.cancelled) {
    const message = settings.templates.cancelled
      .replace('{order_number}', order.number);
    
    await sendSMS(driver.phone, message, env);
  }
}

// ========== CONFLICT DETECTION ==========

async function detectConflict(driverPhone, newOrder, env) {
  const settings = await getSettings(env);
  const existingOrders = await getDriverOrders(driverPhone, env);
  
  if (existingOrders.length === 0) return null;
  
  const newPickupTime = new Date(newOrder.pickup?.arrive_at || newOrder.created_at);
  const newDropoffTime = new Date(newOrder.dropoff?.arrive_at);
  
  for (const existing of existingOrders) {
    const existingDropoffTime = new Date(existing.dropoff_time);
    const existingPickupTime = new Date(existing.pickup_time);
    
    // Check: New pickup too soon after existing dropoff
    const minutesBetween = (newPickupTime - existingDropoffTime) / (1000 * 60);
    
    if (minutesBetween < settings.timers.minimumBufferMinutes && minutesBetween > 0) {
      return {
        type: 'tight_schedule',
        minutesBetween: Math.round(minutesBetween),
        firstOrder: existing,
        secondOrder: {
          id: newOrder.id,
          number: newOrder.number,
          pickup_time: newPickupTime.toISOString(),
          dropoff_time: newDropoffTime.toISOString()
        }
      };
    }
    
    // Check: Overlapping time windows
    if (
      (newPickupTime >= existingPickupTime && newPickupTime <= existingDropoffTime) ||
      (newDropoffTime >= existingPickupTime && newDropoffTime <= existingDropoffTime)
    ) {
      return {
        type: 'overlap',
        minutesBetween: 0,
        firstOrder: existing,
        secondOrder: {
          id: newOrder.id,
          number: newOrder.number,
          pickup_time: newPickupTime.toISOString(),
          dropoff_time: newDropoffTime.toISOString()
        }
      };
    }
  }
  
  return null;
}

// ========== KV STORAGE FUNCTIONS ==========

async function storeOrder(order, driver, status, env) {
  const orderData = {
    id: order.id,
    number: order.number,
    driver_phone: driver.phone,
    driver_name: driver.name,
    status: status,
    pickup_name: order.pickup?.name,
    pickup_time: order.pickup?.arrive_at,
    dropoff_address: order.dropoff?.address,
    dropoff_time: order.dropoff?.arrive_at,
    customer_name: order.dropoff?.customer_name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  // Store order by ID
  await env.ORDERS_KV.put(`order:${order.id}`, JSON.stringify(orderData));
  
  // Add to driver's order list
  const driverOrdersKey = `driver_orders:${driver.phone}`;
  const existingOrders = await env.ORDERS_KV.get(driverOrdersKey, 'json') || [];
  existingOrders.push(order.id);
  await env.ORDERS_KV.put(driverOrdersKey, JSON.stringify(existingOrders));
}

async function updateOrderStatus(orderId, status, env) {
  const orderData = await env.ORDERS_KV.get(`order:${orderId}`, 'json');
  if (orderData) {
    orderData.status = status;
    orderData.updated_at = new Date().toISOString();
    await env.ORDERS_KV.put(`order:${orderId}`, JSON.stringify(orderData));
  }
}

async function removeOrder(orderId, env) {
  const orderData = await env.ORDERS_KV.get(`order:${orderId}`, 'json');
  if (orderData) {
    // Remove from driver's order list
    const driverOrdersKey = `driver_orders:${orderData.driver_phone}`;
    const existingOrders = await env.ORDERS_KV.get(driverOrdersKey, 'json') || [];
    const updatedOrders = existingOrders.filter(id => id !== orderId);
    await env.ORDERS_KV.put(driverOrdersKey, JSON.stringify(updatedOrders));
    
    // Delete order
    await env.ORDERS_KV.delete(`order:${orderId}`);
  }
}

async function getDriverOrders(driverPhone, env) {
  const driverOrdersKey = `driver_orders:${driverPhone}`;
  const orderIds = await env.ORDERS_KV.get(driverOrdersKey, 'json') || [];
  
  const orders = [];
  for (const orderId of orderIds) {
    const orderData = await env.ORDERS_KV.get(`order:${orderId}`, 'json');
    if (orderData) {
      orders.push(orderData);
    }
  }
  
  return orders;
}

async function getAllActiveOrders(env) {
  const list = await env.ORDERS_KV.list({ prefix: 'driver_orders:' });
  const allOrders = {};
  
  for (const key of list.keys) {
    const phone = key.name.replace('driver_orders:', '');
    allOrders[phone] = await getDriverOrders(phone, env);
  }
  
  return allOrders;
}

async function updateDriverInfo(driver, env) {
  const driverData = {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    email: driver.email,
    last_seen: new Date().toISOString()
  };
  
  await env.ORDERS_KV.put(`driver:${driver.phone}`, JSON.stringify(driverData));
}

// ========== SETTINGS ==========

async function getSettings(env) {
  const defaultSettings = {
    timers: {
      reminderAfterAccept: 5,        // minutes
      warningBeforeDelivery: 10,     // minutes
      minimumBufferMinutes: 15       // minutes between orders
    },
    notifications: {
      orderAssigned: true,
      acceptReminder: true,
      readyForPickup: true,
      pickedUp: false,
      beforeDelivery: true,
      delivered: false,
      cancelled: true,
      conflict: true
    },
    templates: {
      orderAssigned: '🚗 New Delivery Assigned!\n\nOrder #{order_number}\nPickup: {pickup_name}\nDropoff: {dropoff_address}\nDue: {due_time}',
      acceptReminder: '⏰ Reminder: Order #{order_number}\n\nHead to {pickup_name} soon!',
      readyForPickup: '✅ Food Ready!\n\nOrder #{order_number} is ready at {pickup_name}',
      pickedUp: '📦 En Route to Customer\n\nOrder #{order_number}\nDeliver to: {dropoff_address}\nCustomer: {customer_name}',
      beforeDelivery: '⏱️ {minutes} Minutes Until Delivery!\n\nOrder #{order_number}\nDropoff: {dropoff_address}',
      delivered: '✨ Great Job!\n\nOrder #{order_number} completed! 🎉',
      cancelled: '❌ Order Cancelled\n\nOrder #{order_number} has been cancelled.',
      conflict: '🚨 TIGHT SCHEDULE ALERT!\n\nYou have only {conflict_minutes} minutes between:\n• Order {first_order} dropoff\n• Order {second_order} pickup\n\nDouble check times!'
    },
    dispatcherPhone: null,
    colors: {
      assigned: '#60A5FA',      // Blue
      shouldBeMoving: '#FBBF24', // Yellow
      atPickup: '#FB923C',       // Orange
      hasFood: '#34D399',        // Green
      atDropoff: '#A78BFA',      // Purple
      noOrders: '#9CA3AF',       // Gray
      conflict: '#EF4444'        // Red
    }
  };
  
  const saved = await env.ORDERS_KV.get('settings', 'json');
  return saved || defaultSettings;
}

async function saveSettings(settings, env) {
  await env.ORDERS_KV.put('settings', JSON.stringify(settings));
}

// ========== SMS FUNCTIONS ==========

async function sendSMS(toPhone, message, env) {
  const TWILIO_ACCOUNT_SID = env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = env.TWILIO_PHONE_NUMBER;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.error('Twilio credentials not configured');
    return;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append('To', toPhone);
    formData.append('From', TWILIO_PHONE_NUMBER);
    formData.append('Body', message);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`SMS sent to ${toPhone}, SID: ${data.sid}`);
    } else {
      const errorText = await response.text();
      console.error(`SMS failed: ${response.status} - ${errorText}`);
    }
  } catch (error) {
    console.error('SMS error:', error);
  }
}

async function scheduleDelayedSMS(phone, text, delaySeconds, orderId, env) {
  // Send message to queue for delayed delivery
  await env.SMS_QUEUE.send({
    phone: phone,
    text: text,
    orderId: orderId
  }, {
    delaySeconds: Math.round(delaySeconds)
  });
  
  console.log(`Scheduled SMS to ${phone} in ${delaySeconds} seconds`);
}

// ========== HELPERS ==========

function formatTime(timestamp) {
  if (!timestamp) return 'ASAP';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}
