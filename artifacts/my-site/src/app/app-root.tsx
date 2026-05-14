import { lazy, Suspense, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = () => {
    return <ChunkLoader message='Loading...' />;
};

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    const api_base_initialized = useRef(false);
    const { isTmbEnabled } = useTMB();

    // Initialize API in background — do NOT block rendering on this
    useEffect(() => {
        const initializeApi = async () => {
            if (api_base_initialized.current) return;
            try {
                await isTmbEnabled();
            } catch (_) {
                // ignore TMB errors
            }
            try {
                await Promise.race([
                    api_base.init(),
                    new Promise(resolve => setTimeout(resolve, 5000)),
                ]);
                api_base_initialized.current = true;
            } catch (_) {
                // ignore API init errors — app still works for unauthenticated pages
            }
        };

        initializeApi();
    }, [isTmbEnabled]);

    // Render immediately — don't wait for API init
    if (!store) return <AppRootLoader />;

    return (
        <Suspense fallback={<AppRootLoader />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;
