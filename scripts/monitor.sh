#!/bin/bash
# Script de monitoramento simples das métricas do worker

WORKER_URL="${WORKER_URL:-http://localhost:3002}"

while true; do
  clear
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║         BullMQ Worker Metrics Dashboard                    ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  
  METRICS=$(curl -s $WORKER_URL/metrics)
  
  if [ $? -ne 0 ]; then
    echo "❌ Erro ao conectar ao worker em $WORKER_URL"
    echo ""
    echo "Verifique se o worker está rodando:"
    echo "  docker-compose ps"
    sleep 5
    continue
  fi
  
  # Performance
  echo "📊 PERFORMANCE"
  echo "───────────────────────────────────────────────────────────"
  JOBS_PER_SEC=$(echo $METRICS | jq -r '.performance.jobsPerSecond')
  AVG_DURATION=$(echo $METRICS | jq -r '.jobs.avgDurationMs')
  SUCCESS_RATE=$(echo $METRICS | jq -r '.jobs.successRate')
  
  echo "  Throughput:    $JOBS_PER_SEC jobs/second"
  echo "  Avg Duration:  ${AVG_DURATION}ms"
  echo "  Success Rate:  $SUCCESS_RATE"
  echo ""
  
  # Queue Status
  echo "📦 QUEUE STATUS"
  echo "───────────────────────────────────────────────────────────"
  WAITING=$(echo $METRICS | jq -r '.queue.waiting')
  ACTIVE=$(echo $METRICS | jq -r '.queue.active')
  COMPLETED=$(echo $METRICS | jq -r '.queue.completed')
  FAILED=$(echo $METRICS | jq -r '.queue.failed')
  STATUS=$(echo $METRICS | jq -r '.queue.status')
  
  echo "  Waiting:       $WAITING"
  echo "  Active:        $ACTIVE"
  echo "  Completed:     $COMPLETED"
  echo "  Failed:        $FAILED"
  echo "  Status:        $STATUS"
  echo ""
  
  # Health & Bottlenecks
  echo "🏥 HEALTH ANALYSIS"
  echo "───────────────────────────────────────────────────────────"
  BOTTLENECKS=$(echo $METRICS | jq -r '.health.bottlenecks | join(", ")')
  NEEDS_SCALING=$(echo $METRICS | jq -r '.health.needsScaling')
  
  if [ "$BOTTLENECKS" = "NONE" ]; then
    echo "  ✅ No bottlenecks detected"
  else
    echo "  ⚠️  Bottlenecks: $BOTTLENECKS"
  fi
  
  if [ "$NEEDS_SCALING" = "true" ]; then
    echo "  🔴 ACTION REQUIRED: System needs scaling!"
  else
    echo "  ✅ Capacity is adequate"
  fi
  echo ""
  
  # Recommendations
  echo "💡 RECOMMENDATIONS"
  echo "───────────────────────────────────────────────────────────"
  echo $METRICS | jq -r '.health.recommendations[]' | while read -r rec; do
    echo "  • $rec"
  done
  echo ""
  
  # Errors (if any)
  ERROR_COUNT=$(echo $METRICS | jq -r '.errors.count')
  if [ "$ERROR_COUNT" != "0" ]; then
    echo "❌ RECENT ERRORS"
    echo "───────────────────────────────────────────────────────────"
    echo "  Count: $ERROR_COUNT"
    LAST_ERROR=$(echo $METRICS | jq -r '.errors.lastError')
    echo "  Last: $LAST_ERROR"
    echo ""
  fi
  
  # Footer
  UPTIME=$(echo $METRICS | jq -r '.uptime')
  UPTIME_MIN=$((UPTIME / 60))
  echo "───────────────────────────────────────────────────────────"
  echo "Uptime: ${UPTIME_MIN}min | Refreshing every 3s | Press Ctrl+C to exit"
  
  sleep 3
done
