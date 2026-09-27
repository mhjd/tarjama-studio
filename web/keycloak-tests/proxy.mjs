// Isolated reference router, not a production proxy or an infrastructure change.
// Keep /identity intact. Only OIDC/login pages and assets go to Keycloak.
import http from 'node:http';
const identity = /^\/identity\/(?:realms\/tarjama\/(?:protocol\/openid-connect\/|login-actions\/|\.well-known\/)|resources\/)/;
http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (/[%;\\]/.test(path) || path.includes('//') || path.split('/').some(p => p === '.' || p === '..')) {
    res.writeHead(400).end(); return;
  }
  const isIdentity = path === '/identity' || path.startsWith('/identity/');
  if (isIdentity && !identity.test(path)) { res.writeHead(404).end(); return; }
  const headers = {...req.headers};
  for (const key of Object.keys(headers)) {
    if (key === 'forwarded' || key.startsWith('x-forwarded-')) delete headers[key];
  }
  Object.assign(headers, {'x-forwarded-host':'localhost:8091', 'x-forwarded-port':'8091', 'x-forwarded-proto':'http'});
  const upstream = http.request({host:'127.0.0.1', port:isIdentity?8080:8090, path:req.url, method:req.method, headers}, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.setTimeout(20000, () => upstream.destroy());
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(8091, '127.0.0.1');
