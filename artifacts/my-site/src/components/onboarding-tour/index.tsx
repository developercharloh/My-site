import React, { useEffect, useState } from 'react';
import './onboarding-tour.scss';

// First-visit four-step coach mark. Stores a flag in localStorage so it
// only shows once per browser. The tour is purely informational and never
// blocks trading actions — users can dismiss at any step.

const SEEN_KEY = 'onboarding_tour_seen_v1';

interface Step {
    title:   string;
    body:    string;
    emoji:   string;
}

const STEPS: Step[] = [
    {
        emoji: '👋',
        title: 'Welcome to Mr CharlohFX',
        body:  "Automated trading made simple. Let's take a few seconds to show you around.",
    },
    {
        emoji: '⚡',
        title: 'Step 1 · Pick a Bot',
        body:  'Open the Speed Bots tab and choose a strategy. Each card explains what it does in plain English.',
    },
    {
        emoji: '🛡️',
        title: 'Step 2 · Set Take Profit & Stop Loss',
        body:  "Always set TP/SL before running. They are your safety net — they stop the bot when you've made enough or lost enough.",
    },
    {
        emoji: '▶️',
        title: 'Step 3 · Start small on Demo',
        body:  "Try every bot on a Demo account first. Switch to real funds only after you've seen the results yourself.",
    },
];

const OnboardingTour: React.FC = () => {
    const [step,    setStep]    = useState(0);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        try {
            if (localStorage.getItem(SEEN_KEY)) return;
        } catch { /* ignore */ }
        // Slight delay so we don't fight the initial app render
        const t = window.setTimeout(() => setVisible(true), 1500);
        return () => window.clearTimeout(t);
    }, []);

    const finish = () => {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
        setVisible(false);
    };

    if (!visible) return null;

    const current = STEPS[step];
    const isLast  = step === STEPS.length - 1;

    return (
        <div className='onb-tour' role='dialog' aria-modal='true' aria-label='Welcome tour'>
            <div className='onb-tour__backdrop' onClick={finish} />
            <div className='onb-tour__card'>
                <button className='onb-tour__close' onClick={finish} aria-label='Close tour'>×</button>
                <div className='onb-tour__emoji'>{current.emoji}</div>
                <h3 className='onb-tour__title'>{current.title}</h3>
                <p  className='onb-tour__body'>{current.body}</p>

                <div className='onb-tour__dots'>
                    {STEPS.map((_, i) => (
                        <span
                            key={i}
                            className={`onb-tour__dot ${i === step ? 'onb-tour__dot--active' : ''}`}
                        />
                    ))}
                </div>

                <div className='onb-tour__actions'>
                    {step > 0 && (
                        <button className='onb-tour__btn onb-tour__btn--ghost' onClick={() => setStep(s => s - 1)}>
                            Back
                        </button>
                    )}
                    {!isLast ? (
                        <button className='onb-tour__btn onb-tour__btn--primary' onClick={() => setStep(s => s + 1)}>
                            Next →
                        </button>
                    ) : (
                        <button className='onb-tour__btn onb-tour__btn--primary' onClick={finish}>
                            Got it 🚀
                        </button>
                    )}
                </div>

                <button className='onb-tour__skip' onClick={finish}>Skip tour</button>
            </div>
        </div>
    );
};

export default OnboardingTour;
