import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from './entities/job.entity';
import { User } from './entities/user.entity';
import { Search } from './entities/search.entity'
import { StorageServiceController } from './storage-service.controller';
import { StorageServiceService } from './storage-service.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, User, Search]),
  ],
  controllers: [StorageServiceController],
  providers: [StorageServiceService],
  exports: [StorageServiceService],
})
export class StorageServiceModule { }
