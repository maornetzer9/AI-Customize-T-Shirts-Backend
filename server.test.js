import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from './server.js'

const VITE_ORIGIN = 'http://localhost:5173'
const EVIL_ORIGIN = 'https://evil.example'

function start(options = {}) {
    const app = createApp({
        ...options,
        imageGeneration: options.imageGeneration ?? { config: {} },
    })
    const server = app.listen(0, '127.0.0.1')
    return once(server, 'listening').then(() => ({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
    }))
}

async function stop(server) {
    await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
    })
}

async function postJson(base, body, { origin, raw, headers } = {}) {
    return fetch(`${base}/api/v1/images/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(origin ? { Origin: origin } : {}),
            ...headers,
        },
        body: raw ?? JSON.stringify(body),
    })
}

test('health endpoint stays available', async () => {
    const { server, base } = await start()
    try {
        const response = await fetch(`${base}/`)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { message: 'Server is running' })
    } finally {
        await stop(server)
    }
})

test('an unconfigured request stays unavailable', async () => {
    const { server, base } = await start()

    try {
        const response = await postJson(base, { prompt: 'a red shirt logo' }, { origin: VITE_ORIGIN })
        assert.equal(response.status, 503)
        assert.deepEqual(await response.json(), { error: 'image_generation_unavailable' })
    } finally {
        await stop(server)
    }
})

test('the retired generation path is not served', async () => {
    const { server, base } = await start()

    try {
        const response = await fetch(`${base}/api/v1/dalle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: VITE_ORIGIN,
            },
            body: JSON.stringify({ prompt: 'a red shirt logo' }),
        })
        assert.equal(response.status, 404)
    } finally {
        await stop(server)
    }
})

test('invalid prompts are rejected before generation', async () => {
    const { server, base } = await start()

    try {
        const cases = [
            {},
            { prompt: '' },
            { prompt: '   ' },
            { prompt: 12 },
            { prompt: 'x'.repeat(1001) },
        ]

        for (const body of cases) {
            const response = await postJson(base, body, { origin: VITE_ORIGIN })
            assert.equal(response.status, 400)
            assert.deepEqual(await response.json(), { error: 'invalid_prompt' })
        }
    } finally {
        await stop(server)
    }
})

test('CORS allows the dev client and rejects other origins', async () => {
    const { server, base } = await start()

    try {
        const allowed = await postJson(base, { prompt: 'a small logo' }, { origin: VITE_ORIGIN })
        assert.equal(allowed.headers.get('access-control-allow-origin'), VITE_ORIGIN)
        assert.notEqual(allowed.headers.get('access-control-allow-origin'), '*')

        const blocked = await postJson(base, { prompt: 'a small logo' }, { origin: EVIL_ORIGIN })
        assert.equal(blocked.headers.get('access-control-allow-origin'), null)

        const preflight = await fetch(`${base}/api/v1/images/generate`, {
            method: 'OPTIONS',
            headers: {
                Origin: EVIL_ORIGIN,
                'Access-Control-Request-Method': 'POST',
            },
        })
        assert.equal(preflight.headers.get('access-control-allow-origin'), null)
    } finally {
        await stop(server)
    }
})

test('oversized JSON bodies are rejected', async () => {
    const { server, base } = await start()

    try {
        const response = await postJson(
            base,
            null,
            { origin: VITE_ORIGIN, raw: JSON.stringify({ prompt: 'p'.repeat(120_000) }) },
        )
        assert.equal(response.status, 413)
        assert.deepEqual(await response.json(), { error: 'payload_too_large' })
    } finally {
        await stop(server)
    }
})

test('repeated posts hit the in-memory rate limit', async () => {
    const { server, base } = await start({
        rateLimit: { windowMs: 60_000, max: 2 },
    })

    try {
        const first = await postJson(base, { prompt: 'logo one' }, { origin: VITE_ORIGIN })
        const second = await postJson(base, { prompt: 'logo two' }, { origin: VITE_ORIGIN })
        const third = await postJson(base, { prompt: 'logo three' }, { origin: VITE_ORIGIN })

        assert.equal(first.status, 503)
        assert.equal(second.status, 503)
        assert.equal(third.status, 429)
        assert.deepEqual(await third.json(), { error: 'rate_limit_exceeded' })
        assert.match(third.headers.get('retry-after'), /^[1-9][0-9]*$/)
    } finally {
        await stop(server)
    }
})

test('a spoofed forwarding header does not open another limit', async () => {
    const { server, base } = await start({
        rateLimit: { windowMs: 60_000, max: 1 },
    })

    try {
        const first = await postJson(base, { prompt: 'logo one' }, {
            origin: VITE_ORIGIN,
            headers: { 'X-Forwarded-For': '203.0.113.10' },
        })
        const second = await postJson(base, { prompt: 'logo two' }, {
            origin: VITE_ORIGIN,
            headers: { 'X-Forwarded-For': '203.0.113.11' },
        })

        assert.equal(first.status, 503)
        assert.equal(second.status, 429)
    } finally {
        await stop(server)
    }
})

test('parallel posts share one rate limit', async () => {
    const { server, base } = await start({
        rateLimit: { windowMs: 60_000, max: 1 },
    })

    try {
        const responses = await Promise.all([
            postJson(base, { prompt: 'logo one' }, { origin: VITE_ORIGIN }),
            postJson(base, { prompt: 'logo two' }, { origin: VITE_ORIGIN }),
            postJson(base, { prompt: 'logo three' }, { origin: VITE_ORIGIN }),
        ])
        const statuses = responses.map((response) => response.status).sort()

        assert.equal(statuses.filter((status) => status === 429).length, 2)
        assert.equal(statuses.filter((status) => status === 503).length, 1)
    } finally {
        await stop(server)
    }
})

test('only one generation runs when the concurrency limit is full', async () => {
    let release
    const gate = new Promise((resolve) => {
        release = resolve
    })
    let started = 0
    const fetchImpl = async () => {
        started += 1
        await gate
        return new Response(JSON.stringify({
            success: true,
            result: { image: JPEG_BASE64 },
        }), { status: 200 })
    }
    const { server, base } = await start({
        rateLimit: { windowMs: 60_000, max: 10 },
        imageGeneration: {
            ...configuredGeneration(fetchImpl),
            maxConcurrent: 1,
        },
    })

    try {
        const first = postJson(base, { prompt: 'hold one', mode: 'full' }, { origin: VITE_ORIGIN })
        await new Promise((resolve) => setTimeout(resolve, 50))
        const second = await postJson(base, { prompt: 'hold two', mode: 'full' }, { origin: VITE_ORIGIN })

        assert.equal(started, 1)
        assert.equal(second.status, 429)
        assert.equal(second.headers.get('retry-after'), '12')
        release()
        assert.equal((await first).status, 200)
    } finally {
        release()
        await stop(server)
    }
})

test('security headers are present and other methods are rejected', async () => {
    const { server, base } = await start()

    try {
        const health = await fetch(`${base}/`)
        assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(health.headers.get('referrer-policy'), 'no-referrer')
        assert.equal(health.headers.get('x-frame-options'), 'DENY')

        const method = await fetch(`${base}/api/v1/images/generate`)
        assert.equal(method.status, 405)
        assert.equal(method.headers.get('allow'), 'POST')
        assert.deepEqual(await method.json(), { error: 'method_not_allowed' })
    } finally {
        await stop(server)
    }
})

const ACCOUNT_ID = 'a'.repeat(32)
const API_TOKEN = 'test-token'
const WORKER_URL = 'https://background.example/remove'
const JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/9k='
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64')

function configuredGeneration(fetchImpl) {
    return {
        fetchImpl,
        config: {
            accountId: ACCOUNT_ID,
            apiToken: API_TOKEN,
            workerUrl: WORKER_URL,
        },
    }
}

test('a configured request returns the worker png', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init })

        if (String(url).includes('flux-1-schnell')) {
            return new Response(JSON.stringify({
                success: true,
                result: { image: JPEG_BASE64 },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        return new Response(PNG_BYTES, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
        })
    }
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(base, { prompt: 'a red circle' }, { origin: VITE_ORIGIN })
        const body = await response.json()
        const png = Buffer.from(body.image, 'base64')

        assert.equal(response.status, 200)
        assert.equal(calls.length, 2)
        assert.equal(
            calls[0].url,
            `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        )
        assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_TOKEN}`)
        assert.deepEqual(JSON.parse(calls[0].init.body), {
            prompt: 'a red circle. A single centered subject on a plain solid background.',
        })
        assert.equal(calls[1].url, WORKER_URL)
        assert.equal(calls[1].init.headers['Content-Type'], 'image/jpeg')
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        assert.equal(body.mediaType, 'image/png')
        assert.equal(JSON.stringify(body).includes(API_TOKEN), false)
    } finally {
        await stop(server)
    }
})

test('a full print keeps the generated image', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init })
        return new Response(JSON.stringify({
            success: true,
            result: { image: JPEG_BASE64 },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(
            base,
            { prompt: 'blue stripes', mode: 'full' },
            { origin: VITE_ORIGIN },
        )
        const body = await response.json()

        assert.equal(response.status, 200)
        assert.equal(calls.length, 1)
        assert.equal(JSON.parse(calls[0].init.body).prompt, 'blue stripes')
        assert.equal(body.image, JPEG_BASE64)
        assert.equal(body.mediaType, 'image/jpeg')
        assert.equal(JSON.stringify(body).includes(API_TOKEN), false)
    } finally {
        await stop(server)
    }
})

test('a transient provider failure is retried once', async () => {
    let providerCalls = 0
    const fetchImpl = async (url) => {
        if (!String(url).includes('flux-1-schnell')) {
            return new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } })
        }

        providerCalls += 1
        if (providerCalls === 1) {
            return new Response(JSON.stringify({
                success: false,
                errors: [{ code: 8007, message: 'provider-secret-detail' }],
            }), { status: 400 })
        }

        return new Response(JSON.stringify({
            success: true,
            result: { image: JPEG_BASE64 },
        }), { status: 200 })
    }
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(base, { prompt: 'a red circle' }, { origin: VITE_ORIGIN })
        const text = await response.text()

        assert.equal(response.status, 200)
        assert.equal(providerCalls, 2)
        assert.equal(text.includes('provider-secret-detail'), false)
        assert.equal(text.includes('8007'), false)
    } finally {
        await stop(server)
    }
})

test('an unknown print mode is rejected', async () => {
    let called = false
    const fetchImpl = async () => {
        called = true
        throw new Error('network should not be called')
    }
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(
            base,
            { prompt: 'a red circle', mode: 'poster' },
            { origin: VITE_ORIGIN },
        )
        assert.equal(response.status, 400)
        assert.deepEqual(await response.json(), { error: 'invalid_mode' })
        assert.equal(called, false)
    } finally {
        await stop(server)
    }
})

test('a full print rejects a non-jpeg provider image', async () => {
    let calls = 0
    const fetchImpl = async () => {
        calls += 1
        return new Response(JSON.stringify({
            success: true,
            result: { image: PNG_BASE64 },
        }), { status: 200 })
    }
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(base, { prompt: 'blue stripes', mode: 'full' }, { origin: VITE_ORIGIN })
        assert.equal(response.status, 502)
        assert.deepEqual(await response.json(), { error: 'image_generation_failed' })
        assert.equal(calls, 1)
    } finally {
        await stop(server)
    }
})

test('the worker token is sent only to the worker', async () => {
    const workerToken = 'worker-test-token'
    const calls = []
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init })
        if (String(url).includes('flux-1-schnell')) {
            return new Response(JSON.stringify({
                success: true,
                result: { image: JPEG_BASE64 },
            }), { status: 200 })
        }
        return new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } })
    }
    const { server, base } = await start({
        imageGeneration: {
            fetchImpl,
            config: {
                accountId: ACCOUNT_ID,
                apiToken: API_TOKEN,
                workerUrl: WORKER_URL,
                workerToken,
            },
        },
    })

    try {
        const response = await postJson(base, { prompt: 'a red circle' }, { origin: VITE_ORIGIN })
        const text = await response.text()

        assert.equal(response.status, 200)
        assert.equal(calls[1].init.headers['X-Worker-Token'], workerToken)
        assert.equal(text.includes(workerToken), false)
    } finally {
        await stop(server)
    }
})

test('missing cloudflare configuration stays unavailable', async () => {
    let called = false
    const fetchImpl = async () => {
        called = true
        throw new Error('network should not be called')
    }
    const { server, base } = await start({
        imageGeneration: {
            fetchImpl,
            config: {
                accountId: ACCOUNT_ID,
                workerUrl: WORKER_URL,
            },
        },
    })

    try {
        const response = await postJson(base, { prompt: 'a blue square' }, { origin: VITE_ORIGIN })
        assert.equal(response.status, 503)
        assert.deepEqual(await response.json(), { error: 'image_generation_unavailable' })
        assert.equal(called, false)
    } finally {
        await stop(server)
    }
})

test('provider failures stay generic', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        error: 'provider-secret-detail',
        authorization: `Bearer ${API_TOKEN}`,
    }), { status: 500 })
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(base, { prompt: 'a green triangle' }, { origin: VITE_ORIGIN })
        const text = await response.text()

        assert.equal(response.status, 502)
        assert.equal(text, '{"error":"image_generation_failed"}')
        assert.equal(text.includes('provider-secret-detail'), false)
        assert.equal(text.includes(API_TOKEN), false)
    } finally {
        await stop(server)
    }
})

test('provider timeouts stay unavailable', async () => {
    const fetchImpl = async () => {
        throw new DOMException('The operation was aborted', 'TimeoutError')
    }
    const { server, base } = await start({
        imageGeneration: configuredGeneration(fetchImpl),
    })

    try {
        const response = await postJson(base, { prompt: 'a yellow star' }, { origin: VITE_ORIGIN })
        const text = await response.text()

        assert.equal(response.status, 503)
        assert.equal(text, '{"error":"image_generation_unavailable"}')
        assert.equal(text.includes('aborted'), false)
    } finally {
        await stop(server)
    }
})
