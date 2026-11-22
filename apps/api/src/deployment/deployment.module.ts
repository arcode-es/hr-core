import { Global, Module } from '@nestjs/common';
import { Deployment } from './deployment';

@Global()
@Module({ providers: [Deployment], exports: [Deployment] })
export class DeploymentModule {}
