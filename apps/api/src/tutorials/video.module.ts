import { Module } from '@nestjs/common';
import { VideoStorageService } from './video-storage.service';

/**
 * One storage client for the whole API. Tasks and task types both hand
 * tutorials to browsers, and each of them must swap the file's location for a
 * signed playback link on the way out.
 */
@Module({
  providers: [VideoStorageService],
  exports: [VideoStorageService],
})
export class VideoModule {}
