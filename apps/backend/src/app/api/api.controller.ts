import { Controller } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';


@ApiTags('api')
@Controller()
export class ApiController {

  constructor(
    private configService: ConfigService) { }
}


