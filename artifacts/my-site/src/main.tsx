import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { APP_IDS, domain_app_ids } from './components/shared/utils/config/config';
import { AnalyticsInitializer } from './utils/analytics';
import { registerPWA } from './utils/pwa-utils';
import './styles/index.scss';

// Seed `config.app_id` in localStorage so the @deriv-com/auth-client OIDC
// library uses the correct Deriv app_id.
// - For known Deriv-official domains (deriv.com/be/me) use the mapped ID.
// - For every other host (Replit, Render, localhost, any future domain) always
//   use MY_SITE (128695) so OAuth never falls back to Deriv's own production
//   app (65555) which redirects back to dbot.deriv.com after login.
if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const known_app_id = domain_app_ids[host as keyof typeof domain_app_ids];
    const is_official_deriv = /deriv\.(com|be|me)$/.test(host);
    if (known_app_id) {
        window.localStorage.setItem('config.app_id', String(known_app_id));
    } else if (!is_official_deriv) {
        window.localStorage.setItem('config.app_id', String(APP_IDS.MY_SITE));
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
