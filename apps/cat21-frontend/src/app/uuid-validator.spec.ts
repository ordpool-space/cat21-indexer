import { FormControl } from '@angular/forms';
import { UuidValidator } from './uuid-validator';

describe('UUID Validator', () => {
  it('should return null if the UUID is valid', () => {
    const control = new FormControl('ab7be799-8688-4ce8-96b0-6c7c346483e5');
    expect(UuidValidator()(control)).toBeNull();
  });

  it('should return an error object if the UUID is not valid', () => {
    const control = new FormControl('invalid-uuid');
    expect(UuidValidator()(control)).toEqual({ invalidUuid: { value: 'invalid-uuid' } });
  });
});
