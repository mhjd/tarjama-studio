#!/bin/sh
set -eu
go test -race -count=1 ./...
go vet ./...
cd /work/web/frontend
npm run build
npm test
