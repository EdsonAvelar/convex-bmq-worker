#!/usr/bin/env node
// examples/enqueue-authenticated.js
// Exemplo de como enfileirar job COM autenticação Bearer Token

const WORKER_URL = process.env.WORKER_URL || "http://localhost:3002";
const SECRET =
    process.env.QUEUE_WORKER_SECRET ||
    "408c02491b2cb008aaf853a46144844abf3ef6c08ddf621c3072314fbffb8a02";

/**
 * Enfileira job autenticado com Bearer Token
 */
async function enqueueJob(payload) {
    console.log("🔐 Enviando job autenticado...");
    console.log(`URL: ${WORKER_URL}/queue/webhooks/add`);
    console.log(`Token: ${SECRET.substring(0, 20)}...`);
    console.log("");

    const response = await fetch(`${WORKER_URL}/queue/webhooks/add`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SECRET}`, // ✅ Bearer token simples!
        },
        body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (response.ok) {
        console.log("✅ Job enfileirado com sucesso!");
        console.log(`Job ID: ${result.jobId}`);
    } else {
        console.error("❌ Erro ao enfileirar job:");
        console.error(result);
    }

    return result;
}// ============================================================================
// Exemplos de uso
// ============================================================================

async function main() {
    console.log('🚀 Exemplo: Enfileirar Job Autenticado\n');

    // Exemplo 1: Formato NOVO (com callback)
    console.log('📝 Exemplo 1: Formato NOVO (com callback)');
    console.log('==========================================');
    await enqueueJob({
        jobType: 'webhook',
        tenantId: 123,
        integrationId: 456,
        integrationName: 'Facebook Conversao',
        negocioId: 789,
        destination: {
            url: 'https://webhook.site/unique-id',
            method: 'POST',
            headers: {
                'X-Custom-Header': 'Test',
            },
            body: {
                event_name: 'Purchase',
                event_time: Math.floor(Date.now() / 1000),
                test: true,
            },
        },
        callback: {
            url: 'https://your-app.com/api/queue/callback',
        },
        options: {
            retries: 3,
            backoff: 2000,
        },
        metadata: {
            userId: 55,
            source: 'authenticated_example',
        },
    });

    console.log('\n');

    // Exemplo 2: Formato ANTIGO (compatibilidade)
    console.log('📝 Exemplo 2: Formato ANTIGO (compatibilidade)');
    console.log('==============================================');
    await enqueueJob({
        tenantId: 123,
        integrationId: 456,
        integrationName: 'Webhook Legacy',
        negocioId: 789,
        url: 'https://webhook.site/unique-id',
        method: 'POST',
        headers: {
            'X-Legacy-Header': 'Test',
        },
        body: {
            legacy: true,
            timestamp: Math.floor(Date.now() / 1000),
        },
    });

    console.log("\n");

    // Exemplo 3: SEM BEARER TOKEN (deve falhar)
    console.log("📝 Exemplo 3: Sem Bearer Token (deve falhar - 401)");
    console.log("==================================================");
    try {
        const response = await fetch(`${WORKER_URL}/queue/webhooks/add`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // ❌ Sem Authorization: Bearer
            },
            body: JSON.stringify({
                tenantId: 123,
                integrationId: 456,
                url: "https://webhook.site/xyz",
                method: "POST",
            }),
        });

        const result = await response.json();
        console.log(`Status: ${response.status}`);
        console.log("Resposta:", result);
    } catch (error) {
        console.error("Erro:", error.message);
    } console.log('\n✅ Exemplos concluídos!');
}

main().catch(console.error);
