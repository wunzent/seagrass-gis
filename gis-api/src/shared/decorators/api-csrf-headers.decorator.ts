import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

/** Auth endpoints always require CSRF; protected writes require it only with cookie authentication. */
export const ApiCsrfHeaders = (required = true) =>
  applyDecorators(
    ApiHeader({
      name: 'X-CSRF-Protection',
      required,
      schema: { type: 'string', enum: ['1'] },
      description: required ? 'ต้องส่งเสมอ' : 'ต้องส่งเมื่อใช้ cookie; Bearer ไม่ต้องส่ง',
    }),
    ApiHeader({
      name: 'Origin',
      required,
      description: `ต้องตรงกับ PUBLIC_WEB_ORIGIN หรือ API_DOCS_ORIGIN${required ? '' : '; ต้องส่งเมื่อใช้ cookie; Bearer ไม่ต้องส่ง'}`,
    }),
  );
