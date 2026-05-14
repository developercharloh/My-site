import React, { useEffect, useState } from 'react';
import './pwa-install-prompt.scss';

// Chrome / Edge / Samsung Internet fire `beforeinstallprompt`. iOS Safari does
// not — for iOS we show a brief "Add to Home Screen" hint instead.

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa_install_dismissed_at';
const DISMISS_DAYS = 14;

const PwaInstallPrompt: React.FC = () => {
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [visible,  setVisible]  = useState(false);

    useEffect(() => {
        // Suppress if recently dismissed or already installed
        try {
            const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
            if (dismissedAt && Date.now() - dismissedAt < DISMISS_DAYS * 86400_000) return;
            if (window.matchMedia('(display-mode: standalone)').matches) return;
            if ((navigator as any).standalone) return;
        } catch { /* ignore */ }

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferred(e as BeforeInstallPromptEvent);
            setVisible(true);
        };
        window.addEventListener('beforeinstallprompt', handler);

        // Cleanup once installed
        const onInstalled = () => setVisible(false);
        window.addEventListener('appinstalled', onInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    if (!visible) return null;

    const install = async () => {
        if (!deferred) return;
        try {
            await deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice.outcome === 'accepted') setVisible(false);
            else dismiss();
        } catch {
            setVisible(false);
        }
    };

    const dismiss = () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
        setVisible(false);
    };

    return (
        <div className='pwa-install' role='dialog' aria-label='Install Mr CharlohFX'>
            <div className='pwa-install__icon'>📱</div>
            <div className='pwa-install__body'>
                <strong className='pwa-install__title'>Install Mr CharlohFX</strong>
                <span className='pwa-install__sub'>Add to your home screen for one-tap access &amp; offline support.</span>
            </div>
            <div className='pwa-install__actions'>
                <button className='pwa-install__btn pwa-install__btn--ghost' onClick={dismiss}>Not now</button>
                <button className='pwa-install__btn pwa-install__btn--primary' onClick={install}>Install</button>
            </div>
        </div>
    );
};

export default PwaInstallPrompt;
