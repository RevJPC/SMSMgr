#!/usr/bin/env python3
"""
Simple HTTP Server to fix CORS issues with Twilio SMS Manager
Run this script, then open http://localhost:8000 in your browser
"""

import http.server
import socketserver
import os

# Change to the directory where your HTML file is located
# Modify this path to match where your twilio-sms-WORKING.html is located
PORT = 8000

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Twilio SMS Manager - Local Server")
    print("=" * 60)
    print(f"\n✅ Server starting on port {PORT}...")
    print(f"\n📂 Serving files from: {os.getcwd()}")
    print(f"\n🌐 Open your browser and go to:")
    print(f"   http://localhost:{PORT}/twilio-sms-WORKING.html")
    print(f"\n💡 To stop the server, press Ctrl+C")
    print("\n" + "=" * 60 + "\n")
    
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n🛑 Server stopped")
            print("=" * 60)
