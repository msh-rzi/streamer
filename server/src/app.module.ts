import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StreamController } from './stream.controller';
import { StreamGateway } from './stream.gateway';

@Module({
  imports: [],
  controllers: [AppController, StreamController],
  providers: [AppService, StreamGateway],
})
export class AppModule {}
