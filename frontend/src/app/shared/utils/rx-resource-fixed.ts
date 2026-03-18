import { HttpErrorResponse } from '@angular/common/http';
import { linkedSignal, ResourceRef, Signal, signal, WritableSignal } from '@angular/core';
import { rxResource, RxResourceOptions } from '@angular/core/rxjs-interop';
import { catchError, MonoTypeOperatorFunction, throwError } from 'rxjs';

/**
 * A wrapper for rxResource that fixes three bugs:
 *
 * Bug #1: Value Resets When Parameters Change
 * Bug #2: HttpErrorResponse Gets Wrapped
 * Bug #3: reload() Doesn't Clear Error State Immediately
 */
// Overload: with defaultValue → ResourceRef<T> (value never undefined)
export function rxResourceFixed<T, P = void>(
  options: RxResourceOptions<T, P> & { defaultValue: T }
): ResourceRef<T>;

// Overload: without defaultValue → ResourceRef<T | undefined>
export function rxResourceFixed<T, P = void>(
  options: RxResourceOptions<T, P>
): ResourceRef<T | undefined>;

// Implementation
export function rxResourceFixed<T, P = void>(
  options: RxResourceOptions<T, P>
): ResourceRef<T | undefined> {
  // Internal refresh key to fix Bug #3
  // When incremented, the params change triggers a new loading phase which also aborts any pending request
  const refreshKey = signal(0);

  // Create underlying rxResource with auto-applied error handling (Bug #2 fix)
  // The refreshKey is included in params so that we can increment it (Bug #3 fix)
  // Spread options to preserve defaultValue, equal, and injector
  const resource = rxResource<T, { userParams: P; _refresh: number }>({
    ...options, // Preserve all options (defaultValue, equal, injector)
    params: () => ({
      userParams: options.params?.() ?? (undefined as P),
      _refresh: refreshKey()
    }),
    stream: (context) => {
      // Pass user params, abortSignal, and previous status to the stream function
      return options.stream({
        params: context.params.userParams as Exclude<P, undefined>,
        abortSignal: context.abortSignal,
        previous: context.previous
      }).pipe(
        rethrowHttpResourceError() // Bug #2 fix: Convert HttpErrorResponse to Error
      );
    }
  });

  // Create stable value signal using linkedSignal (Bug #1 fix)
  // Keeps previous value during params-driven loading and reloading from success.
  // Clears value on error (and therefore shows a clean slate on reload after error).
  const stableValue = linkedSignal({
    source: () => resource.status(),
    computation: (status: ReturnType<typeof resource.status>, previous) => {
      if (status === 'error') {
        return undefined; // clear on error
      }
      if (status === 'loading') {
        return previous?.value ?? resource.value(); // keep stale or use defaultValue
      }
      // For resolved, reloading, local, idle: return current value
      return resource.value();
    }
  });

  // Wrap stableValue to look like a WritableSignal for ResourceRef compatibility
  // While we expose set/update/asReadonly to match the interface, we delegate to the underlying resource
  const stableValueAsWritable = stableValue as unknown as WritableSignal<T | undefined>;
  stableValueAsWritable.set = resource.value.set.bind(resource.value);
  stableValueAsWritable.update = resource.value.update.bind(resource.value);
  stableValueAsWritable.asReadonly = stableValue.asReadonly.bind(stableValue) as () => Signal<T | undefined>;

  return {
    value: stableValueAsWritable,
    isLoading: resource.isLoading,
    error: resource.error,
    status: resource.status,
    hasValue: () => stableValue() !== undefined && resource.error() == null,
    /**
     * Reloads the resource by incrementing an internal refresh key.
     * Note: This triggers a params change, so status() will be `loading` (not `reloading`).
     * This is intentional to ensure error state clears immediately on reload.
     */
    reload: () => {
      // Bug #3 fix: Increment refreshKey to trigger param change
      refreshKey.update(k => k + 1);
      return true;
    },
    set: resource.set.bind(resource),
    update: resource.update.bind(resource),
    asReadonly: resource.asReadonly.bind(resource),
    destroy: resource.destroy.bind(resource)
  } as ResourceRef<T | undefined>;
}

/**
 * RxJS operator to re-throw HttpErrorResponse as a native Error for Angular resources.
 * Preserves original details in .cause; formats a descriptive message.
 *
 * @returns MonoTypeOperatorFunction<T> - Transforms the stream, catching/re-throwing only HTTP errors.
 */
export function rethrowHttpResourceError<T>(): MonoTypeOperatorFunction<T> {
  return catchError((err: unknown) => {
    if (err instanceof HttpErrorResponse) {
      // Create native Error with descriptive message and original as cause
      // Status 0 indicates network error (no connection, CORS, etc.)
      const prefix = err.status === 0 ? 'Network Error' : `HTTP Error ${err.status}`;
      const nativeError = new Error(
        `${prefix}${err.message ? `: ${err.message}` : ''}`,
        { cause: err }
      );
      return throwError(() => nativeError);
    }
    // Re-throw non-HTTP errors unchanged (e.g., for other loader types)
    return throwError(() => err);
  });
}
