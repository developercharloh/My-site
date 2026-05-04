import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './blockly-loading.scss';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading } = blockly_store;

    return (
        <>
            {is_loading && (
                <div className='bot__loading' data-testid='blockly-loader'>
                    <div className='bl-ring'>
                        <div /><div /><div /><div />
                    </div>
                    <div className='bl-text'>Loading workspace...</div>
                </div>
            )}
        </>
    );
});

export default BlocklyLoading;
