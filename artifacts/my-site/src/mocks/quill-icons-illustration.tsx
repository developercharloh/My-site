import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & {
    iconSize?: string;
    title?: string;
    titleId?: string;
};

const makeIcon = (pathD: string) =>
    React.forwardRef<SVGSVGElement, IconProps>(({ iconSize: _iconSize, title, titleId, width = 64, height = 64, ...props }, ref) => (
        <svg
            ref={ref}
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 64 64'
            width={width}
            height={height}
            fill='currentColor'
            role='img'
            aria-labelledby={titleId}
            {...props}
        >
            {title ? <title id={titleId}>{title}</title> : null}
            <path d={pathD} />
        </svg>
    ));

export const DerivLightUserErrorIcon = makeIcon(
    'M32 8a14 14 0 1 0 0 28A14 14 0 0 0 32 8zm0 32c-13 0-24 6.5-24 14.5V58h48v-3.5C56 46.5 45 40 32 40z'
);

export const DerivLightEmptyCardboardBoxIcon = makeIcon(
    'M8 20v32h48V20l-6-8H14L8 20zm4 2h40v28H12V22zm8-8h24l4 6H16l4-6zm8 10v12H20V24h8zm8 0h8v12h-8V24z'
);

export const DerivLightGoogleDriveIcon = makeIcon(
    'M32 4L8 44h12l12-20 12 20h12L32 4zm-14 42l-6 10h40l-6-10H18zm14-8l-6 10h12l-6-10z'
);

export const DerivLightLocalDeviceIcon = makeIcon(
    'M8 12v32h48V12H8zm4 4h40v24H12V16zm4 28h32v4H16v-4zm6-22h20v2H22v-2zm0 6h20v2H22v-2zm0 6h12v2H22v-2z'
);

export const DerivLightMyComputerIcon = makeIcon(
    'M6 10v36h52V10H6zm4 4h44v28H10V14zm8 32h28v4H18v-4zm-4 4h36v2H14v-2z'
);

export const DerivLightDeclinedPoaIcon = makeIcon(
    'M32 8C19 8 8 19 8 32s11 24 24 24 24-11 24-24S45 8 32 8zm0 4a19.7 19.7 0 0 1 14.1 5.9L13.9 50.1A20 20 0 0 1 32 12zm0 40a19.7 19.7 0 0 1-14.1-5.9l32.2-32.2A20 20 0 0 1 32 52z'
);

export default DerivLightUserErrorIcon;
