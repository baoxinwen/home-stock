import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

/** 未处理异常的详细日志出口（console + notification_logs）；默认仅 console。 */
export type InternalErrorLogger = (message: string) => void;

const PUBLIC_INTERNAL_ERROR = '服务器内部错误';

/**
 * 全局兜底异常过滤器（规格第 9 节统一错误形状 { code, message }）：
 * - HttpException 已携带 { code, message } 响应体的（业务 ApiException），原样透传
 * - Nest 内置 NotFoundException 等路由级 404 → 统一映射为 { code: NOT_FOUND }
 * - 其余 HttpException（如 400 body 无 code）→ VALIDATION_ERROR
 * - 未知异常（含 db 抛错）→ 500 INTERNAL_ERROR，**详细错误只写日志，不返回给客户端**
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logError: InternalErrorLogger = (message) => console.error(message)) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        res.status(status).json(body);
        return;
      }
      if (status === HttpStatus.NOT_FOUND) {
        res.status(404).json({ code: 'NOT_FOUND', message: exception.message });
        return;
      }
      res.status(status).json({ code: 'VALIDATION_ERROR', message: exception.message });
      return;
    }
    const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
    try {
      this.logError(`未处理异常: ${detail}`);
    } catch {
      // 日志出口自身失败不能影响响应
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: PUBLIC_INTERNAL_ERROR });
  }
}
