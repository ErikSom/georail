import type { CSSProperties } from 'preact';

interface InlineSVGProps {
    src: string;
    width?: number;
    height?: number;
    color?: string;
    className?: string;
    style?: CSSProperties;
}

function InlineSVG({
    src,
    width = 24,
    height = 24,
    color = 'currentColor',
    className = '',
    style = {},
}: InlineSVGProps) {
    const maskStyle: CSSProperties = {
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: color,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        ...style,
    };

    return <div className={className} style={maskStyle} />;
}

export default InlineSVG;
