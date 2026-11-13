import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { API_ERROR_CODES } from '@home-stock/shared';
import type { Db } from '../db';
import { DB_TOKEN } from '../db/db-token';
import { items } from '../db/schema';
import { ApiException } from '../common/api.exception';

/** uploads 目录注入 token（默认 DATA_DIR/uploads，测试可覆盖） */
export const UPLOADS_DIR_TOKEN = 'UPLOADS_DIR';

/** 上传图片约束（P1 单图）：类型白名单 + 2MB 上限 + 魔数校验（防扩展名伪装） */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const UPLOAD_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
/** 物品 imagePath 的合法形态（服务端随机命名，杜绝路径注入） */
export const IMAGE_PATH_PATTERN = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

/** 魔数 → 扩展名（与 UPLOAD_MIME_TO_EXT 的值对应） */
function sniffExt(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return '.png';
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp';
  }
  return null;
}

/**
 * 物品图片存储（P1 单图，参照 Grocy/HomeBox：文件系统存图、DB 只存文件名）。
 * 目录默认 DATA_DIR/uploads（Docker 卷持久化）；备份不打包图片（README 说明）。
 */
@Injectable()
export class UploadsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(UPLOADS_DIR_TOKEN) private readonly uploadsDir: string,
  ) {}

  /** 确保目录存在（懒创建：无图用户的 DATA_DIR 不出现空目录） */
  private ensureDir(): string {
    const dir = resolve(this.uploadsDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 保存上传图片：类型/大小/魔数校验 → 随机文件名落盘 → 返回文件名（image_path 存储值） */
  save(buffer: Buffer, mimeType: string): string {
    const ext = UPLOAD_MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '仅支持 jpg/png/webp 图片');
    }
    if (buffer.length === 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '图片内容为空');
    }
    if (buffer.length > UPLOAD_MAX_BYTES) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '图片不能超过 2MB');
    }
    const sniffed = sniffExt(buffer);
    if (sniffed === null || sniffed !== ext) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '图片内容与类型不符');
    }
    // randomBytes(16) 重名概率 2^-128，忽略冲突
    const name = `${randomBytes(16).toString('hex')}${ext}`;
    writeFileSync(join(this.ensureDir(), name), buffer);
    return name;
  }

  /** 解析 imagePath 为绝对路径；非法形态（路径注入）直接 400 */
  resolvePath(imagePath: string): string {
    if (!IMAGE_PATH_PATTERN.test(imagePath)) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, 'image_path 非法');
    }
    return join(resolve(this.uploadsDir), imagePath);
  }

  /** 文件是否存在（下发与清理前的守卫） */
  exists(imagePath: string): boolean {
    try {
      const path = this.resolvePath(imagePath);
      return existsSync(path) && statSync(path).isFile();
    } catch {
      return false;
    }
  }

  /** 删除文件（物品换图/删除时的清理）；文件已不存在视为成功（幂等） */
  remove(imagePath: string): void {
    try {
      const path = this.resolvePath(imagePath);
      if (existsSync(path)) unlinkSync(path);
    } catch (err) {
      if (err instanceof ApiException) throw err;
      // 磁盘错误不阻塞主流程：图删不掉属于附属资源问题，不回滚物品操作
    }
  }

  /** 启动孤儿清理（委托独立函数，便于 bootstrap 装配期直接调用） */
  sweepOrphans(): number {
    return sweepOrphanUploads(this.db, this.uploadsDir);
  }
}

/** 孤儿清理：删除「超过 24h 且不被任何物品引用」的上传文件（上传后未保存的残留）。 */
export function sweepOrphanUploads(db: Db, uploadsDir: string): number {
  const dir = resolve(uploadsDir);
  if (!existsSync(dir)) return 0;
  let referenced: Set<string>;
  try {
    const rows = db.select({ imagePath: items.imagePath }).from(items).all();
    referenced = new Set(rows.map((r) => r.imagePath).filter((p): p is string => p != null));
  } catch {
    return 0; // 表尚不可读（迁移前）时不动文件
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!IMAGE_PATH_PATTERN.test(name) || referenced.has(name)) continue;
    try {
      if (statSync(join(dir, name)).mtimeMs < cutoff) {
        unlinkSync(join(dir, name));
        removed += 1;
      }
    } catch {
      // 单个文件失败不中断清理
    }
  }
  return removed;
}
