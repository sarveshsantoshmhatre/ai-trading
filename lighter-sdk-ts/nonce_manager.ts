import { ValidationError, NonceError } from './errors';

export async function getNonceFromApi(
    host: string,
    accountIndex: number,
    apiKeyIndex: number
): Promise<number> {
    try {
        const url = new URL(`${host.replace(/\\/$/, '')}/api/v1/nextNonce`);
        url.searchParams.set('account_index', String(accountIndex));
        url.searchParams.set('api_key_index', String(apiKeyIndex));
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
            throw new NonceError(`Couldn't get nonce: HTTP ${response.status}`);
        }
        const payload = await response.json() as { nonce?: unknown };
        const nonce = Number(payload.nonce);
        if (!Number.isSafeInteger(nonce) || nonce < 0) {
            throw new NonceError('Nonce API returned an invalid nonce');
        }
        return nonce;
    } catch (error) {
        if (error instanceof Error) {
            throw new NonceError(`Couldn't get nonce: ${error.message}`);
        }
        throw error;
    }
}

export abstract class NonceManager {
    protected startApiKey: number;
    protected endApiKey: number;
    protected currentApiKey: number;
    protected accountIndex: number;
    protected host: string;
    protected nonce: Record<number, number>;

    constructor(
        accountIndex: number,
        host: string,
        startApiKey: number,
        endApiKey: number | null = null
    ) {
        const effectiveEndApiKey = endApiKey !== null ? endApiKey : startApiKey;

        if (startApiKey > effectiveEndApiKey || startApiKey >= 255 || effectiveEndApiKey >= 255) {
            throw new ValidationError(
                `Invalid range: startApiKey=${startApiKey} endApiKey=${effectiveEndApiKey}`
            );
        }

        this.startApiKey = startApiKey;
        this.endApiKey = effectiveEndApiKey;
        this.currentApiKey = effectiveEndApiKey; // start will be used for the first tx
        this.accountIndex = accountIndex;
        this.host = host;
        this.nonce = {};
    }

    protected async initializeNonces(): Promise<void> {
        const promises: Promise<void>[] = [];
        
        for (let apiKeyIndex = this.startApiKey; apiKeyIndex <= this.endApiKey; apiKeyIndex++) {
            promises.push(
                getNonceFromApi(this.host, this.accountIndex, apiKeyIndex)
                    .then(nonce => {
                        this.nonce[apiKeyIndex] = nonce - 1;
                    })
            );
        }
        
        await Promise.all(promises);
    }

    async hardRefreshNonce(apiKey: number): Promise<void> {
        const nonce = await getNonceFromApi(this.host, this.accountIndex, apiKey);
        this.nonce[apiKey] = nonce - 1;
    }

    abstract nextNonce(): [number, number] | Promise<[number, number]>;

    abstract acknowledgeFailure(apiKeyIndex: number): void;
}

export function incrementCircular(idx: number, startIdx: number, endIdx: number): number {
    idx += 1;
    if (idx > endIdx) {
        return startIdx;
    }
    return idx;
}

export class OptimisticNonceManager extends NonceManager {
    constructor(
        accountIndex: number,
        host: string,
        startApiKey: number,
        endApiKey: number | null = null
    ) {
        super(accountIndex, host, startApiKey, endApiKey);
    }

    async initialize(): Promise<void> {
        await this.initializeNonces();
    }

    nextNonce(): [number, number] {
        this.currentApiKey = incrementCircular(
            this.currentApiKey,
            this.startApiKey,
            this.endApiKey
        );
        const next = (this.nonce[this.currentApiKey] ?? 0) + 1;
        this.nonce[this.currentApiKey] = next;
        return [this.currentApiKey, next];
    }

    acknowledgeFailure(apiKeyIndex: number): void {
        if (this.nonce[apiKeyIndex]) {
            this.nonce[apiKeyIndex] -= 1;
        }
    }
}

export class ApiNonceManager extends NonceManager {
    constructor(
        accountIndex: number,
        host: string,
        startApiKey: number,
        endApiKey: number | null = null
    ) {
        super(accountIndex, host, startApiKey, endApiKey);
    }

    async initialize(): Promise<void> {
        await this.initializeNonces();
    }

    async nextNonce(): Promise<[number, number]> {
        /**
         * It is recommended to wait at least 350ms before using the same api key.
         * Please be mindful of your transaction frequency when using this nonce manager.
         * predicted_execution_time_ms from the response could give you a tighter bound.
         */
        this.currentApiKey = incrementCircular(
            this.currentApiKey,
            this.startApiKey,
            this.endApiKey
        );
        this.nonce[this.currentApiKey] = await getNonceFromApi(
            this.host,
            this.accountIndex,
            this.currentApiKey
        );
        return [this.currentApiKey, this.nonce[this.currentApiKey]];
    }

    async refreshNonce(apiKeyIndex: number): Promise<void> {
        this.nonce[apiKeyIndex] = await getNonceFromApi(
            this.host,
            this.accountIndex,
            apiKeyIndex
        );
    }

    acknowledgeFailure(apiKeyIndex: number): void {
        
    }
}

export enum NonceManagerType {
    OPTIMISTIC = 1,
    API = 2
}

export async function nonceManagerFactory(
    nonceManagerType: NonceManagerType,
    accountIndex: number,
    host: string,
    startApiKey: number,
    endApiKey: number | null = null
): Promise<NonceManager> {
    let manager: NonceManager;

    if (nonceManagerType === NonceManagerType.OPTIMISTIC) {
        manager = new OptimisticNonceManager(
            accountIndex,
            host,
            startApiKey,
            endApiKey
        );
    } else if (nonceManagerType === NonceManagerType.API) {
        manager = new ApiNonceManager(
            accountIndex,
            host,
            startApiKey,
            endApiKey
        );
    } else {
        throw new ValidationError('Invalid nonce manager type');
    }

    await (manager as OptimisticNonceManager | ApiNonceManager).initialize();
    return manager;
}