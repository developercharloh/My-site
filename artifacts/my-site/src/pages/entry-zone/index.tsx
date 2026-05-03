import React from 'react';
import './entry-zone.scss';

/**
 * The former Entry Zone tab is being repurposed as the AI Analysis Tool.
 * The previous tick / candle / heatmap engine has been removed; this is
 * a placeholder while the new AI-driven analyzer is built.
 */
const EntryZone: React.FC = () => (
    <div className='ai-soon'>
        <div className='ai-soon__card'>
            <div className='ai-soon__emoji' role='img' aria-label='robot'>🤖</div>
            <div className='ai-soon__badge'>Coming soon</div>
            <h1 className='ai-soon__title'>AI Analysis Tool</h1>
            <p className='ai-soon__sub'>
                We&apos;re building a smarter way to read the market —
                AI-powered signals, pattern recognition and entry suggestions
                tailored to your favourite symbols.
            </p>
            <p className='ai-soon__hint'>
                Stay tuned. This tab will light up the moment it&apos;s ready.
            </p>
        </div>
    </div>
);

export default EntryZone;
