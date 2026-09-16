/**
 * Strict Log Contract TypeScript Interfaces
 * Based on OpenTelemetry & Elastic Common Schema (ECS)
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export type EventCategory = 'business' | 'http' | 'database' | 'security' | 'system';

export interface LogService {
    name: string;
    version: string;
    environment: string;
}

export interface LogEvent {
    action: string;
    category: EventCategory;
}

export interface LogTrace {
    trace_id?: string;
    span_id?: string;
}

export interface LogHttp {
    method?: string;
    route?: string;
    status_code?: number;
    duration_ms?: number;
}

export interface LogError {
    name: string;
    message: string;
    stack?: string;
    is_operational: boolean;
}

export type ContextData = Record<string, unknown>;

export interface StrictLogSchema {
    timestamp: string;
    level: LogLevel;
    service: LogService;
    event?: LogEvent;
    message: string;
    trace?: LogTrace;
    http?: LogHttp;
    context?: ContextData;
    error?: LogError;
    [key: string]: unknown;
}
