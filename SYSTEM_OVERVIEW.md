# SMS Manager - System Overview

## Executive Summary

SMS Manager is a multi-tenant web application designed for managing bulk SMS communications with delivery drivers or team members. The system uses Twilio for SMS delivery and features a modern, responsive interface with real-time message tracking, user management, and conversation history.

## Architecture Overview

### Frontend
- **Technology**: Single-page HTML application with vanilla JavaScript
- **Styling**: TailwindCSS with custom glassmorphism design
- **Storage**: Browser localStorage for caching and sessionStorage for authentication
- **Features**: Auto-expanding message input, emoji picker, image attachments, real-time polling

### Backend
- **Platform**: Cloudflare Workers (serverless)
- **Storage**: Cloudflare KV (Key-Value store)
- **API**: RESTful endpoints with Basic Authentication
- **Multi-tenancy**: Subdomain-based tenant isolation

### Third-Party Services
- **Twilio**: SMS/MMS delivery and phone call functionality
- **ImgBB**: Image hosting for MMS attachments

## Multi-Tenancy Architecture

The system supports complete data isolation between different organizations using subdomain-based tenancy:

### Tenant Detection
```
toc.customers.smsmgr.com → Tenant: "toc"
abc.customers.smsmgr.com → Tenant: "abc"
smsmgr.com → Tenant: "default"
```

### Data Isolation
All data is scoped by tenant ID using prefixed keys:
- `{tenant}:SMS_SETTINGS` - Twilio credentials and company settings
- `{tenant}:USERS` - User accounts and roles
- `{tenant}:{messageSid}` - Message metadata (sender, color, bulk flag)

### Benefits
- ✅ Complete data separation between organizations
- ✅ Independent Twilio accounts per tenant
- ✅ Separate user databases
- ✅ No cross-contamination of messages or settings

## Core Features

### 1. User Management
- **Roles**: Admin, Director, Manager, Supervisor, Dispatcher, User
- **Authentication**: Basic Auth with session management
- **Customization**: Per-user color coding and company assignment
- **Admin Controls**: User creation, editing, deletion (admin-only)

### 2. Message Management
- **Individual Messages**: One-on-one conversations with drivers
- **Bulk Messaging**: Send to entire teams or selected drivers
- **Message Templates**: Support for placeholders ({firstName}, {name}, {team})
- **Signatures**: Optional user signatures on messages
- **MMS Support**: Image attachments (up to 5MB)

### 3. Driver Management
- **Excel Import**: Upload driver lists from spreadsheet
- **Team Organization**: Group drivers by team
- **Search & Filter**: Real-time search and multiple sort options
- **Ad-Hoc Contacts**: Add individual contacts on-the-fly
- **Blacklist**: Automatic handling of STOP responses

### 4. Conversation Tracking
- **Message History**: Full conversation threads per driver
- **Color Coding**: Visual identification of message senders
- **Bulk Indicators**: Tag bulk messages for easy identification
- **Timestamps**: Full date/time tracking
- **Media Display**: Inline image viewing

### 5. Real-Time Features
- **Auto-Polling**: Check for new messages every 15 seconds
- **Unread Indicators**: Visual badges for new messages
- **Sound Notifications**: 13 customizable notification sounds
- **Browser Notifications**: Desktop notifications (when permitted)

### 6. Click-to-Call
- **Twilio Integration**: Initiate calls directly from conversations
- **Agent Connection**: Calls agent first, then connects to customer
- **Caller ID**: Business line shows on both ends

## Data Flow

### Sending a Message
1. User composes message in frontend
2. Frontend sends to `/api/send-message` with auth header
3. Worker validates credentials and tenant
4. Worker proxies request to Twilio API
5. Twilio sends SMS and returns message SID
6. Worker stores metadata in KV (sender, color, bulk flag)
7. Frontend updates local conversation cache
8. Message appears in conversation thread

### Receiving Messages (Polling)
1. Frontend polls `/api/messages` every 15 seconds
2. Worker fetches from Twilio API with auth
3. Worker enriches messages with metadata from KV
4. Frontend compares with cached messages
5. New messages trigger notifications
6. Conversation list updates with unread badges

## Security Model

### Authentication
- **Basic Auth**: Username/password encoded in Base64
- **Session Storage**: Auth token stored in browser session
- **Bootstrap Admin**: Default admin/admin for initial setup
- **Password Verification**: Double-entry for admin settings unlock

### Authorization
- **Role-Based**: Admin-only endpoints for settings and user management
- **Tenant Scoping**: All requests include X-Tenant-ID header
- **Credential Protection**: Twilio credentials masked for non-admins

### Data Protection
- **Tenant Isolation**: KV keys prefixed with tenant ID
- **No Cross-Tenant Access**: Impossible to access other tenant's data
- **Secure Proxying**: Frontend never sees Twilio credentials

## API Endpoints

### Authentication
- `GET /api/me` - Verify credentials and get username

### User Management
- `GET /api/users` - List all users (authenticated)
- `POST /api/users` - Create/update user (authenticated)
- `DELETE /api/users?username=X` - Delete user (authenticated)

### Settings
- `GET /api/settings` - Get settings (masked for non-admins)
- `POST /api/settings` - Update settings (admin-only)
- `POST /api/test-connection` - Test Twilio credentials

### Messaging
- `POST /api/send-message` - Send SMS/MMS
- `GET /api/messages` - Fetch message history
- `POST /api/make-call` - Initiate click-to-call

### Metadata
- `POST /api/meta` - Store message metadata
- `GET /api/meta?sids=X,Y,Z` - Fetch metadata for messages
- `POST /api/meta/batch` - Bulk upload metadata (admin-only)

## Configuration

### Environment Variables (Cloudflare KV)
Each tenant has independent configuration:

**SMS_SETTINGS**
```json
{
  "sid": "Twilio Account SID",
  "token": "Twilio Auth Token",
  "number": "+1234567890",
  "company": "Company Name"
}
```

**USERS**
```json
{
  "username": {
    "password": "plaintext",
    "role": "Admin",
    "color": "#667eea",
    "company": "Acme Corp"
  }
}
```

### Frontend Configuration
- `BACKEND_URL`: Auto-detects production vs local
- `TENANT`: Extracted from subdomain
- `env=local`: URL parameter to force local backend

## Deployment

### Backend (Cloudflare Worker)
```powershell
cd cloudflare-backend
npx wrangler deploy
```

### Frontend (Cloudflare Pages)
- Connected to Git repository
- Auto-deploys on push to main branch
- Custom domain: `smsmgr.com`
- Wildcard domain: `*.smsmgr.com`

### Local Development
```powershell
# Backend
cd cloudflare-backend
npx wrangler dev

# Frontend
# Open index.html?env=local in browser
```

## Browser Compatibility

- ✅ Chrome/Edge (Recommended)
- ✅ Firefox
- ✅ Safari
- ⚠️ Mobile browsers (responsive design, limited testing)

## Performance Characteristics

- **Message Polling**: 15-second intervals
- **Batch Size**: 100 messages per fetch
- **Image Limit**: 5MB per MMS
- **Textarea Max Height**: 200px
- **Metadata Batch**: 50 items per chunk
- **KV Storage**: Unlimited (Cloudflare limits apply)

## Future Enhancements

### Planned Features
- [ ] WebSocket support for real-time messages
- [ ] Message scheduling
- [ ] Template library
- [ ] Analytics dashboard
- [ ] Export conversation history
- [ ] Two-factor authentication
- [ ] Mobile app (PWA)

### Known Limitations
- Image upload requires external hosting (ImgBB)
- Local development uses in-memory storage
- No message search across all conversations
- No message editing/deletion
- Polling-based updates (not real-time WebSocket)

## Support & Maintenance

### Monitoring
- Cloudflare Workers analytics
- Twilio console for SMS delivery status
- Browser console for frontend errors

### Troubleshooting
- Check Twilio credentials in settings
- Verify KV namespace binding in wrangler.toml
- Confirm tenant ID matches subdomain
- Review browser console for API errors

### Backup & Recovery
- KV data is automatically replicated by Cloudflare
- Export user data via `/api/users` endpoint
- Conversation history cached in browser localStorage
- No automated backup system (manual export recommended)

## Version History

- **v2.2.0** (Current)
  - Auto-expanding message textarea
  - Shift+Enter for multi-line messages
  - Improved keyboard controls

- **v2.1.0**
  - Multi-tenant support
  - Cloudflare backend migration
  - User management system

- **v2.0.0**
  - Complete UI redesign
  - Bulk messaging
  - Click-to-call

- **v1.0.0**
  - Initial release
  - Basic SMS functionality

---

**Document Version**: 1.0  
**Last Updated**: January 15, 2026  
**Author**: System Documentation
