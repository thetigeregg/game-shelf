#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    host: '0.0.0.0',
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

  if (!options.port || !options.file) {
    throw new Error(
      'Usage: node scripts/pwa-root-ca-server.mjs --port <port> --file <path> [--host <host>] [--route <route>]'
    );
  }

  return options;
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const filePath = path.resolve(options.file);
if (!existsSync(filePath)) {
  console.error(`Root CA file not found: ${filePath}`);
  process.exit(1);
}

const fileBuffer = readFileSync(filePath);
const fileSize = statSync(filePath).size;

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', 'http://gameshelf.local');

  if (requestUrl.pathname === '/') {
    sendText(
      response,
      200,
      `Open http://localhost:${String(options.port)}${options.route} in iPhone Simulator Safari to download the mkcert root CA.\n`
    );
    return;
  }

  if (requestUrl.pathname !== options.route) {
    sendText(response, 404, 'Not found\n');
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'application/x-pem-file',
    'Content-Length': String(fileSize),
    'Cache-Control': 'no-store',
    'Content-Disposition': 'inline; filename="rootCA.pem"',
  });
  response.end(fileBuffer);
});

server.listen(options.port, options.host, () => {
  console.log(
    `mkcert root CA server running at http://localhost:${String(options.port)}${options.route}`
  );
  console.log(`Serving file: ${filePath}`);
});
