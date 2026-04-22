
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS headers to allow requests from the frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Helper: Verify Basic Auth
      async function authenticate(req) {
        const auth = req.headers.get('Authorization');
        if (!auth || !auth.startsWith('Basic ')) return null;

        try {
          const base64 = auth.split(' ')[1];
          const decoded = atob(base64);
          const [user, pass] = decoded.split(':');

          const usersJson = await env.SMS_METADATA.get('USERS');
          const users = usersJson ? JSON.parse(usersJson) : {};

          // Bootstrap: Always allow admin:admin for recovery/setup
          if (user === 'admin' && pass === 'admin') return 'admin';

          // If no users exist, allow admin:admin (redundant but keeps logic clear)
          if (Object.keys(users).length === 0) {
            if (user === 'admin' && pass === 'admin') return 'admin';
            return null;
          }

          const userData = users[user];
          if (!userData) return null;

          // Handle legacy (string) and new (object) formats
          const storedPass = typeof userData === 'object' ? userData.password : userData;

          if (storedPass === pass) return user;
          return null;
        } catch (e) { return null; }
      }

      // 1. Authentication Endpoint
      if (url.pathname === '/api/me') {
        const user = await authenticate(request);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ email: user }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 2. Metadata Endpoint (POST)
      if (url.pathname === '/api/meta' && method === 'POST') {
        const user = await authenticate(request);
        if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const data = await request.json();
        const { messageSid, color } = data; // user comes from auth now

        if (!messageSid) {
          return new Response('Missing required fields', { status: 400, headers: corsHeaders });
        }

        await env.SMS_METADATA.put(messageSid, JSON.stringify({ user, color }));

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 3.5 Metadata Batch Endpoint (POST) - Admin Only for Sync
      if (url.pathname === '/api/meta/batch' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        // Check admin
        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};
        const userRole = users[currentUser]?.role || 'User';

        if (currentUser !== 'admin' && userRole !== 'Admin') {
          return new Response('Forbidden', { status: 403, headers: corsHeaders });
        }

        const batchData = await request.json(); // Expect object { sid: { user, color }, ... }

        if (!batchData || Object.keys(batchData).length === 0) {
          return new Response(JSON.stringify({ success: true, count: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Process in chunks of 128 (KV write limit is high but good to be safe, actually put is 1 by 1)
        // We have to do individual puts. KV doesn't support batch put.
        // We can use Promise.all with concurrency limit if needed, but for now simple Promise.all

        const entries = Object.entries(batchData);
        // Limit to 1000 at a time to avoid timeout
        const chunks = [];
        for (let i = 0; i < entries.length; i += 50) {
          chunks.push(entries.slice(i, i + 50));
        }

        let count = 0;
        for (const chunk of chunks) {
          await Promise.all(chunk.map(async ([sid, meta]) => {
            await env.SMS_METADATA.put(sid, JSON.stringify(meta));
          }));
          count += chunk.length;
        }

        return new Response(JSON.stringify({ success: true, count }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 3. Metadata Endpoint (GET)
      if (url.pathname === '/api/meta' && method === 'GET') {
        // Optional: Require auth to read metadata? Let's say yes for security.
        const user = await authenticate(request);
        if (!user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const sids = url.searchParams.get('sids')?.split(',') || [];
        const results = {};

        await Promise.all(sids.map(async (sid) => {
          const meta = await env.SMS_METADATA.get(sid);
          if (meta) {
            results[sid] = JSON.parse(meta);
          }
        }));

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 4. User Management (Simple)
      // GET /api/users - List users
      if (url.pathname === '/api/users' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};

        // Return list of users with details (exclude passwords)
        const userList = Object.keys(users).map(u => {
          const userData = users[u];
          // Handle legacy format (string password) vs new format (object)
          if (typeof userData === 'object') {
            return {
              username: u,
              role: userData.role || 'User',
              color: userData.color || '#667eea', // Default purple
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

        return new Response(JSON.stringify({ users: userList }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/users { username, password, role, color, company } - Add/Update user
      if (url.pathname === '/api/users' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const { username, password, role, color, company } = await request.json();
        if (!username) return new Response('Missing username', { status: 400, headers: corsHeaders });

        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};

        // Check if user exists
        const existingUser = users[username];

        // If new user, password is required
        if (!existingUser && !password) {
          return new Response('Password required for new user', { status: 400, headers: corsHeaders });
        }

        // Determine password to save
        let passwordToSave = password;
        if (!password && existingUser) {
          // Keep existing password
          passwordToSave = typeof existingUser === 'object' ? existingUser.password : existingUser;
        }

        // Store as object
        users[username] = {
          password: passwordToSave,
          role: role || (existingUser && existingUser.role) || 'User',
          color: color || (existingUser && existingUser.color) || '#667eea',
          company: company || (existingUser && existingUser.company) || ''
        };

        await env.SMS_METADATA.put('USERS', JSON.stringify(users));

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // DELETE /api/users?username=... - Delete user
      if (url.pathname === '/api/users' && method === 'DELETE') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const targetUser = url.searchParams.get('username');
        if (!targetUser) return new Response('Missing username', { status: 400, headers: corsHeaders });

        // Prevent deleting yourself
        if (targetUser === currentUser) {
          return new Response(JSON.stringify({ error: 'Cannot delete yourself' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};

        if (users[targetUser]) {
          delete users[targetUser];
          await env.SMS_METADATA.put('USERS', JSON.stringify(users));
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 5. Settings Management (Admin Only)
      // POST /api/settings - Save Twilio credentials
      if (url.pathname === '/api/settings' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        // Check if admin - allow if username is 'admin' OR role is 'Admin'
        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};
        const userRole = users[currentUser]?.role || 'User';

        if (currentUser !== 'admin' && userRole !== 'Admin') {
          return new Response('Forbidden: Admin only', { status: 403, headers: corsHeaders });
        }

        const { sid, token, number, company } = await request.json();

        // Store in KV
        const settings = { sid, token, number, company };
        await env.SMS_METADATA.put('SMS_SETTINGS', JSON.stringify(settings));

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // GET /api/settings - Get masked credentials
      if (url.pathname === '/api/settings' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        // Check if admin
        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};
        const userRole = users[currentUser]?.role || 'User';

        if (currentUser !== 'admin' && userRole !== 'Admin') {
          // Return only public settings (company name) for non-admins? 
          // Or just forbid. Let's return company name at least if needed, but for now forbid.
          // Actually, the frontend needs company name for the header.
          // Let's allow everyone to read COMPANY, but only admins to read CREDENTIALS.
          // For simplicity, let's just return company name for everyone, and masked creds for admin.
        }

        const settingsJson = await env.SMS_METADATA.get('SMS_SETTINGS');
        const settings = settingsJson ? JSON.parse(settingsJson) : {};

        const responseData = {
          company: settings.company || ''
        };

        if (currentUser === 'admin' || userRole === 'Admin') {
          responseData.sid = settings.sid ? settings.sid.slice(0, 4) + '...' + settings.sid.slice(-4) : '';
          responseData.token = settings.token ? '●●●●●●●●' : '';
          responseData.number = settings.number || '';
        }

        return new Response(JSON.stringify(responseData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Helper: Manual Base64 implementation
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

      // 6. Send Message Proxy
      if (url.pathname === '/api/send-message' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        const { to, body, mediaUrl, isBulk } = await request.json();

        // Get credentials
        const settingsJson = await env.SMS_METADATA.get('SMS_SETTINGS');
        if (!settingsJson) {
          return new Response(JSON.stringify({ error: 'System not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { sid, token, number } = JSON.parse(settingsJson);

        if (!sid || !token || !number) {
          return new Response(JSON.stringify({ error: 'Missing Twilio configuration' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Prepare Twilio request
        const formData = new URLSearchParams();
        formData.append('To', to);
        formData.append('From', number);
        if (body) formData.append('Body', body);
        if (mediaUrl) formData.append('MediaUrl', mediaUrl);

        // Use manual base64 encoding
        const cleanSid = String(sid).trim();
        const cleanToken = String(token).trim();
        const authHeader = 'Basic ' + base64Encode(`${cleanSid}:${cleanToken}`);

        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cleanSid}/Messages.json`, {
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
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Log metadata
        // Get user color
        const usersJson = await env.SMS_METADATA.get('USERS');
        const users = usersJson ? JSON.parse(usersJson) : {};
        const userColor = users[currentUser]?.color || '#667eea';

        await env.SMS_METADATA.put(twilioData.sid, JSON.stringify({
          user: currentUser,
          color: userColor,
          isBulk: !!isBulk
        }));

        return new Response(JSON.stringify(twilioData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 7. Get Messages Proxy
      if (url.pathname === '/api/messages' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        // Get credentials
        const settingsJson = await env.SMS_METADATA.get('SMS_SETTINGS');
        if (!settingsJson) return new Response('System not configured', { status: 500, headers: corsHeaders });
        const { sid, token } = JSON.parse(settingsJson);
        if (!sid || !token) return new Response('Missing Twilio configuration', { status: 500, headers: corsHeaders });

        // Build Twilio URL
        const cleanSid = String(sid).trim();
        const twilioUrl = new URL(`https://api.twilio.com/2010-04-01/Accounts/${cleanSid}/Messages.json`);

        // Forward allowed query params
        const allowedParams = ['PageSize', 'From', 'To', 'PageToken'];
        allowedParams.forEach(param => {
          const val = url.searchParams.get(param);
          if (val) twilioUrl.searchParams.append(param, val);
        });

        const cleanToken = String(token).trim();
        const authHeader = 'Basic ' + base64Encode(`${cleanSid}:${cleanToken}`);

        const twilioRes = await fetch(twilioUrl.toString(), {
          headers: { 'Authorization': authHeader }
        });

        const data = await twilioRes.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 8. Drivers Endpoint - Shared driver list stored in KV
      // GET /api/drivers - All authenticated users can read
      if (url.pathname === '/api/drivers' && method === 'GET') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const driversJson = await env.SMS_METADATA.get('DRIVER_LIST');
        if (!driversJson) {
          return new Response(JSON.stringify({ drivers: [], teams: [], updatedAt: null, updatedBy: null }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(driversJson, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // POST /api/drivers - Any authenticated user can upload (saves for all users)
      if (url.pathname === '/api/drivers' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

        const { drivers: driverData, teams: teamData } = await request.json();

        if (!Array.isArray(driverData)) {
          return new Response(JSON.stringify({ error: 'Invalid driver data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const payload = {
          drivers: driverData,
          teams: teamData || [],
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser
        };

        await env.SMS_METADATA.put('DRIVER_LIST', JSON.stringify(payload));

        return new Response(JSON.stringify({ success: true, count: driverData.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 9. Test Connection Endpoint
      if (url.pathname === '/api/test-connection' && method === 'POST') {
        const currentUser = await authenticate(request);
        if (!currentUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        const { sid, token } = await request.json();

        if (!sid || !token) {
          return new Response(JSON.stringify({ error: 'Missing SID or Token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const cleanSid = String(sid).trim();
        const cleanToken = String(token).trim();
        const authHeader = 'Basic ' + base64Encode(`${cleanSid}:${cleanToken}`);

        // Fetch account details (lightweight check)
        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cleanSid}.json`, {
          headers: { 'Authorization': authHeader }
        });

        const data = await twilioRes.json();

        if (!twilioRes.ok) {
          return new Response(JSON.stringify({ success: false, error: data.message || 'Authentication Failed' }), {
            status: 200, // Return 200 so frontend can parse the error easily
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, accountName: data.friendly_name }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

    } catch (err) {
      return new Response(err.message, { status: 500, headers: corsHeaders });
    }
  }
};
