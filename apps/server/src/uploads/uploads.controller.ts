import { Controller, Get, Inject, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { API_ERROR_CODES } from '@home-stock/shared';
import { ApiException } from '../common/api.exception';
import { UPLOAD_MAX_BYTES, UploadsService } from './uploads.service';

interface UploadedImageFile {
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
}

/**
 * 物品图片（P1 单图）：
 * POST /api/uploads       上传（multipart，字段名 file；header 鉴权走全局中间件）→ { path }
 * GET  /api/uploads/:file 下发图片（`<img>` 无法带 header → ?token= 鉴权，
 *                          与备份下载同属 I-7 query 白名单）
 */
@Controller('api/uploads')
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly uploads: UploadsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_MAX_BYTES },
    }),
  )
  upload(@UploadedFile() file?: UploadedImageFile): { data: { path: string } } {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '请选择图片');
    }
    return { data: { path: this.uploads.save(file.buffer, file.mimetype ?? '') } };
  }

  @Get(':file')
  serve(@Param('file') file: string, @Res() res: Response): void {
    if (!this.uploads.exists(file)) {
      throw new ApiException(404, API_ERROR_CODES.NOT_FOUND, '图片不存在');
    }
    // resolvePath 内已做白名单正则校验（防路径注入），sendFile 限制在该目录内
    res.sendFile(this.uploads.resolvePath(file), (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ code: API_ERROR_CODES.INTERNAL_ERROR, message: '图片读取失败' });
      }
    });
  }
}
