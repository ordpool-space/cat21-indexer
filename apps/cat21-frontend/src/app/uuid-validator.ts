import { AbstractControl, ValidatorFn } from '@angular/forms';

/**
 * Function to validate a form control value as a UUID.
 * @returns Validator function for checking a UUID.
 */
export function UuidValidator(): ValidatorFn {
  return (control: AbstractControl): { [key: string]: { value: string } } | null => {
    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    const isValid = uuidPattern.test(control.value);
    return isValid ? null : { 'invalidUuid': { value: control.value } };
  };
}
