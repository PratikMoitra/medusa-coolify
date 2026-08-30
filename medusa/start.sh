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

# Run migrations only in server/shared mode (not worker)
if [ "${MEDUSA_WORKER_MODE}" != "worker" ]; then
  echo "=== Running DB Migrations (server mode) ==="
  npx medusa db:migrate
  echo "=== Migrations complete ==="
fi

echo "=== Starting: npx medusa start (mode: ${MEDUSA_WORKER_MODE:-shared}) ==="
echo "========================================"
exec npx medusa start
