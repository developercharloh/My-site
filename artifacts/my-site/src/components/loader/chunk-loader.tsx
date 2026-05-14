import React from 'react';
import './chunk-loader.scss';

export default function ChunkLoader({ message }: { message: string }) {
    return (
        <div className='chl'>
            <div className='chl__ring'>
                <div />
                <div />
                <div />
                <div />
            </div>
            {message && <p className='chl__msg'>{message}</p>}
        </div>
    );
}
