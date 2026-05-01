module.exports = function translationsPatcherLoader(source, sourceMap, meta) {
    const resourcePath = this.resourcePath || '';

    if (resourcePath.includes('jsx-runtime-22qKqdB2.js') || resourcePath.includes('jsx-runtime')) {
        return `
import * as _hostJsxRuntime from 'react/jsx-runtime';
const _lazy = () => _hostJsxRuntime;
export { _lazy as t };
`;
    }

    return source
        .replace(/process\.env\.NODE_ENV/g, '"production"')
        .replace(
            /"production" === "production"\s*\?\s*([\w.]+\s*=\s*\w+\(\))\s*:\s*([\w.]+\s*=\s*\w+\(\))/g,
            '$1'
        )
        .replace(/"production" !== "production"\s*&&\s*\(/g, 'false && (');
};
