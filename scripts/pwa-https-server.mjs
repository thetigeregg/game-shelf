#!/usr/bin/env node

import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

function validateTcpPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function getDisplayHost(host) {
  return host && host !== '0.0.0.0' ? host : 'localhost';
}

export function parseArgs(argv) {
  const options = {
    host: '127.0.0.1',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = argv[index + 1];

    if (argument === '--host' && nextValue) {
      options.host = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--port' && nextValue) {
      options.port = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }

    if (argument === '--cert' && nextValue) {
      options.cert = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--key' && nextValue) {
      options.key = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--root' && nextValue) {
      options.root = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--proxy-origin' && nextValue) {
      options.proxyOrigin = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }

  if (
    typeof options.port === 'undefined' ||
    !options.cert ||
    !options.key ||
    !options.root ||
    !options.proxyOrigin
  ) {
    throw new Error(
      'Usage: node scripts/pwa-https-server.mjs --port <port> --cert <cert> --key <key> --root <dir> --proxy-origin <origin> [--host <host>]'
    );
  }

  if (!validateTcpPort(options.port)) {
    throw new Error(
      `Invalid port "${String(options.port)}". Port must be an integer between 1 and 65535.`
    );
  }

  let proxyUrl;
  try {
    proxyUrl = new URL(options.proxyOrigin);
  } catch {
    throw new Error('--proxy-origin must be a valid absolute http(s) URL');
  }

  if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw new Error('--proxy-origin must use the http or https scheme');
  }

  return options;
}

export function resolveSafePath(rootDir, requestPathname) {
  let normalizedPath;
  try {
    normalizedPath = decodeURIComponent(requestPathname).replace(/^\/+/, '');
  } catch (error) {
    if (error instanceof URIError) {
      return { kind: 'bad-request' };
    }

    throw error;
  }

  const resolvedPath = path.resolve(rootDir, normalizedPath || 'index.html');
  const relativePath = path.relative(rootDir, resolvedPath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return { kind: 'forbidden' };
  }

  let resolvedRootDir;
  try {
    resolvedRootDir = realpathSync(rootDir);
  } catch {
    return { kind: 'forbidden' };
  }

  let scopePath = resolvedPath;
  while (!existsSync(scopePath)) {
    const parentPath = path.dirname(scopePath);
    if (parentPath === scopePath) {
      return { kind: 'forbidden' };
    }

    scopePath = parentPath;
  }

  let resolvedScopePath;
  try {
    resolvedScopePath = realpathSync(scopePath);
  } catch {
    return { kind: 'forbidden' };
  }

  const scopeRelativePath = path.relative(resolvedRootDir, resolvedScopePath);
  if (
    scopeRelativePath === '..' ||
    scopeRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(scopeRelativePath)
  ) {
    return { kind: 'forbidden' };
  }

  return { kind: 'ok', path: resolvedPath };
}

export function sendError(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${message}\n`);
}

export function sendFile(filePath, response, method) {
  let fileStat;
  try {
    fileStat = statSync(filePath);
  } catch (error) {
    const statusCode =
      error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500;
    sendError(response, statusCode, statusCode === 404 ? 'Not found' : 'Unable to read file');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES.get(extension) ?? 'application/octet-stream';

  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(fileStat.size),
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
  });

  if (method === 'HEAD') {
    response.end();
    return;
  }

  const fileStream = createReadStream(filePath);
  fileStream.on('error', (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    const statusCode =
      error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 500;
    sendError(response, statusCode, statusCode === 404 ? 'Not found' : 'Unable to read file');
  });
  fileStream.pipe(response);
}

export function proxyRequest(
  request,
  response,
  proxyOrigin,
  { httpTransport = http, httpsTransport = https } = {}
) {
  const requestUrl = request.url ?? '/';

  if (!requestUrl.startsWith('/')) {
    sendError(response, 400, 'Only origin-form URLs are supported by this proxy');
    return;
  }

  if (requestUrl.startsWith('//')) {
    sendError(response, 400, 'Scheme-relative URLs are not supported by this proxy');
    return;
  }

  const baseUrl = new URL(proxyOrigin);
  let targetUrl;
  try {
    targetUrl = new URL(requestUrl, baseUrl);
  } catch {
    sendError(response, 400, 'Invalid request URL');
    return;
  }

  if (targetUrl.origin !== baseUrl.origin) {
    sendError(response, 400, 'Proxy target origin mismatch');
    return;
  }

  const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);
  const proxyHeaders = { host: targetUrl.host };
  for (const [headerName, headerValue] of Object.entries(request.headers)) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (
      typeof headerValue === 'undefined' ||
      normalizedHeaderName === 'host' ||
      hopByHopHeaders.has(normalizedHeaderName)
    ) {
      continue;
    }

    proxyHeaders[headerName] = headerValue;
  }
  const transport = targetUrl.protocol === 'https:' ? httpsTransport : httpTransport;

  const proxyStream = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: request.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: proxyHeaders,
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);

      proxyResponse.on('error', (error) => {
        if (!response.writableEnded) {
          response.destroy(error);
        }
      });

      proxyResponse.on('aborted', () => {
        if (!response.writableEnded) {
          response.destroy();
        }
      });

      proxyResponse.pipe(response);
    }
  );

  proxyStream.on('error', (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    sendError(response, 502, `Upstream proxy request failed: ${error.message}`);
  });

  request.pipe(proxyStream);
}

export function createHandler(rootDir, proxyOrigin) {
  const spaIndexPath = path.join(rootDir, 'index.html');

  return (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'https://gameshelf.local');
    const method = request.method ?? 'GET';

    if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/manuals/')) {
      proxyRequest(request, response, proxyOrigin);
      return;
    }

    if (!['GET', 'HEAD'].includes(method)) {
      sendError(response, 405, 'Method not allowed');
      return;
    }

    const resolvedPath = resolveSafePath(rootDir, requestUrl.pathname);
    if (resolvedPath.kind === 'bad-request') {
      sendError(response, 400, 'Bad request');
      return;
    }

    if (resolvedPath.kind === 'forbidden') {
      sendError(response, 403, 'Forbidden');
      return;
    }

    if (existsSync(resolvedPath.path)) {
      try {
        if (statSync(resolvedPath.path).isFile()) {
          sendFile(resolvedPath.path, response, method);
          return;
        }
      } catch {
        sendError(response, 404, 'Not found');
        return;
      }
    }

    const hasExtension = path.extname(requestUrl.pathname) !== '';
    const acceptHeader =
      request.headers && typeof request.headers.accept === 'string' ? request.headers.accept : '';
    const acceptsHtml = acceptHeader
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .some((value) => value.startsWith('text/html'));
    const shouldFallbackToSpa = !hasExtension || acceptsHtml;

    if (shouldFallbackToSpa && existsSync(spaIndexPath)) {
      sendFile(spaIndexPath, response, method);
      return;
    }

    if (shouldFallbackToSpa) {
      sendError(response, 404, 'Built app not found');
      return;
    }

    sendError(response, 404, 'Not found');
  };
}

export function isEntrypoint({ argv1 = process.argv[1], moduleUrl = import.meta.url } = {}) {
  if (!argv1) {
    return false;
  }

  return pathToFileURL(path.resolve(argv1)).href === moduleUrl;
}

if (isEntrypoint()) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const rootDir = path.resolve(options.root);
  const certPath = path.resolve(options.cert);
  const keyPath = path.resolve(options.key);

  if (!existsSync(rootDir)) {
    console.error(`Static root not found: ${rootDir}`);
    process.exit(1);
  }

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    console.error('HTTPS certificate files are missing.');
    process.exit(1);
  }

  const server = https.createServer(
    {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    },
    createHandler(rootDir, options.proxyOrigin)
  );

  server.listen(options.port, options.host, () => {
    console.log(
      `PWA HTTPS server running at https://${getDisplayHost(options.host)}:${String(options.port)}`
    );
    console.log(`Static root: ${rootDir}`);
    console.log(`Proxy origin: ${options.proxyOrigin}`);
  });
}
