export const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'
export const IMAGE_REQUEST_TIMEOUT_MS = 12_000

export function readImageGenerationConfig(override) {
    const source = override ?? process.env

    return {
        accountId: readSetting(source.accountId ?? source.CLOUDFLARE_ACCOUNT_ID),
        apiToken: readSetting(source.apiToken ?? source.CLOUDFLARE_API_TOKEN),
        workerUrl: readSetting(source.workerUrl ?? source.CLOUDFLARE_BACKGROUND_WORKER_URL),
        workerToken: readSetting(source.workerToken ?? source.CLOUDFLARE_BACKGROUND_WORKER_TOKEN),
    }
}

export function isImageGenerationConfigured(config) {
    return Boolean(
        /^[a-f0-9]{32}$/i.test(config.accountId)
        && config.apiToken
        && isHttpsUrl(config.workerUrl),
    )
}

function readSetting(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function isHttpsUrl(value) {
    if (typeof value !== 'string') return false

    try {
        return new URL(value).protocol === 'https:'
    } catch {
        return false
    }
}
