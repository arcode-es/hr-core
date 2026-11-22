import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { MockOcrProvider, OcrProvider } from './ocr.provider';

@Global()
@Module({
  providers: [
    {
      provide: OcrProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): OcrProvider => {
        switch (config.get('OCR_PROVIDER', { infer: true })) {
          case 'mock':
          default:
            return new MockOcrProvider();
        }
      },
    },
  ],
  exports: [OcrProvider],
})
export class OcrModule {}
