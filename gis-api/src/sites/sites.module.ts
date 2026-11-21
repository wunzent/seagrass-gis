import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller';
import { SitesRepository } from './sites.repository';
import { SitesService } from './sites.service';

/** Exports SitesRepository so the surveys module (T008) can lock and read the parent site. */
@Module({ controllers: [SitesController], providers: [SitesService, SitesRepository], exports: [SitesRepository] })
export class SitesModule {}
