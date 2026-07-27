// ─────────────────────────────────────────────────────────────────────────────
// SERVIDOR ESTÁTICO LOCAL — Corrientes Web (uso interno del VPS)
//
// Sirve la SPA en public/ atado ÚNICAMENTE a 127.0.0.1 — el sistema operativo
// rechaza cualquier conexión que no venga de la propia máquina, sin importar
// firewall ni reglas de red. No usar 0.0.0.0 acá bajo ningún concepto: eso
// expondría esto a internet a través del mismo VPS.
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const fs = require('fs');
const path = require('path');

// 4200 no es arbitrario: coincide con FRONTEND_URL del backend (.env), que es
// el único origen que su configuración CORS acepta. Si cambiás el puerto acá,
// el navegador va a bloquear las llamadas fetch() por política CORS.
const PORT = 4200;
const HOST = '127.0.0.1'; // loopback únicamente — NO cambiar a 0.0.0.0
const ROOT = path.join(__dirname, 'public');

// Backend local (listener plano de loopback, LOCAL_PORT del .env del backend).
// Las llamadas a /api se reenvían acá server-side: así este server estático se
// comporta igual que cuando el backend sirve la SPA en su propio "/", y el
// navegador ve todo desde el mismo origen (sin problemas de CORS).
const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 4082);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  // Proxy de la API al backend local. Debe ir ANTES del fallback SPA: si no,
  // /api/... caía en el fallback y devolvía index.html con 200, y el cliente
  // parseaba null → "Cannot read properties of null (reading 'accessToken')".
  if (req.url.startsWith('/api/') || req.url === '/api') {
    const proxyReq = http.request(
      { host: API_HOST, port: API_PORT, method: req.method, path: req.url,
        headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` } },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: `Backend no disponible en ${API_HOST}:${API_PORT} (${e.code || e.message})` }));
    });
    req.pipe(proxyReq);
    return;
  }

  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, reqPath);
  // Evitar path traversal fuera de /public
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: cualquier ruta no encontrada sirve index.html
      // (el ruteo real lo hace el hash-router en el cliente)
      fs.readFile(path.join(ROOT, 'index.html'), (err2, indexData) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Corrientes Web (interno) corriendo en http://${HOST}:${PORT} — solo accesible desde esta máquina`);
});
