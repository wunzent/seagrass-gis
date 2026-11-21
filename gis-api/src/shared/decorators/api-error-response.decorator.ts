import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

/** Documents an error status with the shared envelope; the description lists every code the endpoint may return. */
export const ApiErrorResponse = (status: number, codes: string[]) =>
  ApiResponse({
    status,
    description: codes.join(' | '),
    type: ErrorResponseDto,
    example: { error: { code: codes[0], message: '...', details: {} } },
  });
