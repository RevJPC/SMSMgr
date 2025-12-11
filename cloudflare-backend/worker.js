
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS headers to allow requests from the frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-ID',
    };

    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // HELPER FUNCTIONS
      // ============================================

      // Manual Base64 implementation
      const base64Encode = (str) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let output = '';
        for (let i = 0, length = str.length; i < length; i += 3) {
          const char1 = str.charCodeAt(i);
          const char2 = str.charCodeAt(i + 1);
          const char3 = str.charCodeAt(i + 2);
          output += chars.charAt(char1 >> 2);
          output += chars.charAt(((char1 & 3) << 4) | ((char2 & 0xF0) >> 4));
          output += chars.charAt(Number.isNaN(char2) ? 64 : ((char2 & 15) << 2) | ((char3 & 0xC0) >> 6));
          output += chars.charAt(Number.isNaN(char3) ? 64 : char3 & 63);
        }
        return output;
      };

      // Check if user is admin
      const isAdmin = (username, userRole) => username === 'admin' || userRole === 'Admin';

      // Tenant Helpers
      const getTenantId = (req) => req.headers.get('X-Tenant-ID') || 'default';
      const getScopedKey = (key, tenantId) => `${tenantId}:${key}`;

      // Get Twilio credentials from KV
      const getTwilioCredentials = async (tenantId) => {
        const settingsJson = await env.SMS_METADATA.get(getScopedKey('SMS_SETTINGS', tenantId));
        if (!settingsJson) {
          throw new Error('System not configured');
        }
        const { sid, token, number } = JSON.parse(settingsJson);
        if (!sid || !token) {
          throw new Error('Missing Twilio configuration');
        }
        return {
          sid: String(sid).trim(),
          token: String(token).trim(),
          number
        };
      };

      // Create Twilio auth header
      const createAuthHeader = (sid, token) => 'Basic ' + base64Encode(`${sid}:${token}`);

      // Verify Basic Auth
      async function authenticate(req) {
        const auth = req.headers.get('Authorization');
        if (!auth || !auth.startsWith('Basic ')) return null;

        try {
          const base64 = auth.split(' ')[1];
          const decoded = atob(base64);
          const [user, pass] = decoded.split(':');

          const tenantId = getTenantId(req);
          const usersJson = await env.SMS_METADATA.get(getScopedKey('USERS', tenantId));
          const users = usersJson ? JSON.parse(usersJson) : {};

          // Bootstrap: Always allow admin:admin for recovery/setup
          if (user === 'admin' && pass === 'admin') return 'admin';

          const userData = users[user];
          if (!userData) return null;

          // Handle legacy (string) and new (object) formats
          const storedPass = typeof userData === 'object' ? userData.password : userData;

          if (storedPass === pass) return user;
          return null;
        } catch (e) { return null; }
      }

      // Get users from KV (cached helper)
      const getUsers = async (tenantId) => {
        const usersJson = await env.SMS_METADATA.get(getScopedKey('USERS', tenantId));
        return usersJson ? JSON.parse(usersJson) : {};
      };

      // ============================================
      // ROUTE HANDLERS
      // ============================================

      // 1. Authentication Endpoint
      if (url.pathname === '/api/me') {
        const user = await authenticate(request);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: jsonHeaders
          });
        }
        return new Response(JSON.stringify({ email: user }), {
          headers: jsonHeaders
        });
      }

      // 2. Metadata Endpoint (POST)
      if (url.pathname === '/api/meta' && method === 'POST') {
        const user = await authenticate(request);
        if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const data = await request.json();
        const { messageSid, color } = data;

        if (!messageSid) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: jsonHeaders });
        }

        const tenantId = getTenantId(request);
        await env.SMS_METADATA.put(getScopedKey(messageSid, tenantId), JSON.stringify({ user, color }));

        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      }


      // 3. Metadata Batch Endpoint (POST) - Admin Only
      if (url.pathname === '/api/meta/batch' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const tenantId = getTenantId(request);
        const users = await getUsers(tenantId);
        const userRole = users[currentUser]?.role || 'User';

        if (!isAdmin(currentUser, userRole)) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: jsonHeaders });
        }

        const batchData = await request.json();

        if (!batchData || Object.keys(batchData).length === 0) {
          return new Response(JSON.stringify({ success: true, count: 0 }), { headers: jsonHeaders });
        }

        const entries = Object.entries(batchData);
        const chunks = [];
        for (let i = 0; i < entries.length; i += 50) {
          chunks.push(entries.slice(i, i + 50));
        }

        let count = 0;
        for (const chunk of chunks) {
          await Promise.all(chunk.map(async ([sid, meta]) => {
            await env.SMS_METADATA.put(getScopedKey(sid, tenantId), JSON.stringify(meta));
          }));
          count += chunk.length;
        }

        return new Response(JSON.stringify({ success: true, count }), { headers: jsonHeaders });
      }

      // 4. Metadata Endpoint (GET)
      if (url.pathname === '/api/meta' && method === 'GET') {
        const user = await authenticate(request);
        if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const sids = url.searchParams.get('sids')?.split(',') || [];
        const results = {};
        const tenantId = getTenantId(request);

        await Promise.all(sids.map(async (sid) => {
          const meta = await env.SMS_METADATA.get(getScopedKey(sid, tenantId));
          if (meta) {
            results[sid] = JSON.parse(meta);
          }
        }));

        return new Response(JSON.stringify(results), { headers: jsonHeaders });
      }

      // 5. User Management - GET /api/users
      if (url.pathname === '/api/users' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const tenantId = getTenantId(request);
        const users = await getUsers(tenantId);

        const userList = Object.keys(users).map(u => {
          const userData = users[u];
          if (typeof userData === 'object') {
            return {
              username: u,
              role: userData.role || 'User',
              color: userData.color || '#667eea',
              company: userData.company || ''
            };
          } else {
            return {
              username: u,
              role: 'User',
              color: '#667eea',
              company: ''
            };
          }
        });

        return new Response(JSON.stringify({ users: userList }), { headers: jsonHeaders });
      }

      // 6. User Management - POST /api/users
      if (url.pathname === '/api/users' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const { username, password, role, color, company } = await request.json();
        if (!username) return new Response(JSON.stringify({ error: 'Missing username' }), { status: 400, headers: jsonHeaders });

        const tenantId = getTenantId(request);
        const users = await getUsers(tenantId);
        const existingUser = users[username];

        if (!existingUser && !password) {
          return new Response(JSON.stringify({ error: 'Password required for new user' }), { status: 400, headers: jsonHeaders });
        }

        let passwordToSave = password;
        if (!password && existingUser) {
          passwordToSave = typeof existingUser === 'object' ? existingUser.password : existingUser;
        }

        users[username] = {
          password: passwordToSave,
          role: role || (existingUser && existingUser.role) || 'User',
          color: color || (existingUser && existingUser.color) || '#667eea',
          company: company || (existingUser && existingUser.company) || ''
        };

        await env.SMS_METADATA.put(getScopedKey('USERS', tenantId), JSON.stringify(users));

        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      }


      // 7. User Management - DELETE /api/users
      if (url.pathname === '/api/users' && method === 'DELETE') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const targetUser = url.searchParams.get('username');
        if (!targetUser) return new Response(JSON.stringify({ error: 'Missing username' }), { status: 400, headers: jsonHeaders });

        if (targetUser === currentUser) {
          return new Response(JSON.stringify({ error: 'Cannot delete yourself' }), {
            status: 400,
            headers: jsonHeaders
          });
        }

        const tenantId = getTenantId(request);
        const users = await getUsers(tenantId);

        if (users[targetUser]) {
          delete users[targetUser];
          await env.SMS_METADATA.put(getScopedKey('USERS', tenantId), JSON.stringify(users));
        }

        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      }

      // 8. Settings Management - POST /api/settings
      if (url.pathname === '/api/settings' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const tenantId = getTenantId(request);
        const users = await getUsers(tenantId);
        const userRole = users[currentUser]?.role || 'User';

        if (!isAdmin(currentUser, userRole)) {
          return new Response(JSON.stringify({ error: 'Forbidden: Admin only' }), { status: 403, headers: jsonHeaders });
        }

        const { sid, token, number, company } = await request.json();

        const settings = { sid, token, number, company };
        await env.SMS_METADATA.put(getScopedKey('SMS_SETTINGS', tenantId), JSON.stringify(settings));

        return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
      }

      // 9. Settings Management - GET /api/settings
      if (url.pathname === '/api/settings' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const tenantId = getTenantId(request);
        const users = await getUsers(tenantId);
        const userRole = users[currentUser]?.role || 'User';

        const settingsJson = await env.SMS_METADATA.get(getScopedKey('SMS_SETTINGS', tenantId));
        const settings = settingsJson ? JSON.parse(settingsJson) : {};

        const responseData = {
          company: settings.company || ''
        };

        if (isAdmin(currentUser, userRole)) {
          responseData.sid = settings.sid ? settings.sid.slice(0, 4) + '...' + settings.sid.slice(-4) : '';
          responseData.token = settings.token ? '●●●●●●●●' : '';
          responseData.number = settings.number || '';
        }

        return new Response(JSON.stringify(responseData), { headers: jsonHeaders });
      }

      // 10. Send Message Proxy
      if (url.pathname === '/api/send-message' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const { to, body, mediaUrl, isBulk } = await request.json();

        let credentials;
        const tenantId = getTenantId(request);
        try {
          credentials = await getTwilioCredentials(tenantId);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders });
        }

        const { sid, token, number } = credentials;

        // Prepare Twilio request
        const formData = new URLSearchParams();
        formData.append('To', to);
        formData.append('From', number);
        if (body) formData.append('Body', body);
        if (mediaUrl) formData.append('MediaUrl', mediaUrl);

        const authHeader = createAuthHeader(sid, token);

        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': authHeader
          },
          body: formData
        });

        const twilioData = await twilioRes.json();

        if (!twilioRes.ok) {
          let errorMsg = twilioData.message || 'Twilio Error';
          if (twilioRes.status === 401) {
            errorMsg = 'Twilio Authentication Failed - Check Settings';
          }
          return new Response(JSON.stringify({ error: errorMsg }), {
            status: twilioRes.status,
            headers: jsonHeaders
          });
        }

        // Log metadata
        const users = await getUsers(tenantId);
        const userColor = users[currentUser]?.color || '#667eea';

        await env.SMS_METADATA.put(getScopedKey(twilioData.sid, tenantId), JSON.stringify({
          user: currentUser,
          color: userColor,
          isBulk: !!isBulk
        }));

        return new Response(JSON.stringify(twilioData), { headers: jsonHeaders });
      }

      // 11. Get Messages Proxy
      if (url.pathname === '/api/messages' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        let credentials;
        try {
          const tenantId = getTenantId(request);
          credentials = await getTwilioCredentials(tenantId);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders });
        }

        const { sid, token } = credentials;

        // Build Twilio URL
        const twilioUrl = new URL(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`);

        // Forward allowed query params
        const allowedParams = ['PageSize', 'From', 'To', 'PageToken'];
        allowedParams.forEach(param => {
          const val = url.searchParams.get(param);
          if (val) twilioUrl.searchParams.append(param, val);
        });

        const authHeader = createAuthHeader(sid, token);

        const twilioRes = await fetch(twilioUrl.toString(), {
          headers: { 'Authorization': authHeader }
        });

        const data = await twilioRes.json();
        return new Response(JSON.stringify(data), { headers: jsonHeaders });
      }

      // 12. Make Call Endpoint (Click-to-Call)
      if (url.pathname === '/api/make-call' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const { userPhone, customerPhone } = await request.json();

        if (!userPhone || !customerPhone) {
          return new Response(JSON.stringify({ error: 'Missing phone numbers' }), { status: 400, headers: jsonHeaders });
        }

        let credentials;
        try {
          const tenantId = getTenantId(request);
          credentials = await getTwilioCredentials(tenantId);
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders });
        }

        const { sid, token, number } = credentials;

        // Clean numbers (ensure they have + if needed, Twilio usually handles E.164)
        // For simplicity, we assume frontend provides reasonably formatted numbers or Twilio handles it.

        // TwiML to execute when the Agent answers:
        // Say a message, then Dial the customer.
        // We must encode the TwiML.
        const twiml = `
          <Response>
            <Say>Connecting you to the customer.</Say>
            <Dial callerId="${number}">
              ${customerPhone}
            </Dial>
          </Response>
        `.replace(/\s+/g, ' ').trim(); // Minify slightly

        // Prepare parameters for Calls.json
        const formData = new URLSearchParams();
        formData.append('From', number);       // The number showing up on Agent's phone (Business Line)
        formData.append('To', userPhone);      // The Agent's real phone number
        formData.append('Twiml', twiml);       // Instructions for what to do when Agent answers

        const authHeader = createAuthHeader(sid, token);

        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': authHeader
          },
          body: formData
        });

        const twilioData = await twilioRes.json();

        if (!twilioRes.ok) {
          return new Response(JSON.stringify({ error: twilioData.message || 'Twilio Call Error' }), {
            status: twilioRes.status,
            headers: jsonHeaders
          });
        }

        return new Response(JSON.stringify({ success: true, sid: twilioData.sid }), { headers: jsonHeaders });
      }

      // 13. Test Connection Endpoint
      if (url.pathname === '/api/test-connection' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });

        const { sid, token } = await request.json();

        if (!sid || !token) {
          return new Response(JSON.stringify({ error: 'Missing SID or Token' }), { status: 400, headers: jsonHeaders });
        }

        const cleanSid = String(sid).trim();
        const cleanToken = String(token).trim();
        const authHeader = createAuthHeader(cleanSid, cleanToken);

        // Fetch account details (lightweight check)
        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cleanSid}.json`, {
          headers: { 'Authorization': authHeader }
        });

        const data = await twilioRes.json();

        if (!twilioRes.ok) {
          return new Response(JSON.stringify({ success: false, error: data.message || 'Authentication Failed' }), {
            status: 200, // Return 200 so frontend can parse the error easily
            headers: jsonHeaders
          });
        }

        return new Response(JSON.stringify({ success: true, accountName: data.friendly_name }), {
          headers: jsonHeaders
        });
      }

      // Catch-all: Return 404 for unmatched routes
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: jsonHeaders
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders });
    }
  }
};
