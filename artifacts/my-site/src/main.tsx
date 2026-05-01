import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { domain_app_ids } from './components/shared/utils/config/config';
import { AnalyticsInitializer } from './utils/analytics';
import { registerPWA } from './utils/pwa-utils';
import './styles/index.scss';

// Seed `config.app_id` in localStorage for known production domains so the
// @deriv-com/auth-client OIDC library uses the correct Deriv app_id. The
// library has its own internal getAppId() fallback that returns "36300"
// (Deriv's localhost test app) for unrecognised hostnames, which would
// otherwise redirect OAuth to https://localhost:8443/ after login.
if (typeof window !== 'undefined') {
    const known_app_id = domain_app_ids[window.location.hostname as keyof typeof domain_app_ids];
    if (known_app_id) {
        window.localStorage.setItem('config.app_id', String(known_app_id));
    }
}

AnalyticsInitializer();
registerPWA()
    .then(registration => {
        if (registration) {
            console.log('PWA service worker registered successfully for Chrome');
        } else {
            console.log('PWA service worker disabled for non-Chrome browser');
        }
    })
    .catch(error => {
        console.error('PWA service worker registration failed:', error);
    });

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
