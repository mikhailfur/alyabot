import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: 'https://1029b6aadbc4c48bad9940fe99324ad3@o4510412867633152.ingest.de.sentry.io/4510412885196880',
  sendDefaultPii: true,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 1.0,
  beforeSend(event: Sentry.ErrorEvent, hint: Sentry.EventHint) {
    if (event.exception) {
      const error = hint.originalException;
      if (error && typeof error === 'object' && 'message' in error) {
        const errorMessage = String(error.message || '');
        if (errorMessage.includes('ER_DUP_ENTRY') || 
            errorMessage.includes('Duplicate entry')) {
          return null;
        }
      }
    }
    return event;
  },
});

export default Sentry;

