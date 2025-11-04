#!/bin/bash

echo "🧪 Testando webhook com payload correto..."
echo ""

curl -X POST http://localhost:3002/queue/webhooks/add \
  -H "Content-Type: application/json" \
  -d @examples/test-simple.json \
  --verbose

echo ""
echo "✅ Requisição enviada!"
