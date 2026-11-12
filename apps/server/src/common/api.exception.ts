import { HttpException } from '@nestjs/common';
import type { ApiError } from '@home-stock/shared';

/** 抛出携带统一 { code, message } 响应体的 HTTP 异常。 */
export class ApiException extends HttpException {
  constructor(status: number, code: ApiError['code'], message: string) {
    super({ code, message }, status);
  }
}
