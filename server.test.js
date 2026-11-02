import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createApp } from './server.js'

process.env.ENABLE_IMAGE_GENERATION = 'true'

const VITE_ORIGIN = 'http://localhost:5173'
const EVIL_ORIGIN = 'https://evil.example'

function start(options) {
    const app = createApp(options)
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

async function postJson(base, body, { origin, raw } = {}) {
    return fetch(`${base}/api/v1/dalle`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(origin ? { Origin: origin } : {}),
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

test('valid prompts cannot start image generation', async () => {
    const { server, base } = await start()

    try {
        const response = await postJson(base, { prompt: 'a red shirt logo' }, { origin: VITE_ORIGIN })
        assert.equal(response.status, 503)
        assert.deepEqual(await response.json(), { error: 'image_generation_unavailable' })
        assert.equal(process.env.ENABLE_IMAGE_GENERATION, 'true')
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

        const preflight = await fetch(`${base}/api/v1/dalle`, {
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
    } finally {
        await stop(server)
    }
})
