"""Synthetic SMTP mailbox; reachable only inside the isolated test network."""
import asyncore
import email
import json
import smtpd
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

messages = []
lock = threading.Lock()
class Mailbox(smtpd.SMTPServer):
    def process_message(self, peer, mailfrom, rcpttos, data, **kwargs):
        message = email.message_from_bytes(data)
        text = "\n".join(
            p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8")
            for p in message.walk() if p.get_content_type() in ("text/plain", "text/html")
        )
        with lock:
            messages.append({"recipients": rcpttos, "text": text})
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with lock:
            data = json.dumps(messages).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *args):
        pass
Mailbox(("127.0.0.1", 1025), None)
threading.Thread(target=asyncore.loop, daemon=True).start()
HTTPServer(("127.0.0.1", 8025), Handler).serve_forever()
