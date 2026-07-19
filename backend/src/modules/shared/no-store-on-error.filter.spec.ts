import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';

import { NoStoreOnErrorFilter } from './no-store-on-error.filter';

/**
 * The filter's contract: attach `Cache-Control: no-store` to every
 * error response BEFORE Nest's built-in handler runs. Tested against
 * the concrete adapter surface (setHeader + reply) so a broken filter
 * shows up here — even the throttler's 429 path (which fires from a
 * guard, well before any controller method) picks up the header.
 */
function createHostAndAdapter() {
  const response = {};
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
      getNext: () => ({}),
    }) as never,
  } as never;
  const setHeader = jest.fn();
  const reply = jest.fn();
  const adapterHost = { httpAdapter: { setHeader, reply } } as unknown as HttpAdapterHost;
  return { host, adapterHost, setHeader, reply, response };
}

describe('NoStoreOnErrorFilter', () => {

  it('attaches Cache-Control: no-store on a ThrottlerException (429 from a guard, before the controller runs)', () => {
    const { host, adapterHost, setHeader, reply, response } = createHostAndAdapter();
    const filter = new NoStoreOnErrorFilter(adapterHost);

    const err = new ThrottlerException('Too Many Requests');
    filter.catch(err, host);

    expect(setHeader).toHaveBeenCalledWith(response, 'Cache-Control', 'no-store');
    expect(reply).toHaveBeenCalledWith(response, expect.anything(), 429);
  });

  it('attaches Cache-Control: no-store on a BadRequestException (400 from validation)', () => {
    const { host, adapterHost, setHeader, reply, response } = createHostAndAdapter();
    const filter = new NoStoreOnErrorFilter(adapterHost);

    const err = new BadRequestException({ code: 'network-mismatch', detail: 'wrong network' });
    filter.catch(err, host);

    expect(setHeader).toHaveBeenCalledWith(response, 'Cache-Control', 'no-store');
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ code: 'network-mismatch' }),
      400,
    );
  });

  it('attaches Cache-Control: no-store on a generic HttpException with a custom status', () => {
    const { host, adapterHost, setHeader, reply, response } = createHostAndAdapter();
    const filter = new NoStoreOnErrorFilter(adapterHost);

    filter.catch(new HttpException('teapot', 418), host);

    expect(setHeader).toHaveBeenCalledWith(response, 'Cache-Control', 'no-store');
    expect(reply).toHaveBeenCalledWith(response, 'teapot', 418);
  });

  it('falls back to 500 + a generic body on an unexpected non-HttpException', () => {
    const { host, adapterHost, setHeader, reply, response } = createHostAndAdapter();
    const filter = new NoStoreOnErrorFilter(adapterHost);

    filter.catch(new Error('boom'), host);

    expect(setHeader).toHaveBeenCalledWith(response, 'Cache-Control', 'no-store');
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 500 }),
      500,
    );
  });
});
