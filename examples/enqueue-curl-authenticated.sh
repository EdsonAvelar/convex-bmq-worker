#!/bin/bash
# examples/enqueue-curl-authenticated.sh
# Exemplo de como enfileirar job com autenticação usando curl

WORKER_URL="${WORKER_URL:-http://localhost:3002}"
SECRET="${QUEUE_WORKER_SECRET:-408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02}"

echo "🔐 Enfileirando Job Autenticado com HMAC"
echo "========================================"
echo ""
echo "Worker URL: $WORKER_URL"
echo "Secret: ${SECRET:0:20}..."
echo ""

# Payload
PAYLOAD='{
  "jobType": "webhook",
  "tenantId": 123,
  "integrationId": 456,
  "destination": {
    "url": "https://webhook.site/unique-id",
    "method": "POST",
    "body": {
      "test": true,
      "timestamp": '$(date +%s)'
    }
  },
  "callback": {
    "url": "https://your-app.com/api/queue/callback"
  }
}'

# Gerar HMAC signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

echo "📝 Payload:"
echo "$PAYLOAD" | jq
echo ""
echo "🔐 Signature: ${SIGNATURE:0:40}..."
echo ""

# Enviar request autenticado
echo "📤 Enviando request..."
curl -X POST "$WORKER_URL/queue/webhooks/add" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -d "$PAYLOAD" \
  | jq

echo ""
echo "✅ Request enviado!"
echo ""
echo "💡 Para testar sem autenticação (deve falhar):"
echo "   curl -X POST $WORKER_URL/queue/webhooks/add -H 'Content-Type: application/json' -d '{\"tenantId\":123}'"
