# Como Configurar Redis no Railway

## 🎯 Problema

O worker precisa de um Redis para funcionar. Você tem 3 opções:

## ✅ Opção 1: Redis do Railway (RECOMENDADO)

### Vantagens:

- ✅ Sem limites de requisições
- ✅ Redis dedicado e rápido
- ✅ Configuração automática
- ✅ Mesma rede do worker (baixa latência)

### Passos:

1. **Acesse seu projeto no Railway**
2. **Clique em "+ New"** (botão roxo no canto superior direito)
3. **Selecione "Database" → "Add Redis"**
4. **Railway criará um Redis e configurará automaticamente a variável `REDIS_URL`**
5. **Redeploy seu worker** (ou espere o auto-deploy)

Pronto! O Railway vai criar uma variável `REDIS_URL` automaticamente com formato:

```
redis://default:SENHA@redis.railway.internal:6379
```

### Custo:

- **Plano Hobby**: ~$5/mês
- **Sem limites de requisições**
- **Mais estável que Upstash free tier**

---

## 💰 Opção 2: Upstash Redis (Grátis com limites)

### Vantagens:

- ✅ Plano gratuito disponível
- ✅ Gerenciado (não precisa manutenção)

### Desvantagens:

- ❌ Limite de 10,000 comandos/dia (free tier)
- ❌ Pode estourar o limite facilmente com workers
- ❌ Latência maior (servidor externo)

### Passos:

1. **Crie conta no Upstash**: https://upstash.com
2. **Crie um Redis Database**
3. **Copie a URL de conexão** (formato: `rediss://...`)
4. **No Railway, adicione variável de ambiente**:
   ```
   REDIS_URL=rediss://default:SUA_SENHA@seu-redis.upstash.io:6379
   ```
5. **Redeploy**

---

## 🐳 Opção 3: Auto-hospedar Redis no Railway

### Vantagens:

- ✅ Controle total
- ✅ Sem custos extras

### Desvantagens:

- ❌ Mais complexo de configurar
- ❌ Precisa gerenciar volumes/persistência

Não recomendado - use Opção 1 (Redis do Railway).

---

## 🔧 Verificar se está funcionando

Após configurar, verifique os logs no Railway:

```
✅ Deve aparecer:
🔧 [Redis Factory] Usando TCP URL: redis.railway.internal:6379

❌ NÃO deve aparecer:
Error: Configure UPSTASH_REDIS_URL/REDIS_URL...
```

Acesse também o endpoint de health:

```
https://seu-worker.railway.app/queue/health
```

---

## 📊 Monitorar uso do Redis

Após configurar, acesse:

```
https://seu-worker.railway.app/metrics
```

Vai mostrar:

- `redis.totalCommands` - Total de comandos executados
- `redis.commandsPerHour` - Taxa de comandos por hora
- `redis.projectedDaily` - Projeção diária
- `redis.topCommands` - Comandos mais usados

Se `commandsPerHour > 100,000`, pode estar havendo polling excessivo ou loops.
