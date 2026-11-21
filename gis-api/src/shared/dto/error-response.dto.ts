import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** Shared error envelope `{error:{code,message,details}}`; the OpenAPI schema keeps its public name ErrorBody. */
@ApiSchema({ name: 'ErrorBody' })
export class ErrorResponseDto {
  @ApiProperty({
    type: 'object', required: ['code', 'message', 'details'], selfRequired: true,
    properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: { type: 'object', additionalProperties: true } },
  })
  error!: { code: string; message: string; details: Record<string, unknown> };
}
