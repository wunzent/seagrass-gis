import { CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthConfig } from '../../core/config/config';
import { AUTH_CONFIG } from '../auth.constants';

@Injectable()
export class DemoLoginGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  canActivate() {
    if (this.config.demoLoginEnabled !== true) throw new NotFoundException();
    return true;
  }
}
