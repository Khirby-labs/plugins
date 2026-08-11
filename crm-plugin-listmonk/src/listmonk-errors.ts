/**
 * Typed Listmonk failures (ADR-0011).
 *
 * These replace `message.includes('Configure Listmonk')` as the way the services
 * decided between 400 and 503. English substrings as control flow break the
 * moment a message is reworded — let alone translated.
 */
import type { HttpException } from '@nestjs/common';
import { AppException } from '../../../packages/plugin-host/src';

/** Credentials or URL are missing from the plugin config — the operator can fix it. */
export class ListmonkNotConfiguredError extends Error {
  constructor(message = 'Configure Listmonk URL, username and password in Plugins first.') {
    super(message);
    this.name = 'ListmonkNotConfiguredError';
  }
}

/** The Listmonk host rejected us or is unreachable — nothing the operator can fix. */
export class ListmonkUpstreamError extends Error {
  constructor(
    readonly status: number,
    /** Raw upstream body. Logged, never sent to a client (it can be HTML). */
    readonly detail: string,
  ) {
    super(`Listmonk API returned ${status}`);
    this.name = 'ListmonkUpstreamError';
  }
}

/** The configured URL failed the SSRF allow-list check. */
export class ListmonkUrlNotAllowedError extends Error {
  constructor() {
    super('Listmonk URL is not allowed.');
    this.name = 'ListmonkUrlNotAllowedError';
  }
}

/**
 * Single place that decides 400 vs 503 for a Listmonk failure, and the only
 * place upstream detail is logged. Both services call this so the mapping can't
 * drift between them.
 */
export function toAppException(err: unknown, log: (message: string) => void): HttpException {
  if (err instanceof ListmonkNotConfiguredError) {
    return AppException.pluginNotConfigured('listmonk', err.message);
  }
  if (err instanceof ListmonkUpstreamError) {
    // The upstream body can be HTML — log it, never forward it to a client.
    log(`Listmonk ${err.status}: ${err.detail}`);
    return AppException.upstreamFailed('listmonk');
  }
  log(err instanceof Error ? err.message : 'Unknown Listmonk failure');
  return AppException.upstreamFailed('listmonk');
}
