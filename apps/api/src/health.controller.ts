import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { checkDatabase } from '@lingkod-hr/database';

@Controller('health')
export class HealthController {
  @Get()
  async getHealth(@Res() response: Response) {
    const database = await checkDatabase();
    const healthy = database.status === 'up';

    return response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'api',
      checks: { database },
    });
  }
}
