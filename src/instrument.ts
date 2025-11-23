import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: 'https://8f61e58fca2f3f16299cabd3021f9a89@o4510412867633152.ingest.de.sentry.io/4510412869206096',
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

