/**
 * API Routes Facade
 * 
 * Provides backward-compatible exports for route registration and error response
 * handlers, delegating implementation to modular controllers, routes, and middlewares.
 */

export { respondError, safeHandler, parsePositiveInt } from '../middlewares/errorHandler';
export { createRouter } from '../routes';
