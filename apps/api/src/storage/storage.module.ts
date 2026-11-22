import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { FilesController } from './files.controller';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { Storage } from './storage';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: Storage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Storage =>
        config.get('STORAGE_DRIVER', { infer: true }) === 'local' ? new LocalStorage(config) : new S3Storage(config),
    },
  ],
  exports: [Storage],
})
export class StorageModule {}
