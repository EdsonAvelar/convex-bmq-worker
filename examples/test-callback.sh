#!/bin/bash
# examples/test-callback.sh
# Testa o sistema de callbacks com webhook.site

echo "🧪 Testando Sistema de Callbacks"
echo "================================="
echo ""

# Configurações
WORKER_URL="${WORKER_URL:-http://localhost:3002}"
WEBHOOK_SITE="https://webhook.site/unique-id-aqui" # ✅ Substitua pelo seu UUID
CALLBACK_URL="${CALLBACK_URL:-https://seu-app.ngrok.io/api/queue/callback}"

echo "📍 Worker URL: $WORKER_URL"
echo "📍 Webhook Destino: $WEBHOOK_SITE"
echo "📍 Callback URL: $CALLBACK_URL"
echo ""

# Teste 1: Formato NOVO com callback
echo "🔹 Teste 1: Formato NOVO (com callback)"
echo "========================================"
curl -X POST "$WORKER_URL/queue/webhooks/add" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "webhook",
    "tenantId": 123,
    "integrationId": 456,
    "integrationName": "Facebook Conversao",
    "negocioId": 789,
    "destination": {
      "url": "'"$WEBHOOK_SITE"'",
      "method": "POST",
      "headers": {
        "X-Custom-Header": "Test"
      },
      "body": {
        "event_name": "Purchase",
        "event_time": '$(date +%s)',
        "test": true
      }
    },
    "callback": {
      "url": "'"$CALLBACK_URL"'"
    },
    "options": {
      "retries": 3,
      "backoff": 2000
    },
    "metadata": {
      "userId": 55,
      "source": "test_script"
    }
  }' | jq

echo ""
echo "✅ Job enfileirado! Aguarde alguns segundos..."
echo ""

# Teste 2: Formato ANTIGO (compatibilidade)
echo "🔹 Teste 2: Formato ANTIGO (compatibilidade)"
echo "============================================="
curl -X POST "$WORKER_URL/queue/webhooks/add" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": 123,
    "integrationId": 456,
    "integrationName": "Teste Antigo",
    "url": "'"$WEBHOOK_SITE"'",
    "method": "POST",
    "headers": {
      "X-Legacy-Header": "OldFormat"
    },
    "body": {
      "legacy": true,
      "timestamp": '$(date +%s)'
    }
  }' | jq

echo ""
echo "✅ Job enfileirado (formato antigo)!"
echo ""

echo "📊 Verificar resultados:"
echo "========================"
echo "1. Abra $WEBHOOK_SITE"
echo "2. Veja os 2 requests recebidos"
echo "3. Veja o callback enviado para $CALLBACK_URL"
echo "4. Verifique os logs: docker-compose logs -f worker | grep callback"
echo ""
echo "🎉 Teste concluído!"
