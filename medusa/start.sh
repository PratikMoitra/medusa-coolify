#!/bin/sh
set -e

echo "========================================"
echo "=== MEDUSA STARTUP DIAGNOSTICS ==="
echo "========================================"
echo "Mode:        ${MEDUSA_WORKER_MODE:-shared}"
echo "NODE_ENV:    ${NODE_ENV}"
echo "DATABASE_SSL: ${DATABASE_SSL}"

# Extract DB host from DATABASE_URL
DB_URL="${DATABASE_URL}"
DB_HOST=$(echo "$DB_URL" | sed 's|.*@||' | sed 's|:.*||')
DB_PORT=$(echo "$DB_URL" | sed 's|.*@[^:]*:||' | sed 's|/.*||')
DB_PORT="${DB_PORT:-5432}"

echo ""
echo "=== Connectivity Tests ==="
echo "DB  host: ${DB_HOST}:${DB_PORT}"

# Test DB TCP connectivity using Node (avoids needing nc/netcat)
node - <<'NODETEST'
const net = require('net');

function testTCP(host, port, label) {
  return new Promise((resolve) => {
    const client = net.createConnection(parseInt(port), host);
    const timer = setTimeout(() => {
      client.destroy();
      console.error('  TIMEOUT  [' + label + '] ' + host + ':' + port + ' (5s)');
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
  // Parse DATABASE_URL
  const dbUrl = process.env.DATABASE_URL || '';
  const dbMatch = dbUrl.match(/@([^:/]+):?(\d+)?\//) ;
  const dbHost = dbMatch ? dbMatch[1] : 'unknown';
  const dbPort = dbMatch ? (dbMatch[2] || '5432') : '5432';

  // Parse REDIS_URL
  const redisUrl = process.env.REDIS_URL || '';
  const redisMatch = redisUrl.match(/@([^:/]+):?(\d+)?\//);
  const redisHost = redisMatch ? redisMatch[1] : 'unknown';
  const redisPort = redisMatch ? (redisMatch[2] || '6379') : '6379';

  const dbOk = await testTCP(dbHost, dbPort, 'PostgreSQL');
  const redisOk = await testTCP(redisHost, redisPort, 'Redis');

  if (!dbOk || !redisOk) {
    console.error('\n  One or more services are unreachable. Starting Medusa anyway...\n');
  } else {
    console.log('\n  All services reachable. Starting Medusa...\n');
  }
}

main().catch(console.error);
NODETEST

echo "========================================"
echo "=== Starting: npx medusa start"
echo "========================================"
exec npx medusa start
