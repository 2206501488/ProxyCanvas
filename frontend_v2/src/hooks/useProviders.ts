import { useCallback, useEffect, useState } from 'react';
import { loadRuntimeProviders } from '../services/api';
import type { RuntimeProvider } from '../services/api';

const PROVIDERS_UPDATED_EVENT = 'proxycanvas:providers-updated';

let providerCache: RuntimeProvider[] = [];
let loadingPromise: Promise<RuntimeProvider[]> | null = null;

async function loadProvidersCached() {
    if (!loadingPromise) {
        loadingPromise = loadRuntimeProviders()
            .then((providers) => {
                providerCache = providers;
                return providers;
            })
            .finally(() => {
                loadingPromise = null;
            });
    }
    return loadingPromise;
}

export function notifyProvidersUpdated() {
    providerCache = [];
    window.dispatchEvent(new Event(PROVIDERS_UPDATED_EVENT));
}

export function useProviders() {
    const [providers, setProviders] = useState<RuntimeProvider[]>(providerCache);
    const [loading, setLoading] = useState(providerCache.length === 0);

    const reload = useCallback(async () => {
        setLoading(providerCache.length === 0);
        try {
            const next = await loadProvidersCached();
            setProviders(next);
            return next;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        reload().then((next) => {
            if (!cancelled) setProviders(next);
        });

        const handleProvidersUpdated = () => {
            loadProvidersCached().then((next) => {
                if (!cancelled) setProviders(next);
            });
        };

        window.addEventListener(PROVIDERS_UPDATED_EVENT, handleProvidersUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener(PROVIDERS_UPDATED_EVENT, handleProvidersUpdated);
        };
    }, [reload]);

    return { providers, loading, reload };
}
