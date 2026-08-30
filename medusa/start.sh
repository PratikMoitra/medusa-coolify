#!/bin/sh
set -e

echo "========================================"
echo "=== MEDUSA STARTUP DIAGNOSTICS ==="
echo "========================================"
echo "Mode:        ${MEDUSA_WORKER_MODE:-shared}"
echo "NODE_ENV:    ${NODE_ENV}"
echo "DATABASE_SSL: ${DATABASE_SSL}"
echo ""

# Test DB and Redis TCP connectivity
node - <<'NODETEST'
const net = require('net');

function testTCP(host, port, label) {
  return new Promise((resolve) => {
    if (!host || host === 'unknown') {
      console.error('  SKIPPED   [' + label + '] could not parse hostname');
      return resolve(false);
    }
    const client = net.createConnection(parseInt(port), host);
    const timer = setTimeout(() => {
      client.destroy();
      console.error('  TIMEOUT   [' + label + '] ' + host + ':' + port + ' (5s)');
      resolve(false);
    }, 5000);
    client.on('connect', () => {
      clearTimeout(timer);
      console.log('  REACHABLE [' + label + '] ' + host + ':' + port);
      client.destroy();
      resolve(true);
    });
    client.on('error', (err) => {
      clearTimeout(timer);
      console.error('  FAILED    [' + label + '] ' + host + ':' + port + ' -> ' + err.message);
      resolve(false);
    });
  });
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';
  const dbMatch = dbUrl.match(/@([^:/]+):?(\d+)?\//);
  const dbHost = dbMatch ? dbMatch[1] : 'unknown';
  const dbPort = dbMatch ? (dbMatch[2] || '5432') : '5432';

  const redisUrl = process.env.REDIS_URL || '';
  const redisMatch = redisUrl.match(/@([^:/]+):?(\d+)?\//);
  const redisHost = redisMatch ? redisMatch[1] : 'unknown';
  const redisPort = redisMatch ? (redisMatch[2] || '6379') : '6379';

  await testTCP(dbHost, dbPort, 'PostgreSQL');
  await testTCP(redisHost, redisPort, 'Redis     ');
}

main().catch(console.error);
NODETEST

echo ""
echo "========================================"

# Server/shared mode: run migrations and seed admin user
if [ "${MEDUSA_WORKER_MODE}" != "worker" ]; then
  echo "=== Running DB Migrations (server mode) ==="
  npx medusa db:migrate
  echo "=== Migrations complete ==="

  # Create admin user if credentials are provided via env vars
  if [ -n "${MEDUSA_ADMIN_EMAIL}" ] && [ -n "${MEDUSA_ADMIN_PASSWORD}" ]; then
    echo "=== Creating/verifying admin user: ${MEDUSA_ADMIN_EMAIL} ==="
    npx medusa user \
      -e "${MEDUSA_ADMIN_EMAIL}" \
      -p "${MEDUSA_ADMIN_PASSWORD}" \
      && echo "=== Admin user created ===" \
      || echo "=== Admin user already exists, skipping ==="
  else
    echo "=== Skipping admin user: MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD not set ==="
  fi
fi

echo "=== Starting: npx medusa start (mode: ${MEDUSA_WORKER_MODE:-shared}) ==="
echo "========================================"
exec npx medusa start
