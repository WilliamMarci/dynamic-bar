function format(error) {
    if (error instanceof Error)
        return error.stack || error.message;
    return String(error ?? 'unknown error');
}

export function logError(scope, error, context = '') {
    console.error(`[Dynamic Bar][${scope}]${context ? ` (${context})` : ''}: ${format(error)}`);
}

export function logWarning(scope, message, context = '') {
    console.warn(`[Dynamic Bar][${scope}]${context ? ` (${context})` : ''}: ${message}`);
}
