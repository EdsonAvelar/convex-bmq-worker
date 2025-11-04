#!/usr/bin/env node
// examples/mock-callback-server.js
// Servidor mock para receber callbacks do worker (simula o Next.js)

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3003;
const SECRET = process.env.QUEUE_WORKER_SECRET || '408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02';

/**
 * Valida HMAC signature
 */
function validateHMAC(payload, signature) {
    const expectedSignature = crypto
        .createHmac('sha256', SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');

    // Timing-safe comparison
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Endpoint: POST /api/queue/callback
    if (req.url === '/api/queue/callback' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const signature = req.headers['x-webhook-signature'];

                console.log('\n🎯 Callback Recebido:');
                console.log('====================');
                console.log(`Job ID: ${payload.jobId}`);
                console.log(`Status: ${payload.status} (${payload.success ? '✅' : '❌'})`);
                console.log(`Tenant: ${payload.tenantId}`);
                console.log(`Webhook URL: ${payload.destination?.url}`);
                console.log(`Status HTTP: ${payload.destination?.statusCode}`);
                console.log(`Duração: ${payload.destination?.duration}ms`);
                console.log(`Tentativa: ${payload.execution?.attempt}/${payload.execution?.maxAttempts}`);

                if (payload.error) {
                    console.log(`❌ Erro: ${payload.error.message}`);
                    console.log(`   Código: ${payload.error.code}`);
                    console.log(`   Retryable: ${payload.error.isRetryable ? 'Sim' : 'Não'}`);
                    if (payload.execution?.nextRetryAt) {
                        console.log(`   Próximo retry: ${payload.execution.nextRetryAt}`);
                    }
                }

                // Validar HMAC
                if (!signature) {
                    console.log('⚠️  AVISO: Signature não fornecida!');
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing signature' }));
                    return;
                }

                try {
                    const isValid = validateHMAC(payload, signature);

                    if (!isValid) {
                        console.log('❌ ERRO: Signature inválida!');
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid signature' }));
                        return;
                    }

                    console.log('✅ Signature válida!');
                } catch (err) {
                    console.log('❌ ERRO ao validar signature:', err.message);
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid signature format' }));
                    return;
                }

                // Simular salvamento no banco
                console.log('💾 Salvando no banco de dados...');
                console.log('✅ Callback processado com sucesso!\n');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Callback received and processed',
                    jobId: payload.jobId
                }));

            } catch (error) {
                console.error('❌ Erro ao processar callback:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Internal server error',
                    message: error.message
                }));
            }
        });
        return;
    }

    // Health check
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            service: 'mock-callback-server',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`\n🚀 Mock Callback Server rodando em http://localhost:${PORT}`);
    console.log(`📍 Endpoint: POST http://localhost:${PORT}/api/queue/callback`);
    console.log(`🔐 Secret: ${SECRET.substring(0, 20)}...`);
    console.log('\n✅ Pronto para receber callbacks do worker!\n');
    console.log('💡 Para testar com ngrok:');
    console.log(`   ngrok http ${PORT}`);
    console.log('   Use a URL do ngrok no campo callback.url\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Encerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor encerrado com sucesso');
        process.exit(0);
    });
});
