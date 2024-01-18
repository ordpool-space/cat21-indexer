import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

import { oneHourInSeconds, oneWeekInSeconds } from './types/constants';

@Controller()
export class AppController {

  @Get()
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'public, max-age=' + oneHourInSeconds + ', immutable')
  getStart(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>🐱 CAT-21 Indexer API</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, minimal-ui">
  <link rel="icon" href="/public/logo.svg">
  <link rel="stylesheet" href="/public/style.css">
</head>

<body class="markdown-body">
  <h1>
    🐱 CAT-21 Indexer API
  </h1>

  <p>
    Meow! Don't eat cats!
  </p>

  <ul>
    <li>
      <a href="https://github.com/haushoppe/cat-21" target="_blank">CAT-21 Protocol Specification</a>
    </li>
    <li>
      <a href="/open-api">OpenAPI UI</a>
    </li>
    <li>
      <a href="/open-api-json">OpenAPI Specification</a>
    </li>
  </ul>
</html>`;
  }

  @Get('/robots.txt')
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'public, max-age=' + oneWeekInSeconds + ', immutable')
  @Header('Content-Type', 'text/plain')
  getRobotsTxt(): string {
    return 'User-agent: *\nDisallow: /';
  }
}
