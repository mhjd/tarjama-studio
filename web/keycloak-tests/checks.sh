#!/bin/sh
set -eu
node /work/web/keycloak-tests/proxy.mjs &
proxy=$!
trap 'kill "$proxy" 2>/dev/null || true' EXIT
node --input-type=module - <<'JS'
const end=Date.now()+180000;
while(true) {
  try { const r=await fetch('http://localhost:8091/realms/tarjama/.well-known/openid-configuration', {signal: AbortSignal.timeout(3000)}); if(r.ok)break; } catch {}
  if(Date.now()>end)throw Error('Keycloak did not become ready in 180 seconds');
  await new Promise(r=>setTimeout(r,1000));
}
JS
go run ./cmd/tarjama migrate
cd /work/web/frontend
npm run build
npx playwright test --config ../keycloak-tests/playwright.config.ts
