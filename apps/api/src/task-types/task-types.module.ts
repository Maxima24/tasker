import { Module } from '@nestjs/common';
import { TaskTypesService } from './task-types.service';
import { TaskTypesController } from './task-types.controller';
import { VideoModule } from '../tutorials/video.module';

@Module({
  imports: [VideoModule],
  controllers: [TaskTypesController],
  providers: [TaskTypesService],
})
export class TaskTypesModule {}
