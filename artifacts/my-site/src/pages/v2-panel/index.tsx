import React from 'react';
import { observer } from 'mobx-react-lite';
import { v2EngineStore } from '@/utils/v2-engine-store';
import { V2Panel } from '@/components/trade-animation/v2-panel';
import './v2-panel-page.scss';

const V2PanelTab = observer(() => {
    const { status, logs, stats } = v2EngineStore;

    if (status === 'idle') {
        return (
            <div className='v2pt__idle'>
                <div className='v2pt__idle-icon'>⚡</div>
                <div className='v2pt__idle-title'>V2 Engine</div>
                <div className='v2pt__idle-msg'>
                    Select <strong>V2 Engine</strong> in Free Bots or Signal Engine,
                    then start a bot to see live trades here.
                </div>
            </div>
        );
    }

    return (
        <div className='v2pt'>
            <V2Panel
                status={status}
                logs={logs}
                stats={stats}
                onStop={() => v2EngineStore.stop()}
                onClear={() => v2EngineStore.clearLogs()}
            />
        </div>
    );
});

export default V2PanelTab;
