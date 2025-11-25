// Cartwheel Webhook Worker v2.1.1
// UPDATED: Handles Cartwheel's actual webhook format
// Path: /webhook/order/{orderId}/status?status=X&teamId=Y&teamUUID=Z

const CARTWHEEL_API_TOKEN = 'Basic VGFrZW91dENlbnRyYWw6aml5UW5GIUN3Mw==';
const CARTWHEEL_BASE_URL = 'https://app2.cartwheel.tech/app-portal/dynamic/takeoutcentral';

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
      // REAL Cartwheel webhook format: /webhook/order/{orderId}/status
      const webhookMatch = path.match(/^\/webhook\/order\/([^\/]+)\/status$/);
      
      if (webhookMatch && request.method === 'POST') {
        const orderId = webhookMatch[1];
        const status = url.searchParams.get('status');
        const teamId = url.searchParams.get('teamId');
        const teamUUID = url.searchParams.get('teamUUID');
        
        console.log(`Received webhook: order ${orderId}, status=${status}, team=${teamId}`);
        
        // Fetch full order details from Cartwheel API
        const orderDetails = await fetchOrderDetails(orderId, env);
        
        if (orderDetails) {
          // Process the webhook with full order data
          await processWebhook(status, orderDetails, env);
        }
        
        return new Response(JSON.stringify({ received: true, orderId, status }), {
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
        const phone = decodeURIComponent(path.split('/')[2]);
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

      return new Response(JSON.stringify({ 
        error: 'Not found',
        path: path,
        hint: 'Expected /webhook/order/{orderId}/status'
      }), {
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

// ========== FETCH ORDER DETAILS FROM CARTWHEEL ==========

async function fetchOrderDetails(orderId, env) {
  try {
    const url = `${CARTWHEEL_BASE_URL}/jobs/${orderId}`;
    
    console.log(`Fetching order details: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': CARTWHEEL_API_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch order ${orderId}: ${response.status}`);
      return null;
    }

    const orderData = await response.json();
    console.log(`Fetched order ${orderId} successfully`);
    
    return orderData;
    
  } catch (error) {
    console.error(`Error fetching order ${orderId}:`, error);
    return null;
  }
}

// ========== WEBHOOK PROCESSING ==========

async function processWebhook(status, order, env) {
  const settings = await getSettings(env);
  
  console.log(`Processing status: ${status} for order ${order.number || order.id}`);

  // Extract driver info from order
  const driver = order.driver || order.assigned_driver;
  
  if (!driver || !driver.phone) {
    console.log('No driver assigned or no phone number');
    return;
  }

  // Update driver info
  await updateDriverInfo(driver, env);

  // Map Cartwheel status to our event types
  const statusMap = {
    'accepted': 'order.assigned',
    'assigned': 'order.assigned',
    'ready': 'order.ready_for_pickup',
    'ready_for_pickup': 'order.ready_for_pickup',
    'picked_up': 'order.picked_up',
    'at_pickup': 'order.at_pickup',
    'at_dropoff': 'order.at_dropoff',
    'delivered': 'order.done_delivered',
    'done_delivered': 'order.done_delivered',
    'cancelled': 'order.cancelled',
    'done_cancelled': 'order.cancelled'
  };

  const eventType = statusMap[status.toLowerCase()] || status;

  // Handle different statuses
  switch (eventType) {
    case 'order.assigned':
      await handleOrderAssigned(order, driver, settings, env);
      break;
      
    case 'order.ready_for_pickup':
    case 'order.at_pickup':
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
      
    default:
      console.log(`Unhandled status: ${status}`);
  }
}

// ========== ORDER EVENT HANDLERS ==========

async function handleOrderAssigned(order, driver, settings, env) {
  console.log(`Handling order assigned: ${order.number} to ${driver.name} (${driver.phone})`);
  
  // Store order in KV
  await storeOrder(order, driver, 'assigned', env);
  
  // Check for conflicts with other orders
  const conflict = await detectConflict(driver.phone, order, env);
  
  if (conflict) {
    console.log(`CONFLICT DETECTED: ${conflict.minutesBetween} minutes between orders`);
    
    // IMMEDIATE SMS for conflict
    const conflictMessage = settings.templates.conflict
      .replace('{order_number}', order.number || order.id)
      .replace('{conflict_minutes}', conflict.minutesBetween)
      .replace('{first_order}', conflict.firstOrder.number)
      .replace('{second_order}', order.number || order.id);
    
    await sendSMS(driver.phone, conflictMessage, env);
    
    // Also notify dispatcher
    if (settings.dispatcherPhone) {
      const dispatcherMsg = `🚨 CONFLICT: ${driver.name} has tight schedule!\n\n` +
        `Order ${conflict.firstOrder.number} dropoff: ${formatTime(conflict.firstOrder.dropoff_time)}\n` +
        `Order ${order.number} pickup: ${formatTime(order.pickup?.arrive_at)}\n` +
        `Only ${conflict.minutesBetween} minutes between!`;
      await sendSMS(settings.dispatcherPhone, dispatcherMsg, env);
    }
  } else {
    // Normal assignment - send immediate confirmation
    if (settings.notifications.orderAssigned) {
      const message = settings.templates.orderAssigned
        .replace('{order_number}', order.number || order.id)
        .replace('{pickup_name}', order.pickup?.name || order.pickup?.address || 'Restaurant')
        .replace('{dropoff_address}', order.dropoff?.address || 'Customer')
        .replace('{due_time}', formatTime(order.dropoff?.arrive_at));
      
      await sendSMS(driver.phone, message, env);
      console.log(`Sent order assigned SMS to ${driver.phone}`);
    }
    
    // Schedule reminder X minutes after assignment
    if (settings.notifications.acceptReminder && settings.timers.reminderAfterAccept > 0) {
      const reminderMessage = settings.templates.acceptReminder
        .replace('{order_number}', order.number || order.id)
        .replace('{pickup_name}', order.pickup?.name || order.pickup?.address || 'Restaurant');
      
      await scheduleDelayedSMS(
        driver.phone, 
        reminderMessage, 
        settings.timers.reminderAfterAccept * 60,
        order.id,
        env
      );
      
      console.log(`Scheduled reminder SMS in ${settings.timers.reminderAfterAccept} minutes`);
    }
  }
  
  // Schedule pre-delivery warning
  if (settings.notifications.beforeDelivery && settings.timers.warningBeforeDelivery > 0 && order.dropoff?.arrive_at) {
    const deliveryTime = new Date(order.dropoff.arrive_at);
    const warningTime = new Date(deliveryTime.getTime() - (settings.timers.warningBeforeDelivery * 60 * 1000));
    const delaySeconds = Math.max(0, (warningTime.getTime() - Date.now()) / 1000);
    
    if (delaySeconds > 0) {
      const warningMessage = settings.templates.beforeDelivery
        .replace('{order_number}', order.number || order.id)
        .replace('{minutes}', settings.timers.warningBeforeDelivery)
        .replace('{dropoff_address}', order.dropoff?.address || 'Customer');
      
      await scheduleDelayedSMS(driver.phone, warningMessage, delaySeconds, order.id, env);
      console.log(`Scheduled pre-delivery warning in ${Math.round(delaySeconds/60)} minutes`);
    }
  }
}

async function handleReadyForPickup(order, driver, settings, env) {
  await updateOrderStatus(order.id, 'ready_for_pickup', env);
  
  if (settings.notifications.readyForPickup) {
    const message = settings.templates.readyForPickup
      .replace('{order_number}', order.number || order.id)
      .replace('{pickup_name}', order.pickup?.name || order.pickup?.address || 'Restaurant');
    
    await sendSMS(driver.phone, message, env);
    console.log(`Sent ready for pickup SMS to ${driver.phone}`);
  }
}

async function handlePickedUp(order, driver, settings, env) {
  await updateOrderStatus(order.id, 'picked_up', env);
  
  if (settings.notifications.pickedUp) {
    const message = settings.templates.pickedUp
      .replace('{order_number}', order.number || order.id)
      .replace('{dropoff_address}', order.dropoff?.address || 'Customer')
      .replace('{customer_name}', order.dropoff?.customer_name || 'Customer');
    
    await sendSMS(driver.phone, message, env);
    console.log(`Sent picked up SMS to ${driver.phone}`);
  }
}

async function handleAtDropoff(order, driver, settings, env) {
  await updateOrderStatus(order.id, 'at_dropoff', env);
  console.log(`Order ${order.number} - driver at dropoff`);
}

async function handleDelivered(order, driver, settings, env) {
  await removeOrder(order.id, env);
  console.log(`Order ${order.number} delivered, removed from tracking`);
  
  if (settings.notifications.delivered) {
    const message = settings.templates.delivered
      .replace('{order_number}', order.number || order.id);
    
    await sendSMS(driver.phone, message, env);
  }
}

async function handleCancelled(order, driver, settings, env) {
  await removeOrder(order.id, env);
  console.log(`Order ${order.number} cancelled, removed from tracking`);
  
  if (settings.notifications.cancelled) {
    const message = settings.templates.cancelled
      .replace('{order_number}', order.number || order.id);
    
    await sendSMS(driver.phone, message, env);
  }
}

// ========== CONFLICT DETECTION ==========

async function detectConflict(driverPhone, newOrder, env) {
  const settings = await getSettings(env);
  const existingOrders = await getDriverOrders(driverPhone, env);
  
  if (existingOrders.length === 0) return null;
  
  const newPickupTime = new Date(newOrder.pickup?.arrive_at || new Date());
  const newDropoffTime = new Date(newOrder.dropoff?.arrive_at || new Date());
  
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
          number: newOrder.number || newOrder.id,
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
          number: newOrder.number || newOrder.id,
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
    number: order.number || order.id,
    driver_phone: driver.phone,
    driver_name: driver.name,
    status: status,
    pickup_name: order.pickup?.name || order.pickup?.address,
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
  if (!existingOrders.includes(order.id)) {
    existingOrders.push(order.id);
    await env.ORDERS_KV.put(driverOrdersKey, JSON.stringify(existingOrders));
  }
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
    name: driver.name || driver.login,
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
      reminderAfterAccept: 5,
      warningBeforeDelivery: 10,
      minimumBufferMinutes: 15
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
      assigned: '#60A5FA',
      shouldBeMoving: '#FBBF24',
      atPickup: '#FB923C',
      hasFood: '#34D399',
      atDropoff: '#A78BFA',
      noOrders: '#9CA3AF',
      conflict: '#EF4444'
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
      return true;
    } else {
      const errorText = await response.text();
      console.error(`SMS failed: ${response.status} - ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error('SMS error:', error);
    return false;
  }
}

async function scheduleDelayedSMS(phone, text, delaySeconds, orderId, env) {
  try {
    await env.SMS_QUEUE.send({
      phone: phone,
      text: text,
      orderId: orderId
    }, {
      delaySeconds: Math.round(delaySeconds)
    });
    
    console.log(`Scheduled SMS to ${phone} in ${delaySeconds} seconds`);
  } catch (error) {
    console.error('Failed to schedule SMS:', error);
  }
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
