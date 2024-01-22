import { ApiProperty } from "@nestjs/swagger";

export class ErrorResponse {

  @ApiProperty({
    description: 'The HTTP status code',
    example: 400
  })
  statusCode: number;

  @ApiProperty({
    description: 'ISO formated string with the the exact moment when the error was fetched',
    example: '2024-01-01T00:00:00.000Z'
  })
  timestamp: string;

  @ApiProperty({
    description: 'Exact path that was called',
    example: '/api/cats/XXX'
  })
  path: string;

  @ApiProperty({
    description: 'Explanation of the issue',
    example: 'Each sat range must be an array of exactly two numbers.'
  })
  message: string;

  @ApiProperty({
    description: 'Optional stack trace',
    nullable: true
  })
  stack?: string;
}
