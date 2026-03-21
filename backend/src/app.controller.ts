import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller()
export class AppController {
  @Get()
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html')
  getRoot(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>CAT-21 Backend API</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:monospace;background:#FF9900;color:white;text-align:center;padding:2em">
  <h1>CAT-21 Backend API</h1>
  <p>Meow! Rescue the cats!</p>
  <ul style="list-style:none;padding:0">
    <li><a href="https://cat21.space" style="color:white">cat21.space</a></li>
    <li><a href="https://github.com/ordpool-space/cat21" style="color:white">CAT-21 Protocol</a></li>
    <li><a href="/docs" style="color:white">API Docs (Swagger)</a></li>
  </ul>
</body>
</html>`;
  }

  @Get('robots.txt')
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  @Header('Content-Type', 'text/plain')
  getRobots(): string {
    return 'User-agent: *\nDisallow: /';
  }
}
