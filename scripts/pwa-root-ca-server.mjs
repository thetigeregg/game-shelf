#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function validateTcpPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function getDisplayHost(host) {
  return host && host !== '0.0.0.0' ? host : 'localhost';
}

export function parseArgs(argv) {
  const options = {
    host: '127.0.0.1',
    route: '/rootCA.pem',
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
      if (!/^\d+$/.test(nextValue)) {
        throw new Error(
          `Invalid port "${nextValue}". Port must be an integer between 1 and 65535.`
        );
      }

      options.port = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }

    if (argument === '--file' && nextValue) {
      options.file = nextValue;
      index += 1;
      continue;
    }

    if (argument === '--route' && nextValue) {
      options.route = nextValue.startsWith('/') ? nextValue : `/${nextValue}`;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }

  if (typeof options.port === 'undefined' || !options.file) {
    throw new Error(
      'Usage: node scripts/pwa-root-ca-server.mjs --port <port> --file <path> [--host <host>] [--route <route>]'
    );
  }

  if (!validateTcpPort(options.port)) {
    throw new Error(
      `Invalid port "${String(options.port)}". Port must be an integer between 1 and 65535.`
    );
  }

  return options;
}

export function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

export function createHandler({ host, port, route, fileBuffer, fileSize }) {
  return (request, response) => {
    const method = request.method ?? 'GET';
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://gameshelf.local');
    } catch {
      sendText(response, 400, 'Bad request\n');
      return;
    }

    if (!['GET', 'HEAD'].includes(method)) {
      sendText(response, 405, 'Method not allowed\n');
      return;
    }

    if (requestUrl.pathname === '/') {
      const instruction = `Open http://${getDisplayHost(host)}:${String(port)}${route} in iPhone Simulator Safari to download the mkcert root CA.\n`;
      sendText(response, 200, method === 'HEAD' ? '' : instruction);
      return;
    }

    if (requestUrl.pathname !== route) {
      sendText(response, 404, method === 'HEAD' ? '' : 'Not found\n');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'application/x-pem-file',
      'Content-Length': String(fileSize),
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline; filename="rootCA.pem"',
    });
    response.end(method === 'HEAD' ? undefined : fileBuffer);
  };
}

export function createServer(options, serverFactory = http.createServer) {
  const filePath = path.resolve(options.file);

  if (!existsSync(filePath)) {
    throw new Error(`Root CA file not found: ${filePath}`);
  }

  const fileBuffer = readFileSync(filePath);
  const fileSize = statSync(filePath).size;

  return {
    filePath,
    server: serverFactory(
      createHandler({
        host: options.host,
        port: options.port,
        route: options.route,
        fileBuffer,
        fileSize,
      })
    ),
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

  let serverInfo;
  try {
    serverInfo = createServer(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  serverInfo.server.listen(options.port, options.host, () => {
    console.log(
      `mkcert root CA server running at http://${getDisplayHost(options.host)}:${String(options.port)}${options.route}`
    );
    console.log(`Serving file: ${serverInfo.filePath}`);
  });
}
