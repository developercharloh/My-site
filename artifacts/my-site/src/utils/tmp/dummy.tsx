import React from 'react';

type TIconProps = {
    icon?: string;
    color?: string;
    custom_color?: string;
    size?: number | string;
    width?: number | string;
    height?: number | string;
    className?: string;
    style?: React.CSSProperties;
    onClick?: React.MouseEventHandler;
    onMouseDown?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onTouchStart?: () => void;
    id?: string;
    description?: string;
    data_testid?: string;
};

export const Icon = ({
    icon,
    size = 16,
    width,
    height,
    className,
    style,
    onClick,
    onMouseDown,
    onMouseEnter,
    onMouseLeave,
    onTouchStart,
    id,
    description,
    data_testid,
}: TIconProps) => {
    const w = width ?? size;
    const h = height ?? size;
    return (
        <svg
            id={id}
            className={className as string}
            style={style}
            width={w}
            height={h}
            viewBox='0 0 24 24'
            fill='currentColor'
            onClick={onClick}
            onMouseDown={onMouseDown}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onTouchStart={onTouchStart}
            data-testid={data_testid}
            aria-label={description ?? icon}
        >
            <circle cx='12' cy='12' r='10' opacity='0.15' />
        </svg>
    );
};

export default Icon;
