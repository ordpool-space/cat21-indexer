import { SubmitStatus } from "./submit-status";

export interface SubmittableState {
  submitStatus: SubmitStatus;
  submitErrorText: string;
}

export const initialSubmittableState: SubmittableState = {
  submitStatus: SubmitStatus.NotSubmitted,
  submitErrorText: ''
};

export function getInitialState() {
  return { ...initialSubmittableState };
}

export function getSubmittingState() {
  return {
    ...initialSubmittableState,
    submitStatus: SubmitStatus.Submitting
  }
}

export function getSuccessfulState() {
  return {
    ...initialSubmittableState,
    submitStatus: SubmitStatus.Successful,
  }
}

export function getFailureState(error: {message: string } | Error | Error & { reason: string}) {
  return {
    ...initialSubmittableState,
    submitStatus: SubmitStatus.Failure,
    // --> httpClient returns error.error.message
    submitErrorText: (error as unknown as { error: { message: string }})?.error?.message || (error as { reason: string})?.reason || error.message || 'Unknown Error'
  }
}
