import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

/** Documents the CSRF request headers every unsafe endpoint requires (AUTH-SESSION "CSRF and Request Order"). */
export const ApiCsrfHeaders = () =>
  applyDecorators(
    ApiHeader({ name: 'X-CSRF-Protection', required: true, schema: { type: 'string', enum: ['1'] } }),
    ApiHeader({ name: 'Origin', required: true, description: 'ต้องตรงกับ PUBLIC_WEB_ORIGIN หรือ API_DOCS_ORIGIN' }),
  );
