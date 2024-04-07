import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

import { oneHourInSeconds, oneWeekInSeconds } from './types/constants';
import { schedule } from '../../../shared/schedule';

@Controller()
export class AppController {

  @Get()
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'public, max-age=' + oneHourInSeconds + ', immutable')
  getStart(): string {

    const isPublic = new Date() > new Date(schedule.Public.start);
    const uptime = this.formatSeconds(process.uptime())

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>🟧 CAT-21 Indexer API</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, minimal-ui">
  <link rel="icon" href="/public/logo.svg">
  <link rel="stylesheet" href="/public/style.css">
</head>

<body class="markdown-body">

  <img src="/public/genesis-cat-transparent.svg" width="50%">

  <h1>
    🟧 CAT-21 Indexer API
  </h1>

  <p>
    Meow! Rescue the cats!
  </p>

  <ul>
    ` +

    (isPublic ?

    `<li>
      <a href="https://github.com/haushoppe/cat-21" target="_blank">CAT-21 Protocol Specification</a>
    </li>` : '')

    +
    `
    <li>
      <a href="https://cat21.space" target="_blank">Offical website (mainnet)</a>
    </li>
    <li>
      <a href="https://cat21.space/testnet" target="_blank">Offical website (testnet)</a>
    </li>
    `+

    (isPublic ?

    `<li>
      <a href="/open-api">Indexer: OpenAPI UI</a>
    </li>
    <li>
      <a href="/open-api-json">Indexer: OpenAPI Specification</a>
    </li>` : '')

    + `
  </ul>

  <hr>

  Uptime: ${ uptime }
</html>`;
  }

  formatSeconds(seconds: number) {
    const pad = function (s: number) {
      return (s < 10 ? '0' : '') + s;
    }
    const hours = Math.floor(seconds / (60 * 60));
    const minutes = Math.floor(seconds % (60 * 60) / 60);
    const secs = Math.floor(seconds % 60);

    return pad(hours) + ':' + pad(minutes) + ':' + pad(secs);
  }

  @Get('/robots.txt')
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'public, max-age=' + oneWeekInSeconds + ', immutable')
  @Header('Content-Type', 'text/plain')
  getRobotsTxt(): string {
    return 'User-agent: *\nDisallow: /';
  }
}
