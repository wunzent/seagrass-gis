import { Injectable, LoggerService } from '@nestjs/common';
import { format } from 'node:util';

/**
 * Operator log lines written as-is (one line per call, no Nest prefix or colours) so the JSON lines stay machine-readable.
 * Independent of Nest's static Logger on purpose: apps are created with `logger: false` / `useLogger(false)`, which silences it.
 * Callers must pass only safe values: never request values, cookies, JWTs, secrets or passwords.
 */
@Injectable()
export class AppLogger implements LoggerService {
  log(message: unknown) { process.stdout.write(`${format(message)}\n`); }
  error(message: unknown) { process.stderr.write(`${format(message)}\n`); }
  warn(message: unknown) { process.stderr.write(`${format(message)}\n`); }
}
