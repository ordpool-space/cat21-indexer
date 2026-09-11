import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Search } from './search';

/**
 * Regression: on the bare `/search` route (no `:currentPage` segment)
 * component-input-binding binds the absent param as undefined, and a plain
 * `numberAttribute` transform turns that into NaN — which rendered as a blank
 * in "page … of N" ("page of 21") and broke the `currentPage < totalPages`
 * next-page guard. The transform now falls back to 1, so an absent or
 * unparseable param is always a real page number.
 */
describe('Search currentPage fallback', () => {
  let fixture: ComponentFixture<Search>;
  let component: Search;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(Search);
    component = fixture.componentInstance;
  });

  it('is 1 when the param is absent (undefined), not NaN', () => {
    fixture.componentRef.setInput('currentPage', undefined);
    expect(component.currentPage()).toBe(1);
  });

  it('is 1 for an unparseable param, not NaN', () => {
    fixture.componentRef.setInput('currentPage', '');
    expect(component.currentPage()).toBe(1);
  });

  it('honours a real page number', () => {
    fixture.componentRef.setInput('currentPage', '3');
    expect(component.currentPage()).toBe(3);
  });
});
