#!/bin/bash

# Script de teste para enviar webhook de venda fechada

echo "🚀 Testando webhook de venda fechada..."
echo ""

curl -X POST http://localhost:3002/webhooks \
  -H "Content-Type: application/json" \
  -d @examples/webhook-venda-fechada.json \
  --verbose

echo ""
echo ""
echo "✅ Requisição enviada!"
echo "📊 Verifique os logs com: docker-compose logs -f worker"
echo "📈 Veja estatísticas em: http://localhost:3002/webhooks/stats"
